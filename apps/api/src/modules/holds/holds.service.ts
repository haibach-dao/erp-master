import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
import { holdStale } from '../../common/lifecycle/active';
import type { CreateHoldDto } from './holds.dto';

const DEFAULT_HOLD_MINUTES = 60;

@Injectable()
export class HoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* PHẠM VI CỦA MỘT PHIẾU GIỮ CHỖ = phạm vi của PHẦN MỘ nó giữ.
   *
   * `GraveHold` không mang `companyId` lẫn `cemeteryId`; nó chỉ có `gravePlotId`. Nhưng
   * `gravePlotId` là NOT NULL và CÓ khoá ngoại thật tới `GravePlot`, nên neo luôn quy được
   * và không có con trỏ treo — khác hẳn `ExternalContract.contractFileId` (id lỏng).
   *
   * Kiểm TRƯỚC khi mở giao dịch: hỏi phạm vi là gọi ra ngoài Prisma, giữ một giao dịch mở
   * trong lúc chờ nó là giữ khoá hàng lâu hơn cần thiết. Hệ quả là phần mộ / phiếu giữ được
   * đọc hai lần (một lần để hỏi phạm vi, một lần trong giao dịch để khoá) — đổi một truy
   * vấn rẻ lấy một giao dịch ngắn, và đây đúng khuôn `changeGravePlotStatus` đang dùng.
   */
  private async assertPlotInScope(gravePlotId: string, caller: Caller): Promise<void> {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      select: { companyId: true, cemeteryId: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy vị trí mộ');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, plot.companyId);
    await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
  }

  // Create a hold and move the plot Available -> Held atomically. Double-hold is blocked by
  // both the pre-check and the partial unique index (one Active hold per plot).
  async createHold(dto: CreateHoldDto, caller: Caller) {
    await this.assertPlotInScope(dto.gravePlotId, caller);
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
            createdBy: caller.userId,
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
          changedBy: caller.userId,
        },
      });
      return hold;
    });
  }

  async releaseHold(id: string, caller: Caller) {
    /* Quy phiếu giữ về phần mộ TRƯỚC giao dịch. Bỏ sót chiều này là người ngoài phạm vi nhả
     * được chỗ người khác đang giữ — và nhả chỗ thì mộ về `Available`, tức mở đường cho
     * người khác giữ hoặc mua. Phá hoại chỉ cần một chiều là đủ. */
    const target = await this.prisma.graveHold.findUnique({
      where: { id },
      select: { gravePlotId: true },
    });
    if (target === null) {
      throw new NotFoundException('Không tìm thấy giữ chỗ');
    }
    await this.assertPlotInScope(target.gravePlotId, caller);

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
            changedBy: caller.userId,
          },
        });
      }
      return { released: true, holdId: id };
    });
  }

  /* Danh sách phiếu giữ chỗ — bó theo phạm vi, vì đây là chỗ lấy được ID phiếu để gọi
   * `release`. Bó ghi mà hở đọc là bó nửa vời.
   *
   * `GraveHold` CÓ quan hệ Prisma tới `GravePlot`, nên lọc được thẳng qua quan hệ
   * (`where: { gravePlot: { ... } }`) — không phải quy ra danh sách id rồi lọc `in` như bên
   * hợp đồng, nơi hai bảng không có quan hệ nào nối.
   */
  async listHolds(caller: Caller, gravePlotId?: string, status?: string) {
    const where: Prisma.GraveHoldWhereInput = {};
    if (status !== undefined) where.status = status;

    if (gravePlotId !== undefined) {
      // Hỏi đúng MỘT phần mộ: phần mộ đó phải nằm trong phạm vi được gán.
      await this.assertPlotInScope(gravePlotId, caller);
      where.gravePlotId = gravePlotId;
      return this.prisma.graveHold.findMany({ where, orderBy: { createdAt: 'desc' } });
    }

    const companies = await this.scope.visibleCompanyIdsFor(caller.userId, caller.permission);
    const sites = await this.scope.listSiteFilterFor(caller.userId, caller.permission);
    /* `[]` là câu trả lời ĐÚNG, không phải chỗ để bỏ mệnh đề đi: được gán không công ty /
     * nghĩa trang nào nghĩa là với tới không cái nào, không phải với tới tất cả. */
    if (companies !== null || sites !== null) {
      where.gravePlot = {
        ...(companies === null ? {} : { companyId: { in: companies } }),
        ...(sites === null ? {} : { cemeteryId: { in: sites } }),
      };
    }
    return this.prisma.graveHold.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  /* Quét phiếu giữ chỗ ĐÃ HẾT HẠN mà vẫn mang trạng thái Active.
   *
   * Vì sao cần: `expiresAt` chỉ là một con số trong bảng — không có gì tự đổi trạng thái
   * khi nó trôi qua. Nên một phiếu hết hạn từ sáng vẫn là `Active`, phần mộ vẫn kẹt ở
   * `Held`, và mọi chỗ đếm "còn giữ chỗ không" đều trả lời sai.
   *
   * Đây là việc đáng ra của worker định kỳ (T09, chưa có). Làm thành một hàm gọi được để
   * chạy tay hoặc gắn cron, thay vì để dữ liệu tiếp tục lệch trong lúc chờ worker.
   *
   * KHÔNG gọi ngầm từ các đường đọc: một GET mà lặng lẽ đổi dữ liệu là thứ khiến hai lần
   * đọc liền nhau cho hai kết quả khác nhau, và không ai biết vì sao.
   */
  async expireStaleHolds(actor: string | null) {
    const now = new Date();
    const stale = await this.prisma.graveHold.findMany({
      where: holdStale(now),
      select: { id: true, gravePlotId: true, expiresAt: true },
    });
    if (stale.length === 0) {
      return { expired: 0, plotsReleased: 0 };
    }

    let plotsReleased = 0;
    for (const hold of stale) {
      /* Từng phiếu một giao dịch, không gộp cả mẻ: một phiếu hỏng thì những phiếu còn lại
       * vẫn được dọn. Gộp một giao dịch thì một lỗi kéo cả mẻ quay lui. */
      await this.prisma.$transaction(async (tx) => {
        await tx.graveHold.update({
          where: { id: hold.id },
          data: { status: 'Expired', releasedAt: now },
        });
        const plot = await tx.gravePlot.findUnique({ where: { id: hold.gravePlotId } });
        /* Chỉ nhả mộ đang `Held`. Mộ đã sang `Allocated` (có hợp đồng) thì phiếu hết hạn
         * không được kéo nó về trống — hợp đồng thắng phiếu giữ chỗ. */
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
              reason: `giữ chỗ hết hạn ${hold.expiresAt.toISOString()}`,
              changedBy: actor,
            },
          });
          plotsReleased += 1;
        }
      });

      await this.audit.record({
        actorType: actor === null ? 'SYSTEM' : 'USER',
        actorId: actor,
        action: 'GRAVE.HOLD_EXPIRED',
        entityType: 'grave_plot',
        entityId: hold.gravePlotId,
        afterData: { holdId: hold.id, expiresAt: hold.expiresAt.toISOString() },
      });
    }
    return { expired: stale.length, plotsReleased };
  }
}
