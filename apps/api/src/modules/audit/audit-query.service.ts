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
}
