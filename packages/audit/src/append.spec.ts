import { describe, expect, it, vi } from 'vitest';
import { appendAuditEvent, utcDateOnly, type AuditWriteClient } from './append';

function client(prevHash: string | null) {
  const create = vi.fn().mockResolvedValue(undefined);
  const findFirst = vi.fn().mockResolvedValue(prevHash === null ? null : { eventHash: prevHash });
  return {
    api: { auditEvent: { findFirst, create } } as unknown as AuditWriteClient,
    create,
    findFirst,
  };
}

const BASE = {
  companyId: 'co-1',
  actorType: 'USER' as const,
  actorId: 'u1',
  action: 'GRAVE.HOLD_EXPIRED',
  entityType: 'grave_plot',
  entityId: 'plot-1',
};

function dataOf(create: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
}

describe('appendAuditEvent — móc chuỗi hash', () => {
  it('sự kiện đầu tiên trong phân đoạn có previousEventHash = null', async () => {
    const { api, create } = client(null);
    await appendAuditEvent(api, 'ev-1', BASE);
    expect(dataOf(create).previousEventHash).toBeNull();
    expect(dataOf(create).eventHash).toEqual(expect.any(String));
  });

  it('sự kiện sau móc vào hash của sự kiện trước', async () => {
    const { api, create } = client('hash-truoc');
    await appendAuditEvent(api, 'ev-2', BASE);
    expect(dataOf(create).previousEventHash).toBe('hash-truoc');
  });

  it('đổi hash của sự kiện trước thì hash của sự kiện này cũng đổi — đó là điểm mạnh', async () => {
    const a = client('hash-A');
    const b = client('hash-B');
    await appendAuditEvent(a.api, 'ev-x', BASE);
    await appendAuditEvent(b.api, 'ev-x', BASE);
    expect(dataOf(a.create).eventHash).not.toBe(dataOf(b.create).eventHash);
  });

  it('phân đoạn theo (công ty, ngày UTC) — worker và API phải cùng khoá này', async () => {
    const { api, findFirst } = client(null);
    await appendAuditEvent(api, 'ev-3', BASE);
    const where = (findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where.companyId).toBe('co-1');
    expect(where.chainPartitionDateUtc).toEqual(utcDateOnly(new Date()));
  });
});

/* Ghế máy ghi vào CÙNG chuỗi với người dùng. Nếu `AGENT` bị coi là không hợp lệ hoặc bị
 * đổi thầm thành `SYSTEM`, ta mất đúng thứ cần: một danh tính tra cứu được đứng sau
 * hành vi của tiến trình nền.
 */
describe('appendAuditEvent — ghế máy', () => {
  it('giữ nguyên actorType AGENT và actorId của ghế máy', async () => {
    const { api, create } = client(null);
    await appendAuditEvent(api, 'ev-4', {
      ...BASE,
      actorType: 'AGENT',
      actorId: 'agent-1',
      source: 'JOB',
    });
    expect(dataOf(create)).toMatchObject({
      actorType: 'AGENT',
      actorId: 'agent-1',
      source: 'JOB',
    });
  });

  it('AGENT và SYSTEM cho ra hash khác nhau — không thể lẫn hai loại chủ thể', async () => {
    const a = client(null);
    const b = client(null);
    await appendAuditEvent(a.api, 'ev-5', { ...BASE, actorType: 'AGENT' });
    await appendAuditEvent(b.api, 'ev-5', { ...BASE, actorType: 'SYSTEM' });
    expect(dataOf(a.create).eventHash).not.toBe(dataOf(b.create).eventHash);
  });
});

describe('appendAuditEvent — mask trước khi lưu', () => {
  it('che dữ liệu nhạy cảm trong beforeData/afterData', async () => {
    const { api, create } = client(null);
    await appendAuditEvent(api, 'ev-6', {
      ...BASE,
      afterData: { nationalId: '079123456789', status: 'Available' },
    });
    const after = dataOf(create).afterData as Record<string, unknown>;
    expect(after.nationalId).not.toBe('079123456789');
    expect(after.status).toBe('Available');
  });

  it('không tự thêm beforeData/afterData khi người gọi không truyền', async () => {
    const { api, create } = client(null);
    await appendAuditEvent(api, 'ev-7', BASE);
    expect(dataOf(create)).not.toHaveProperty('afterData');
    expect(dataOf(create)).not.toHaveProperty('beforeData');
  });

  it('mặc định result = SUCCESS, source = API', async () => {
    const { api, create } = client(null);
    await appendAuditEvent(api, 'ev-8', BASE);
    expect(dataOf(create)).toMatchObject({ result: 'SUCCESS', source: 'API' });
  });
});
