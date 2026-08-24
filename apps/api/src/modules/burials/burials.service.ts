import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateBurialDto, CreateDeceasedDto } from './burials.dto';

const ACTIVE_BURIAL_STATUSES = ['Draft', 'Verified', 'Scheduled', 'Completed'];

@Injectable()
export class BurialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  createDeceased(dto: CreateDeceasedDto) {
    return this.prisma.deceasedPerson.create({
      data: {
        id: ulid(),
        personId: dto.personId,
        dateOfDeath: dto.dateOfDeath !== undefined ? new Date(dto.dateOfDeath) : null,
        deathCertFileId: dto.deathCertFileId ?? null,
      },
    });
  }

  // Effective capacity = per-plot override or grave type default (G0-A1).
  private async effectiveCapacity(
    gravePlotId: string,
  ): Promise<{ plotStatus: string; cap: number }> {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      include: { graveType: { select: { defaultCapacity: true } } },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy vị trí mộ');
    }
    return {
      plotStatus: plot.status,
      cap: plot.capacityOverride ?? plot.graveType.defaultCapacity,
    };
  }

  async createBurial(dto: CreateBurialDto, actor: string | null) {
    const { plotStatus, cap } = await this.effectiveCapacity(dto.gravePlotId);
    if (plotStatus !== 'Allocated' && plotStatus !== 'Occupied') {
      throw new ConflictException(
        `Mộ đang ${plotStatus}, cần phân bổ (hợp đồng) trước khi an táng`,
      );
    }
    const activeCount = await this.prisma.burialRecord.count({
      where: { gravePlotId: dto.gravePlotId, status: { in: ACTIVE_BURIAL_STATUSES } },
    });
    if (activeCount >= cap) {
      throw new ConflictException(`Vượt sức chứa mộ (${activeCount}/${cap})`);
    }
    const burial = await this.prisma.burialRecord.create({
      data: {
        id: ulid(),
        gravePlotId: dto.gravePlotId,
        deceasedPersonId: dto.deceasedPersonId,
        contractId: dto.contractId ?? null,
        burialDate: dto.burialDate !== undefined ? new Date(dto.burialDate) : null,
        legalDocFileId: dto.legalDocFileId ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.CREATED',
      entityType: 'burial_record',
      entityId: burial.id,
      afterData: { gravePlotId: dto.gravePlotId, deceasedPersonId: dto.deceasedPersonId },
    });
    return burial;
  }

  async verify(id: string, actor: string | null) {
    const burial = await this.prisma.burialRecord.findUnique({ where: { id } });
    if (burial === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ an táng');
    }
    if (burial.status !== 'Draft') {
      throw new ConflictException(`Không thể xác minh ở trạng thái ${burial.status}`);
    }
    const updated = await this.prisma.burialRecord.update({
      where: { id },
      data: { status: 'Verified' },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.VERIFIED',
      entityType: 'burial_record',
      entityId: id,
    });
    return updated;
  }

  // Complete a burial → plot becomes Occupied (re-checks capacity). Blueprint M4.
  async complete(id: string, actor: string | null) {
    const burial = await this.prisma.burialRecord.findUnique({ where: { id } });
    if (burial === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ an táng');
    }
    if (burial.status !== 'Verified' && burial.status !== 'Scheduled') {
      throw new ConflictException(
        `Chỉ hoàn tất hồ sơ đã Verified/Scheduled (đang ${burial.status})`,
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const plot = await tx.gravePlot.findUnique({
        where: { id: burial.gravePlotId },
        include: { graveType: { select: { defaultCapacity: true } } },
      });
      if (plot === null) {
        throw new NotFoundException('Không tìm thấy vị trí mộ');
      }
      const cap = plot.capacityOverride ?? plot.graveType.defaultCapacity;
      const completedCount = await tx.burialRecord.count({
        where: { gravePlotId: burial.gravePlotId, status: 'Completed' },
      });
      if (completedCount >= cap) {
        throw new ConflictException(`Vượt sức chứa mộ (${completedCount}/${cap})`);
      }
      const updated = await tx.burialRecord.update({
        where: { id },
        data: { status: 'Completed', version: { increment: 1 } },
      });
      if (plot.status !== 'Occupied') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Occupied', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Occupied',
            reason: `burial ${id} completed`,
            changedBy: actor,
          },
        });
      }
      return { updated, plotId: plot.id };
    });

    // Audit outside the transaction (AuditService opens its own tx).
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.COMPLETED',
      entityType: 'burial_record',
      entityId: id,
      afterData: { gravePlotId: result.plotId },
    });
    return result.updated;
  }

  get(id: string) {
    return this.prisma.burialRecord.findUnique({
      where: { id },
      include: { deceased: { include: { person: { select: { id: true, fullName: true } } } } },
    });
  }

  list(gravePlotId?: string, status?: string) {
    return this.prisma.burialRecord.findMany({
      where: {
        ...(gravePlotId !== undefined ? { gravePlotId } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
