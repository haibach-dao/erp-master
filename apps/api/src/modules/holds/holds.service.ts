import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateHoldDto } from './holds.dto';

const DEFAULT_HOLD_MINUTES = 60;

@Injectable()
export class HoldsService {
  constructor(private readonly prisma: PrismaService) {}

  // Create a hold and move the plot Available -> Held atomically. Double-hold is blocked by
  // both the pre-check and the partial unique index (one Active hold per plot).
  async createHold(dto: CreateHoldDto, actor: string | null) {
    const expiresAt =
      dto.expiresAt !== undefined
        ? new Date(dto.expiresAt)
        : new Date(Date.now() + (dto.holdMinutes ?? DEFAULT_HOLD_MINUTES) * 60_000);

    return this.prisma.$transaction(async (tx) => {
      const plot = await tx.gravePlot.findUnique({ where: { id: dto.gravePlotId } });
      if (plot === null) {
        throw new NotFoundException('Không tìm thấy vị trí mộ');
      }
      if (plot.status !== 'Available') {
        throw new ConflictException(`Mộ đang ở trạng thái ${plot.status}, không giữ chỗ được`);
      }

      let hold;
      try {
        hold = await tx.graveHold.create({
          data: {
            id: ulid(),
            gravePlotId: dto.gravePlotId,
            customerId: dto.customerId,
            createdBy: actor,
            status: 'Active',
            reason: dto.reason ?? null,
            expiresAt,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Mộ đã có người giữ chỗ');
        }
        throw err;
      }

      const updated = await tx.gravePlot.updateMany({
        where: { id: plot.id, version: plot.version },
        data: { status: 'Held', version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConflictException('Vị trí mộ vừa thay đổi, vui lòng thử lại');
      }
      await tx.gravePlotStatusHistory.create({
        data: {
          id: ulid(),
          gravePlotId: plot.id,
          fromStatus: plot.status,
          toStatus: 'Held',
          reason: 'hold',
          changedBy: actor,
        },
      });
      return hold;
    });
  }

  async releaseHold(id: string, actor: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.graveHold.findUnique({ where: { id } });
      if (hold === null) {
        throw new NotFoundException('Không tìm thấy giữ chỗ');
      }
      if (hold.status !== 'Active') {
        throw new ConflictException('Giữ chỗ không ở trạng thái Active');
      }
      await tx.graveHold.update({
        where: { id },
        data: { status: 'Cancelled', releasedAt: new Date() },
      });
      const plot = await tx.gravePlot.findUnique({ where: { id: hold.gravePlotId } });
      if (plot !== null && plot.status === 'Held') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Available', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: 'Held',
            toStatus: 'Available',
            reason: 'release hold',
            changedBy: actor,
          },
        });
      }
      return { released: true, holdId: id };
    });
  }

  listHolds(gravePlotId?: string, status?: string) {
    const where: Prisma.GraveHoldWhereInput = {};
    if (gravePlotId !== undefined) where.gravePlotId = gravePlotId;
    if (status !== undefined) where.status = status;
    return this.prisma.graveHold.findMany({ where, orderBy: { createdAt: 'desc' } });
  }
}
