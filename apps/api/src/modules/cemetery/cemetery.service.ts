import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../authorization/scope.service';
import { AuditService } from '../audit/audit.service';
import type {
  ChangeStatusDto,
  CreateCemeteryDto,
  CreateCompanyDto,
  CreateGravePlotDto,
  CreateGraveTypeDto,
} from './cemetery.dto';

/* Hồ sơ an táng còn hiệu lực — huỷ rồi thì cốt được nhả ra. Trùng danh sách trong
 * `burials.service.ts` VÀ trong partial unique index `burial_records_active_slot`; ba chỗ
 * phải nói cùng một điều, nên đổi ở đây thì phải đổi cả migration. */
const ACTIVE_BURIAL_STATUSES = ['Draft', 'Verified', 'Scheduled', 'Completed'];

@Injectable()
export class CemeteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  listRelationshipTypes() {
    return this.prisma.relationshipType.findMany({ orderBy: { code: 'asc' } });
  }

  createCompany(dto: CreateCompanyDto) {
    return this.wrapUnique(
      () => this.prisma.company.create({ data: { id: ulid(), code: dto.code, name: dto.name } }),
      'company code already exists',
    );
  }

  // The company picker is built from this list, so it must already be the caller's
  // scope: returning every company invites them to pick one they cannot use.
  async listCompanies(actor: string | null) {
    const allowed = await this.scope.visibleCompanyIds(actor);
    return this.prisma.company.findMany({
      ...(allowed === null ? {} : { where: { id: { in: allowed } } }),
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCemetery(dto: CreateCemeteryDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
    return this.wrapUnique(
      () =>
        this.prisma.cemetery.create({
          data: { id: ulid(), companyId: dto.companyId, code: dto.code, name: dto.name },
        }),
      'cemetery code already exists in this company',
    );
  }

  async listCemeteries(companyId: string, actor: string | null) {
    await this.scope.assertCompany(actor, companyId);
    const sites = await this.scope.listSiteFilter(actor);
    return this.prisma.cemetery.findMany({
      where: { companyId, ...(sites === null ? {} : { id: { in: sites } }) },
      orderBy: { code: 'asc' },
    });
  }

  async createGraveType(dto: CreateGraveTypeDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
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

  async listGraveTypes(companyId: string, actor: string | null) {
    await this.scope.assertCompany(actor, companyId);
    return this.prisma.graveType.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  async createGravePlot(dto: CreateGravePlotDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
    await this.scope.assertSite(actor, dto.cemeteryId);
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

  async listGravePlots(
    companyId: string,
    actor: string | null,
    status?: string,
    cemeteryId?: string,
  ) {
    await this.scope.assertCompany(actor, companyId);
    const where: Prisma.GravePlotWhereInput = { companyId };
    if (status !== undefined) where.status = status;
    if (cemeteryId !== undefined) {
      // Asking for one cemetery: it has to be one the caller covers.
      await this.scope.assertSite(actor, cemeteryId);
      where.cemeteryId = cemeteryId;
    } else {
      // Asking for the whole company: narrow a site-bound caller to their own cemeteries
      // rather than answering with the company's entire inventory.
      const sites = await this.scope.listSiteFilter(actor);
      if (sites !== null) {
        where.cemeteryId = { in: sites };
      }
    }
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

  /* Đặt toạ độ sơ đồ cho một phần mộ.
   *
   * Kiểm phạm vi theo NGHĨA TRANG chứa phần mộ, không theo companyId client gửi lên: vai
   * quản lý nghĩa trang có phạm vi SITE, và tin companyId từ client là bỏ qua đúng cái
   * ranh giới đó.
   */
  async setPlotPosition(
    id: string,
    dto: { mapX?: number | null; mapY?: number | null },
    actor: string | null,
  ) {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id },
      select: { id: true, companyId: true, cemeteryId: true, mapX: true, mapY: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompany(actor, plot.companyId);
    await this.scope.assertSite(actor, plot.cemeteryId);

    const updated = await this.prisma.gravePlot.update({
      where: { id },
      data: {
        ...(dto.mapX !== undefined ? { mapX: dto.mapX } : {}),
        ...(dto.mapY !== undefined ? { mapY: dto.mapY } : {}),
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE_PLOT.POSITION_SET',
      entityType: 'grave_plot',
      entityId: id,
      beforeData: { mapX: plot.mapX, mapY: plot.mapY },
      afterData: { mapX: updated.mapX, mapY: updated.mapY },
    });
    return updated;
  }

  /* Dữ liệu vẽ sơ đồ một nghĩa trang. Chỉ trả mộ ĐÃ có toạ độ — mộ chưa số hoá vị trí
   * không vẽ được, và trả về kèm toạ độ null buộc mọi phía vẽ phải tự lọc lại.
   */
  async plotMap(cemeteryId: string, actor: string | null) {
    const cemetery = await this.prisma.cemetery.findUnique({ where: { id: cemeteryId } });
    if (cemetery === null) {
      throw new NotFoundException('Không tìm thấy nghĩa trang');
    }
    await this.scope.assertCompany(actor, cemetery.companyId);
    await this.scope.assertSite(actor, cemeteryId);

    const plots = await this.prisma.gravePlot.findMany({
      where: { cemeteryId, mapX: { not: null }, mapY: { not: null } },
      select: {
        id: true,
        plotCode: true,
        status: true,
        zone: true,
        subzone: true,
        block: true,
        row: true,
        mapX: true,
        mapY: true,
      },
      orderBy: { plotCode: 'asc' },
    });
    const total = await this.prisma.gravePlot.count({ where: { cemeteryId } });
    return {
      cemeteryId,
      cemeteryName: cemetery.name,
      plots,
      /* Nói thẳng phần chưa vẽ được thay vì im lặng bỏ qua — sơ đồ thiếu mộ mà không báo
       * gì thì người xem tưởng nghĩa trang chỉ có bấy nhiêu. */
      totalPlots: total,
      missingPosition: total - plots.length,
    };
  }

  /* ---- Quyền sử dụng phần mộ: ai đứng tên mộ ----
   *
   * Đường bình thường sinh ra quyền sử dụng là `contract.activate`. Hàm này là ĐƯỜNG TẮT
   * cho các trường hợp có thật mà hợp đồng không phủ: chuyển dữ liệu từ hệ cũ, sửa sai,
   * cấp lại sau tranh chấp. Vì nó vượt mặt chuỗi thẩm định nên nó có mã quyền S3 riêng và
   * ghi nhật ký riêng — không nấp trong một mã sẵn có.
   */
  async assignUsageRight(
    dto: { gravePlotId: string; holderCustomerId: string; effectiveFrom?: string; note?: string },
    actor: string | null,
  ) {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: dto.gravePlotId },
      select: { id: true, companyId: true, cemeteryId: true, plotCode: true, status: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompany(actor, plot.companyId);
    await this.scope.assertSite(actor, plot.cemeteryId);

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.holderCustomerId },
      select: {
        id: true,
        customerCode: true,
        companyId: true,
        person: { select: { id: true, fullName: true, deceased: { select: { id: true } } } },
      },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    /* CHỦ MỘ PHẢI CÒN SỐNG (quyết định 26/08/2026).
     *
     * Người đã mất không đứng tên tài sản được: quyền sử dụng của họ phải đi qua thừa kế,
     * và thừa kế là một hồ sơ có người duyệt chứ không phải một lần bấm nút. Chặn ở đây
     * để đường tắt này không trở thành đường vòng qua thủ tục kế thừa. */
    if (customer.person?.deceased != null) {
      throw new ConflictException(
        `${customer.person.fullName} đã mất — không đứng tên phần mộ được. Phần mộ của người đã mất phải qua thủ tục kế thừa.`,
      );
    }

    const existing = await this.prisma.graveUsageRight.findFirst({
      where: { gravePlotId: dto.gravePlotId, status: 'Active' },
      select: { id: true, holderCustomerId: true },
    });
    if (existing !== null) {
      throw new ConflictException(
        existing.holderCustomerId === dto.holderCustomerId
          ? `Phần mộ ${plot.plotCode} đã do chính khách hàng này đứng tên`
          : `Phần mộ ${plot.plotCode} đã có chủ khác đứng tên — phải chấm dứt quyền cũ trước`,
      );
    }
    if (plot.status === 'Occupied') {
      throw new ConflictException(
        `Phần mộ ${plot.plotCode} đang có người an táng nhưng không có chủ đứng tên — cần rà soát dữ liệu trước khi gán`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const right = await tx.graveUsageRight.create({
        data: {
          id: ulid(),
          gravePlotId: dto.gravePlotId,
          holderCustomerId: dto.holderCustomerId,
          /* Cột này NOT NULL và bình thường trỏ tới hợp đồng sinh ra quyền. Đường tắt
           * không có hợp đồng, nên ghi một nhãn nói rõ nguồn gốc thay vì bịa một id —
           * đọc lại sau này phải biết ngay quyền này không đi qua hợp đồng nào. */
          sourceContractId: 'MANUAL_ASSIGN',
          status: 'Active',
          effectiveFrom: dto.effectiveFrom !== undefined ? new Date(dto.effectiveFrom) : new Date(),
        },
      });
      /* Mộ có chủ thì không còn trống. Không đụng tới mộ đã `Occupied` (đã chặn ở trên). */
      if (plot.status !== 'Allocated') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Allocated', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Allocated',
            reason: `gán chủ mộ ${customer.customerCode} (không qua hợp đồng)`,
            changedBy: actor,
          },
        });
      }
      return right;
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE.USAGE_RIGHT_ASSIGNED',
      entityType: 'grave_plot',
      entityId: plot.id,
      afterData: {
        usageRightId: result.id,
        holderCustomerId: dto.holderCustomerId,
        plotCode: plot.plotCode,
        note: dto.note ?? null,
        viaContract: false,
      },
    });
    return result;
  }

  /* Lấy quyền sử dụng đang hiệu lực kèm phần mộ. Dùng chung cho thu hồi và sang tên —
   * hai việc khác nhau nhưng cùng bắt đầu bằng "quyền này còn hiệu lực không". */
  private async activeRightOrThrow(usageRightId: string, actor: string | null) {
    const right = await this.prisma.graveUsageRight.findUnique({ where: { id: usageRightId } });
    if (right === null) {
      throw new NotFoundException('Không tìm thấy quyền sử dụng phần mộ');
    }
    if (right.status !== 'Active') {
      throw new ConflictException(
        `Quyền này đã ${right.status === 'Transferred' ? 'sang tên' : 'chấm dứt'} — không thao tác được nữa`,
      );
    }
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: right.gravePlotId },
      select: { id: true, companyId: true, cemeteryId: true, plotCode: true, status: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompany(actor, plot.companyId);
    await this.scope.assertSite(actor, plot.cemeteryId);
    return { right, plot };
  }

  /* THU HỒI quyền sử dụng — phần mộ trở về trống.
   *
   * Chặn khi mộ còn hồ sơ an táng hiệu lực: một phần mộ có người nằm mà không ai đứng tên
   * là hồ sơ không ai chịu trách nhiệm, và người nhà tới hỏi thì không có ai để hỏi.
   * Muốn đổi người chịu trách nhiệm thì đó là SANG TÊN, không phải thu hồi.
   */
  async releaseUsageRight(usageRightId: string, dto: { reason: string }, actor: string | null) {
    const { right, plot } = await this.activeRightOrThrow(usageRightId, actor);

    const burials = await this.prisma.burialRecord.count({
      where: { gravePlotId: plot.id, status: { in: ACTIVE_BURIAL_STATUSES } },
    });
    if (burials > 0) {
      throw new ConflictException(
        `Phần mộ ${plot.plotCode} còn ${burials} hồ sơ an táng — không thu hồi được. Dùng SANG TÊN nếu muốn đổi chủ mộ.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const ended = await tx.graveUsageRight.update({
        where: { id: right.id },
        data: { status: 'Ended', effectiveTo: new Date(), endedReason: dto.reason },
      });
      /* Mộ về trống. Không đụng mộ `Occupied` — đã chặn ở trên, nên tới đây trạng thái chỉ
       * có thể là Allocated (hoặc thứ gì đó lệch, và lệch thì để nguyên cho người rà). */
      if (plot.status === 'Allocated') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Available', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Available',
            reason: `thu hồi quyền sử dụng: ${dto.reason}`,
            changedBy: actor,
          },
        });
      }
      return ended;
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE.USAGE_RIGHT_RELEASED',
      entityType: 'grave_plot',
      entityId: plot.id,
      beforeData: { usageRightId: right.id, holderCustomerId: right.holderCustomerId },
      afterData: { plotCode: plot.plotCode, reason: dto.reason, plotBackToAvailable: true },
    });
    return result;
  }

  /* SANG TÊN phần mộ cho chủ mới.
   *
   * Đây là đường THỪA KẾ. `assignUsageRight` chặn người đã mất đứng tên, nên nếu không có
   * hàm này thì mộ của người đã mất kẹt vĩnh viễn ở tên họ — và đó chính là chỗ hệ cũ để
   * lại một đống hồ sơ "cần kế thừa" không xử lý được.
   *
   * Chủ CŨ được phép đã mất (đó mới là lý do sang tên). Chủ MỚI thì phải còn sống — cùng
   * luật với gán mộ, vì kết quả của hai việc là như nhau: một người đứng tên phần mộ.
   */
  async transferUsageRight(
    usageRightId: string,
    dto: { toCustomerId: string; reason: string; effectiveFrom?: string },
    actor: string | null,
  ) {
    const { right, plot } = await this.activeRightOrThrow(usageRightId, actor);

    if (right.holderCustomerId === dto.toCustomerId) {
      throw new ConflictException('Chủ mới trùng chủ hiện tại — không có gì để sang tên');
    }

    const toCustomer = await this.prisma.customer.findUnique({
      where: { id: dto.toCustomerId },
      select: {
        id: true,
        customerCode: true,
        orgName: true,
        person: { select: { fullName: true, deceased: { select: { id: true } } } },
      },
    });
    if (toCustomer === null) {
      throw new NotFoundException('Không tìm thấy chủ mới');
    }
    if (toCustomer.person?.deceased != null) {
      throw new ConflictException(
        `${toCustomer.person.fullName} đã mất — không nhận sang tên được. Sang tên cho người thừa kế còn sống.`,
      );
    }

    /* Thứ tự trong giao dịch KHÔNG đổi được: partial unique index
     * `grave_usage_rights_active_plot` chỉ cho MỘT quyền Active trên mỗi phần mộ. Tạo
     * quyền mới trước khi đóng quyền cũ là va thẳng vào ràng buộc đó. */
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.graveUsageRight.update({
        where: { id: right.id },
        data: { status: 'Transferred', effectiveTo: new Date(), endedReason: dto.reason },
      });
      return tx.graveUsageRight.create({
        data: {
          id: ulid(),
          gravePlotId: plot.id,
          holderCustomerId: dto.toCustomerId,
          sourceContractId: 'TRANSFER',
          previousRightId: right.id,
          status: 'Active',
          effectiveFrom: dto.effectiveFrom !== undefined ? new Date(dto.effectiveFrom) : new Date(),
        },
      });
    });

    /* Trạng thái phần mộ KHÔNG đổi: mộ vẫn được phân bổ, vẫn có người nằm nếu đang có.
     * Sang tên đổi người chịu trách nhiệm, không đổi hiện trạng phần mộ. */
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE.USAGE_RIGHT_TRANSFERRED',
      entityType: 'grave_plot',
      entityId: plot.id,
      beforeData: { usageRightId: right.id, holderCustomerId: right.holderCustomerId },
      afterData: {
        usageRightId: created.id,
        holderCustomerId: dto.toCustomerId,
        plotCode: plot.plotCode,
        reason: dto.reason,
      },
    });
    return created;
  }

  /* Lịch sử chủ mộ của một phần mộ, mới nhất trước.
   *
   * Đọc từ bảng quyền sử dụng chứ không dựng lại từ nhật ký kiểm toán: nhật ký ghi việc
   * ĐÃ LÀM, còn đây là trạng thái hồ sơ — và hai thứ đó trả lời hai câu hỏi khác nhau.
   */
  async usageRightHistory(gravePlotId: string, actor: string | null) {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      select: { id: true, companyId: true, plotCode: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompany(actor, plot.companyId);

    const rights = await this.prisma.graveUsageRight.findMany({
      where: { gravePlotId },
      orderBy: { createdAt: 'desc' },
    });
    if (rights.length === 0) {
      return { gravePlotId, plotCode: plot.plotCode, history: [] };
    }
    const holders = await this.prisma.customer.findMany({
      where: { id: { in: [...new Set(rights.map((r) => r.holderCustomerId))] } },
      select: {
        id: true,
        customerCode: true,
        orgName: true,
        person: { select: { fullName: true } },
      },
    });
    const byId = new Map(holders.map((h) => [h.id, h]));

    return {
      gravePlotId,
      plotCode: plot.plotCode,
      history: rights.map((r) => {
        const h = byId.get(r.holderCustomerId);
        return {
          usageRightId: r.id,
          holderCustomerId: r.holderCustomerId,
          holderName: h?.person?.fullName ?? h?.orgName ?? null,
          holderCode: h?.customerCode ?? null,
          status: r.status,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          endedReason: r.endedReason,
          previousRightId: r.previousRightId,
          /* Quyền sinh ra ngoài hợp đồng phải đọc ra được — nếu không, sau này không ai
           * phân biệt được quyền nào đã qua thẩm định. */
          viaContract: r.sourceContractId !== 'MANUAL_ASSIGN' && r.sourceContractId !== 'TRANSFER',
        };
      }),
    };
  }

  /* Ai đang đứng tên một phần mộ, và các cốt đã dùng. Giao diện cần cả hai để dựng màn
   * hình an táng: không có chủ thì chưa an táng được, và phải biết cốt nào còn trống. */
  async plotOwnership(gravePlotId: string, actor: string | null) {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      include: { graveType: { select: { defaultCapacity: true, name: true } } },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompany(actor, plot.companyId);

    const right = await this.prisma.graveUsageRight.findFirst({
      where: { gravePlotId, status: 'Active' },
      orderBy: { createdAt: 'desc' },
    });
    const holder =
      right === null
        ? null
        : await this.prisma.customer.findUnique({
            where: { id: right.holderCustomerId },
            select: {
              id: true,
              customerCode: true,
              orgName: true,
              person: {
                select: { id: true, fullName: true, deceased: { select: { id: true } } },
              },
            },
          });

    const burials = await this.prisma.burialRecord.findMany({
      where: { gravePlotId, status: { in: ACTIVE_BURIAL_STATUSES } },
      include: { deceased: { include: { person: { select: { id: true, fullName: true } } } } },
      orderBy: [{ slotNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const capacity = plot.capacityOverride ?? plot.graveType.defaultCapacity;
    const takenSlots = burials.map((b) => b.slotNumber).filter((n): n is number => n !== null);

    return {
      gravePlotId: plot.id,
      plotCode: plot.plotCode,
      status: plot.status,
      graveTypeName: plot.graveType.name,
      capacity,
      holder:
        holder === null
          ? null
          : {
              customerId: holder.id,
              customerCode: holder.customerCode,
              name: holder.person?.fullName ?? holder.orgName,
              personId: holder.person?.id ?? null,
              isDeceased: holder.person?.deceased != null,
            },
      occupants: burials.map((b) => ({
        burialRecordId: b.id,
        slotNumber: b.slotNumber,
        personId: b.deceased.person.id,
        fullName: b.deceased.person.fullName,
        relationshipToOwner: b.relationshipToOwner,
        status: b.status,
        burialDate: b.burialDate,
      })),
      /* Cốt còn trống, tính sẵn ở API. Giao diện tự tính thì hai màn hình sẽ đưa ra hai
       * đáp án khác nhau khi có hồ sơ cũ chưa mang số cốt. */
      freeSlots: Array.from({ length: capacity }, (_, i) => i + 1).filter(
        (n) => !takenSlots.includes(n),
      ),
      unnumberedBurials: burials.filter((b) => b.slotNumber === null).length,
    };
  }
}
