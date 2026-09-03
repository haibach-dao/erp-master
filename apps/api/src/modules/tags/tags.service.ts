import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Caller } from '../authorization/caller';
import { ScopeService } from '../authorization/scope.service';
import { activeTag } from '../../common/lifecycle/active';
import type {
  AssignTagDto,
  CreateCustomerTagTypeDto,
  CreateGravePlotTagTypeDto,
  RemoveTagDto,
  UpdateTagTypeDto,
} from './tags.dto';

/* THẺ NHÃN — anh Bách chốt 03/09/2026: HAI danh mục TÁCH RIÊNG, cả hai TOÀN HỆ.
 *
 * Service này có hai nửa gần giống nhau, và tôi CỐ Ý không gộp bằng generic. Gộp là đưa hai
 * thứ đang tách ở tầng dữ liệu về chung một đường mã, và đường mã đó sẽ là chỗ đầu tiên ai
 * đó "tiện tay" cho thẻ khách đi qua nhánh của thẻ mộ. Ranh giới chỉ có giá trị khi nó được
 * giữ ở MỌI tầng — kể cả tầng mà việc giữ nó tốn vài chục dòng lặp.
 *
 * Danh mục là dữ liệu TOÀN HỆ, nên các hàm quản trị danh mục KHÔNG nhận `Caller`: không có
 * bản ghi đích nào để bó phạm vi, y như danh mục vai. Rào ở đó là MÃ QUYỀN. Các hàm GẮN/GỠ
 * thì ngược lại — chúng có phần mộ hoặc khách hàng để bó, và bó thật.
 *
 * ĐỢT 1 thẻ KHÔNG chặn nghiệp vụ nào. Ngày nào nó chặn được một việc, phải rà lại cả file.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------- Danh mục thẻ MỘ (toàn hệ) ---------- */

  /** Kèm số phần mộ ĐANG mang từng thẻ — đây là đường tra cứu từ màn hình quản trị. */
  async listPlotTagTypes() {
    const rows = await this.prisma.gravePlotTagType.findMany({
      orderBy: { code: 'asc' },
      /* Đếm thẻ ĐANG gắn, không đếm thẻ đã gỡ. Thiếu `activeTag` ở đây thì con số nói "12
       * mộ đang mang thẻ này" trong khi bấm vào chỉ lọc ra 3. */
      include: { _count: { select: { tags: { where: { ...activeTag } } } } },
    });
    return rows.map((t) => ({ ...t, usageCount: t._count.tags }));
  }

  async createPlotTagType(dto: CreateGravePlotTagTypeDto, actorId: string | null) {
    const created = await this.wrapDuplicateCode(() =>
      this.prisma.gravePlotTagType.create({
        data: {
          id: ulid(),
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          createdBy: actorId,
        },
      }),
    );
    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'PLOT_TAG_TYPE.CREATED',
      entityType: 'grave_plot_tag_type',
      entityId: created.id,
      afterData: { code: created.code, name: created.name },
    });
    return created;
  }

  async updatePlotTagType(id: string, dto: UpdateTagTypeDto, actorId: string | null) {
    const before = await this.prisma.gravePlotTagType.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy thẻ nhãn phần mộ');
    }
    const updated = await this.prisma.gravePlotTagType.update({
      where: { id },
      data: this.patch(dto),
    });
    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'PLOT_TAG_TYPE.UPDATED',
      entityType: 'grave_plot_tag_type',
      entityId: id,
      beforeData: { name: before.name, status: before.status },
      afterData: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  /* ---------- Danh mục thẻ KHÁCH (toàn hệ) ---------- */

  async listCustomerTagTypes() {
    const rows = await this.prisma.customerTagType.findMany({
      orderBy: [{ subject: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { tags: { where: { ...activeTag } } } } },
    });
    return rows.map((t) => ({ ...t, usageCount: t._count.tags }));
  }

  async createCustomerTagType(dto: CreateCustomerTagTypeDto, actorId: string | null) {
    const created = await this.wrapDuplicateCode(() =>
      this.prisma.customerTagType.create({
        data: {
          id: ulid(),
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          subject: dto.subject,
          createdBy: actorId,
        },
      }),
    );
    /* Ghi `subject` vào nhật ký: đây là dòng người rà soát tìm tới khi hỏi "ai đã mở một thẻ
     * để dán lên khách hàng, và thẻ đó nói về cái gì". */
    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'CUSTOMER_TAG_TYPE.CREATED',
      entityType: 'customer_tag_type',
      entityId: created.id,
      afterData: { code: created.code, name: created.name, subject: created.subject },
    });
    return created;
  }

  async updateCustomerTagType(id: string, dto: UpdateTagTypeDto, actorId: string | null) {
    const before = await this.prisma.customerTagType.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy thẻ nhãn khách hàng');
    }
    const updated = await this.prisma.customerTagType.update({
      where: { id },
      data: this.patch(dto),
    });
    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'CUSTOMER_TAG_TYPE.UPDATED',
      entityType: 'customer_tag_type',
      entityId: id,
      beforeData: { name: before.name, status: before.status },
      afterData: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  /* ---------- Gắn / gỡ thẻ MỘ ---------- */

  async listPlotTags(gravePlotId: string, caller: Caller) {
    await this.assertPlotScope(gravePlotId, caller);
    return this.prisma.gravePlotTag.findMany({
      where: { gravePlotId, ...activeTag },
      include: { tagType: true },
      orderBy: { assignedAt: 'asc' },
    });
  }

  async assignPlotTag(gravePlotId: string, dto: AssignTagDto, caller: Caller) {
    const plot = await this.assertPlotScope(gravePlotId, caller);
    /* KHÔNG cần kiểm "thẻ này có phải thẻ mộ không" — khoá ngoại đã lo. `findUnique` trên
     * đúng bảng danh mục thẻ mộ trả `null` cho một id thuộc danh mục khách. */
    const tagType = await this.prisma.gravePlotTagType.findUnique({
      where: { id: dto.tagTypeId },
    });
    const tag = this.requireUsable(tagType, 'phần mộ');

    const created = await this.wrapAlreadyAssigned(
      () =>
        this.prisma.gravePlotTag.create({
          data: { id: ulid(), gravePlotId, tagTypeId: tag.id, assignedBy: caller.userId },
        }),
      tag.name,
    );
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'PLOT_TAG.ASSIGNED',
      entityType: 'grave_plot_tag',
      entityId: created.id,
      afterData: { gravePlotId, plotCode: plot.plotCode, tagCode: tag.code },
    });
    return created;
  }

  async removePlotTag(gravePlotId: string, tagTypeId: string, dto: RemoveTagDto, caller: Caller) {
    const plot = await this.assertPlotScope(gravePlotId, caller);
    const row = await this.prisma.gravePlotTag.findFirst({
      where: { gravePlotId, tagTypeId, ...activeTag },
      include: { tagType: { select: { code: true } } },
    });
    if (row === null) {
      throw new NotFoundException('Phần mộ này không đang mang thẻ đó');
    }
    /* GỠ = ghi `removedAt`, KHÔNG xoá dòng. Anh Bách chốt "lưu vết" — gỡ `#can-sua-bia` rồi
     * thì vẫn phải trả lời được "bia này đã sửa chưa, ai xác nhận, ngày nào". */
    const updated = await this.prisma.gravePlotTag.update({
      where: { id: row.id },
      data: {
        removedAt: new Date(),
        removedBy: caller.userId,
        removeReason: dto.reason ?? null,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'PLOT_TAG.REMOVED',
      entityType: 'grave_plot_tag',
      entityId: row.id,
      afterData: {
        gravePlotId,
        plotCode: plot.plotCode,
        tagCode: row.tagType.code,
        reason: updated.removeReason,
      },
    });
    return updated;
  }

  /* ---------- Gắn / gỡ thẻ KHÁCH ---------- */

  async listCustomerTags(customerId: string, caller: Caller) {
    await this.assertCustomerScope(customerId, caller);
    return this.prisma.customerTag.findMany({
      where: { customerId, ...activeTag },
      include: { tagType: true },
      orderBy: { assignedAt: 'asc' },
    });
  }

  async assignCustomerTag(customerId: string, dto: AssignTagDto, caller: Caller) {
    await this.assertCustomerScope(customerId, caller);
    const tagType = await this.prisma.customerTagType.findUnique({ where: { id: dto.tagTypeId } });
    const tag = this.requireUsable(tagType, 'khách hàng');

    const created = await this.wrapAlreadyAssigned(
      () =>
        this.prisma.customerTag.create({
          data: { id: ulid(), customerId, tagTypeId: tag.id, assignedBy: caller.userId },
        }),
      tag.name,
    );
    /* Nhật ký kiểm toán cho MỌI lần gắn thẻ khách — không chỉ dựa vào bảng lưu vết.
     *
     * NĐ 13/2023 cho chủ thể dữ liệu quyền biết dữ liệu của mình được xử lý thế nào. Câu
     * "ai đã gắn nhãn này lên tôi, ngày nào" phải trả lời được ngay cả khi hồ sơ khách đã bị
     * xoá — thẻ xoá theo khách, nhật ký thì không. */
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CUSTOMER_TAG.ASSIGNED',
      entityType: 'customer_tag',
      entityId: created.id,
      afterData: { customerId, tagCode: tag.code, subject: tagType?.subject ?? null },
    });
    return created;
  }

  async removeCustomerTag(
    customerId: string,
    tagTypeId: string,
    dto: RemoveTagDto,
    caller: Caller,
  ) {
    await this.assertCustomerScope(customerId, caller);
    const row = await this.prisma.customerTag.findFirst({
      where: { customerId, tagTypeId, ...activeTag },
      include: { tagType: { select: { code: true } } },
    });
    if (row === null) {
      throw new NotFoundException('Khách hàng này không đang mang thẻ đó');
    }
    const updated = await this.prisma.customerTag.update({
      where: { id: row.id },
      data: {
        removedAt: new Date(),
        removedBy: caller.userId,
        removeReason: dto.reason ?? null,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CUSTOMER_TAG.REMOVED',
      entityType: 'customer_tag',
      entityId: row.id,
      afterData: { customerId, tagCode: row.tagType.code, reason: updated.removeReason },
    });
    return updated;
  }

  /* ---------- Dùng chung ---------- */

  private patch(dto: UpdateTagTypeDto) {
    return {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
  }

  /* Thẻ có thật trong ĐÚNG danh mục, và còn dùng.
   *
   * `null` ở đây mang hai nghĩa gộp làm một, và gộp được vì hậu quả giống nhau: hoặc thẻ
   * không tồn tại, hoặc nó thuộc danh mục KIA. Câu trả lời cho người dùng là một: thẻ này
   * không dùng cho chỗ này. */
  private requireUsable<T extends { id: string; code: string; name: string; status: string }>(
    tagType: T | null,
    what: string,
  ): T {
    if (tagType === null) {
      throw new NotFoundException(`Không tìm thấy thẻ nhãn này trong danh mục thẻ ${what}`);
    }
    if (tagType.status !== 'Active') {
      throw new ConflictException(`Thẻ "${tagType.name}" đã ngừng dùng — không gắn mới được`);
    }
    return tagType;
  }

  /* Phạm vi của thẻ mộ = phạm vi của PHẦN MỘ nó dán lên: công ty VÀ nghĩa trang.
   *
   * Bó cả hai, không chỉ công ty: vai quản lý nghĩa trang có phạm vi SITE, và thẻ mộ kể tình
   * trạng thực địa. Chỉ bó công ty là người phụ trách nghĩa trang A đọc được — và sửa được —
   * tình trạng thực địa của nghĩa trang B.
   */
  private async assertPlotScope(gravePlotId: string, caller: Caller) {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      select: { id: true, companyId: true, cemeteryId: true, plotCode: true },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy lô mộ');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, plot.companyId);
    await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
    return plot;
  }

  /* Khách hàng chỉ có `companyId`, không có nghĩa trang — nên một `assertCompanyFor`.
   * `companyId` cho phép NULL (quyết định đã ghi 26/08/2026), và `assertCompanyFor` xử lý ca
   * đó theo đúng nếp mọi service khác. */
  private async assertCustomerScope(customerId: string, caller: Caller) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, companyId: true },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, customer.companyId);
    return customer;
  }

  /* Mã thẻ trùng — dịch `P2002` thô của Postgres ra một câu tiếng Việt.
   *
   * Mã duy nhất TOÀN HỆ trong từng danh mục: đây là cái lưới giữ cho `VIP` không sinh ra bản
   * sao. Hai danh mục có hai không gian mã riêng, nên một thẻ mộ và một thẻ khách trùng mã
   * nhau là chuyện bình thường, không gây nhầm. */
  private async wrapDuplicateCode<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Mã thẻ này đã có trong danh mục');
      }
      throw e;
    }
  }

  /* Gắn trùng thẻ đang có — thua ở partial unique index, không ở kiểm-rồi-ghi.
   *
   * Kiểm trước rồi ghi vẫn lọt khi hai người bấm cùng lúc (TOCTOU); ràng buộc CSDL thì
   * không. Ở đây chỉ dịch lỗi cho người dùng đọc được. */
  private async wrapAlreadyAssigned<T>(fn: () => Promise<T>, tagName: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Đang mang thẻ "${tagName}" rồi`);
      }
      throw e;
    }
  }
}
