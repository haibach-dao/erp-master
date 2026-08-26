import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuditQueryDto } from './dto/audit-query.dto';
import {
  entityLabelFor,
  entityTypeLabel,
  resolveActorLabels,
  resolveEntityLabels,
} from './audit-labels';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // Read-only, paginated, filtered audit query. Newest first.
  async query(q: AuditQueryDto): Promise<{
    data: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Prisma.AuditEventWhereInput = {};
    if (q.companyId !== undefined) where.companyId = q.companyId;
    if (q.actorId !== undefined) where.actorId = q.actorId;
    if (q.action !== undefined) where.action = q.action;
    if (q.entityType !== undefined) where.entityType = q.entityType;
    if (q.entityId !== undefined) where.entityId = q.entityId;
    if (q.result !== undefined) where.result = q.result;
    if (q.correlationId !== undefined) where.correlationId = q.correlationId;
    if (q.from !== undefined || q.to !== undefined) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (q.from !== undefined) occurredAt.gte = new Date(q.from);
      if (q.to !== undefined) occurredAt.lte = new Date(q.to);
      where.occurredAt = occurredAt;
    }

    const page = q.page;
    const pageSize = q.pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    /* Bổ nhãn đọc được. Hai lượt tra cho CẢ trang, không phải mỗi dòng một lượt.
     *
     * Giữ nguyên `actorId`/`entityId` bên cạnh nhãn: nhãn để người đọc, id để đối chiếu
     * và để lọc. Thay id bằng nhãn là làm nhật ký đẹp hơn nhưng mất khả năng truy vết —
     * hai người trùng tên thì không còn phân biệt được. */
    const [actorLabels, entityLabels] = await Promise.all([
      resolveActorLabels(this.prisma, rows),
      resolveEntityLabels(this.prisma, rows),
    ]);

    const data = rows.map((row) => ({
      ...row,
      actorLabel: row.actorId === null ? null : (actorLabels.get(row.actorId) ?? null),
      entityTypeLabel: entityTypeLabel(row.entityType),
      entityLabel: entityLabelFor(entityLabels, row.entityType, row.entityId),
    }));

    return { data, total, page, pageSize };
  }

  /* Các giá trị CÓ THẬT trong nhật ký, để giao diện dựng ô chọn.
   *
   * Vì sao không lấy từ danh mục cứng: danh mục hành động có gần 40 mã, phần lớn chưa
   * từng xảy ra ở một hệ mới triển khai. Ô chọn liệt kê 40 dòng mà 35 dòng lọc ra rỗng
   * thì người dùng phải thử từng cái mới biết cái nào có dữ liệu.
   *
   * Vì sao không để giao diện tự gõ: `PERSON.BANK_ACCOUNT_DEACTIVATED` gõ sai một ký tự
   * là lọc ra rỗng, và rỗng thì không phân biệt được với "không có sự kiện nào".
   *
   * Kèm số lượng để người rà soát biết nên nhìn đâu trước.
   */
  async facets(): Promise<{
    actors: { id: string; label: string; count: number }[];
    actions: { code: string; count: number }[];
    entityTypes: { code: string; label: string; count: number }[];
    results: { code: string; count: number }[];
  }> {
    const [actorRows, actionRows, entityRows, resultRows] = await Promise.all([
      this.prisma.auditEvent.groupBy({ by: ['actorId'], _count: { _all: true } }),
      this.prisma.auditEvent.groupBy({ by: ['action'], _count: { _all: true } }),
      this.prisma.auditEvent.groupBy({ by: ['entityType'], _count: { _all: true } }),
      this.prisma.auditEvent.groupBy({ by: ['result'], _count: { _all: true } }),
    ]);

    const actorIds = actorRows.map((r) => r.actorId).filter((id): id is string => id !== null);
    const users =
      actorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true },
          });
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    return {
      /* Bỏ dòng `actorId = null` (việc do hệ thống sinh): không lọc theo "không có ai"
       * được, vì DTO nhận chuỗi. Muốn xem việc của tiến trình nền thì đó là bộ lọc khác. */
      actors: actorRows
        .filter((r): r is typeof r & { actorId: string } => r.actorId !== null)
        .map((r) => ({
          id: r.actorId,
          label: emailById.get(r.actorId) ?? r.actorId,
          count: r._count._all,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
      actions: actionRows
        .map((r) => ({ code: r.action, count: r._count._all }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      entityTypes: entityRows
        .map((r) => ({
          code: r.entityType,
          label: entityTypeLabel(r.entityType),
          count: r._count._all,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
      results: resultRows
        .map((r) => ({ code: r.result, count: r._count._all }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  }
}
