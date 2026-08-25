import { computeEventHash } from './integrity';
import { maskSensitive } from './masking';

/* Ai gây ra sự kiện.
 *
 * `AGENT` là ghế máy — tiến trình nền chạy dưới một danh tính có thật, mang quyền riêng.
 * Nó KHÔNG phải `SYSTEM`: `SYSTEM` là "hệ tự làm, không ai chịu trách nhiệm", đúng cái
 * trạng thái mà ghế máy sinh ra để chấm dứt. Phân biệt được hai thứ này thì mới trả lời
 * được câu "ai giải phóng lô mộ này" bằng một danh tính tra cứu được.
 */
export type AuditActorType = 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE' | 'IMPERSONATION';

export interface AppendAuditInput {
  companyId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  /** Ví dụ `GRAVE.HOLD_EXPIRED`. */
  action: string;
  entityType: string;
  entityId: string;
  result?: string;
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  changedFields?: string[];
  correlationId?: string | null;
  ipAddress?: string | null;
  source?: string;
}

/** Chỉ những gì hàm này cần từ Prisma — nhận cả `PrismaClient` lẫn client giao dịch. */
export interface AuditWriteClient {
  auditEvent: {
    findFirst(args: unknown): Promise<{ eventHash: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
}

/** Ngày UTC của một mốc thời gian — khoá phân đoạn của chuỗi hash. */
export function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/* Ghi thêm MỘT sự kiện, móc hash vào sự kiện trước trong cùng phân đoạn (công ty, ngày UTC).
 *
 * Người gọi truyền vào `newId` thay vì để hàm tự sinh: API dùng ULID, worker cũng vậy,
 * nhưng package này không nên kéo theo một phụ thuộc sinh id chỉ để làm việc đó.
 *
 * KHÔNG mở transaction ở đây. Người gọi quyết định phạm vi giao dịch — API bọc trong
 * `$transaction` để đọc-hash-ghi là nguyên tử, worker cũng thế. Tự mở transaction ở đây
 * sẽ tạo transaction lồng nhau ở phía API.
 */
export async function appendAuditEvent(
  client: AuditWriteClient,
  newId: string,
  input: AppendAuditInput,
): Promise<{ id: string; eventHash: string; previousEventHash: string | null }> {
  const occurredAt = new Date();
  const partition = utcDateOnly(occurredAt);
  const companyId = input.companyId ?? null;
  const result = input.result ?? 'SUCCESS';
  const source = input.source ?? 'API';
  const changedFields = input.changedFields ?? [];
  const maskedBefore = input.beforeData === undefined ? undefined : maskSensitive(input.beforeData);
  const maskedAfter = input.afterData === undefined ? undefined : maskSensitive(input.afterData);

  const prev = await client.auditEvent.findFirst({
    where: { companyId, chainPartitionDateUtc: partition },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { eventHash: true },
  });
  const previousEventHash = prev?.eventHash ?? null;

  const eventHash = computeEventHash({
    previousEventHash,
    occurredAt: occurredAt.toISOString(),
    companyId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    result,
    changedFields,
    afterData: maskedAfter ?? null,
  });

  await client.auditEvent.create({
    data: {
      id: newId,
      occurredAt,
      chainPartitionDateUtc: partition,
      companyId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      result,
      reason: input.reason ?? null,
      changedFields,
      correlationId: input.correlationId ?? null,
      ipAddress: input.ipAddress ?? null,
      source,
      previousEventHash,
      eventHash,
      hashAlgorithmVersion: 1,
      ...(maskedBefore !== undefined ? { beforeData: maskedBefore } : {}),
      ...(maskedAfter !== undefined ? { afterData: maskedAfter } : {}),
    },
  });

  return { id: newId, eventHash, previousEventHash };
}
