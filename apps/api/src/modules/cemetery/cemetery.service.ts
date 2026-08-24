import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ChangeStatusDto,
  CreateCemeteryDto,
  CreateCompanyDto,
  CreateGravePlotDto,
  CreateGraveTypeDto,
} from './cemetery.dto';

@Injectable()
export class CemeteryService {
  constructor(private readonly prisma: PrismaService) {}

  listRelationshipTypes() {
    return this.prisma.relationshipType.findMany({ orderBy: { code: 'asc' } });
  }

  createCompany(dto: CreateCompanyDto) {
    return this.wrapUnique(
      () => this.prisma.company.create({ data: { id: ulid(), code: dto.code, name: dto.name } }),
      'company code already exists',
    );
  }

  listCompanies() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  }

  createCemetery(dto: CreateCemeteryDto) {
    return this.wrapUnique(
      () =>
        this.prisma.cemetery.create({
          data: { id: ulid(), companyId: dto.companyId, code: dto.code, name: dto.name },
        }),
      'cemetery code already exists in this company',
    );
  }

  listCemeteries(companyId: string) {
    return this.prisma.cemetery.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  createGraveType(dto: CreateGraveTypeDto) {
    return this.wrapUnique(
      () =>
        this.prisma.graveType.create({
          data: {
            id: ulid(),
            companyId: dto.companyId,
            code: dto.code,
            name: dto.name,
            defaultCapacity: dto.defaultCapacity ?? 1,
            referencePrice: dto.referencePrice ?? null,
          },
        }),
      'grave type code already exists in this company',
    );
  }

  listGraveTypes(companyId: string) {
    return this.prisma.graveType.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  createGravePlot(dto: CreateGravePlotDto) {
    return this.wrapUnique(
      () =>
        this.prisma.gravePlot.create({
          data: {
            id: ulid(),
            companyId: dto.companyId,
            cemeteryId: dto.cemeteryId,
            graveTypeId: dto.graveTypeId,
            plotCode: dto.plotCode,
            zone: dto.zone ?? null,
            subzone: dto.subzone ?? null,
            block: dto.block ?? null,
            row: dto.row ?? null,
            capacityOverride: dto.capacityOverride ?? null,
          },
        }),
      'plotCode already exists in this company',
    );
  }

  async listGravePlots(companyId: string, status?: string, cemeteryId?: string) {
    const where: Prisma.GravePlotWhereInput = { companyId };
    if (status !== undefined) where.status = status;
    if (cemeteryId !== undefined) where.cemeteryId = cemeteryId;
    const plots = await this.prisma.gravePlot.findMany({
      where,
      orderBy: { plotCode: 'asc' },
      include: { graveType: { select: { defaultCapacity: true } } },
    });
    // Effective capacity = per-plot override or the grave type default (G0-A1).
    return plots.map((p) => ({
      ...p,
      effectiveCapacity: p.capacityOverride ?? p.graveType.defaultCapacity,
    }));
  }

  // Change status inside a transaction and append to the status history.
  async changeGravePlotStatus(id: string, dto: ChangeStatusDto, changedBy: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const plot = await tx.gravePlot.findUnique({ where: { id } });
      if (plot === null) {
        throw new NotFoundException('Grave plot not found');
      }
      if (plot.status === dto.toStatus) {
        return plot;
      }
      const updated = await tx.gravePlot.update({
        where: { id },
        data: { status: dto.toStatus, version: plot.version + 1 },
      });
      await tx.gravePlotStatusHistory.create({
        data: {
          id: ulid(),
          gravePlotId: id,
          fromStatus: plot.status,
          toStatus: dto.toStatus,
          reason: dto.reason ?? null,
          changedBy,
        },
      });
      return updated;
    });
  }

  getStatusHistory(gravePlotId: string) {
    return this.prisma.gravePlotStatusHistory.findMany({
      where: { gravePlotId },
      orderBy: { changedAt: 'desc' },
    });
  }

  private async wrapUnique<T>(fn: () => Promise<T>, message: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(message);
      }
      throw err;
    }
  }
}
