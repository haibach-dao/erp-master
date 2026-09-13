import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { IMPLEMENTED_CHANNELS, pollAndDispatch } from './dispatcher';

/* Vòng quét outbox từng đánh dấu SENT cho những kênh CHƯA HỀ được dựng (INAPP có
 * `case` rỗng, WEBHOOK không có `case` nào). Dòng đã SENT không bao giờ được quét
 * lại ⇒ nhắc hạn dịch vụ mất vĩnh viễn, không lastError, không dấu vết.
 *
 * Luật mới: vòng quét CHỈ lấy các kênh đã dựng thật. Kênh chưa dựng nằm nguyên
 * PENDING (không mất, xử lý ngược lại được khi bật kênh) và phải được ĐẾM + KÊU LÊN.
 */

interface Row {
  id: string;
  channel: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  processedAt: Date | null;
  createdAt: Date;
}

interface ChannelFilter {
  in?: string[];
  notIn?: string[];
}

interface OutboxWhere {
  status?: string;
  channel?: string | ChannelFilter;
}

let seq = 0;

function row(partial: Partial<Row> & { channel: string }): Row {
  seq += 1;
  return {
    id: `evt-${seq}`,
    payload: {},
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 10,
    lastError: null,
    processedAt: null,
    createdAt: new Date(2026, 0, 1, 0, 0, seq),
    ...partial,
  };
}

function matches(r: Row, where: OutboxWhere | undefined): boolean {
  if (where === undefined) {
    return true;
  }
  if (where.status !== undefined && r.status !== where.status) {
    return false;
  }
  const ch = where.channel;
  if (typeof ch === 'string') {
    return r.channel === ch;
  }
  if (ch !== undefined) {
    if (ch.in !== undefined && !ch.in.includes(r.channel)) {
      return false;
    }
    if (ch.notIn !== undefined && ch.notIn.includes(r.channel)) {
      return false;
    }
  }
  return true;
}

/** Prisma giả có TÔN TRỌNG mệnh đề where — nếu không thì bài kiểm tra này vô nghĩa. */
function build(rows: Row[]) {
  const store = rows;
  const prisma = {
    outboxEvent: {
      findMany: vi.fn(({ where, take }: { where?: OutboxWhere; take?: number }) =>
        Promise.resolve(
          store
            .filter((r) => matches(r, where))
            .slice(0, take ?? 50)
            .map((r) => ({ ...r })),
        ),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const target = store.find((r) => r.id === where.id);
        if (target === undefined) {
          throw new Error(`Prisma giả: không có dòng ${where.id}`);
        }
        Object.assign(target, data);
        return Promise.resolve({ ...target });
      }),
      groupBy: vi.fn(({ where }: { where?: OutboxWhere }) => {
        const counts = new Map<string, number>();
        for (const r of store.filter((x) => matches(x, where))) {
          counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
        }
        return Promise.resolve(
          [...counts].map(([channel, n]) => ({ channel, _count: { _all: n } })),
        );
      }),
    },
  };
  const mailer = { sendMail: vi.fn().mockResolvedValue({}) };
  const logged: string[] = [];
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    mailer: mailer as unknown as Parameters<typeof pollAndDispatch>[0]['mailer'],
    log: (message: string) => logged.push(message),
  };
  return { deps, store, prisma, mailer, logged };
}

function find(store: Row[], id: string): Row {
  const r = store.find((x) => x.id === id);
  if (r === undefined) {
    throw new Error(`không thấy dòng ${id}`);
  }
  return r;
}

describe('pollAndDispatch — kênh chưa dựng thì KHÔNG được đánh dấu đã gửi', () => {
  it('dòng INAPP vẫn PENDING sau khi quét, không SENT, không processedAt, không tăng attempts', async () => {
    const inapp = row({ channel: 'INAPP', payload: { subscriptionId: 's1', daysUntil: 30 } });
    const { deps, store } = build([inapp]);

    const res = await pollAndDispatch(deps);

    const after = find(store, inapp.id);
    expect(after.status).toBe('PENDING');
    expect(after.status).not.toBe('SENT');
    expect(after.processedAt).toBeNull();
    expect(after.attempts).toBe(0);
    expect(res.sent).toBe(0);
    expect(res.processed).toBe(0);
  });

  it('dòng WEBHOOK không bị nướng 10 lần rồi DEAD — nó cũng chỉ là kênh chưa dựng', async () => {
    const hook = row({ channel: 'WEBHOOK', maxAttempts: 1 });
    const { deps, store } = build([hook]);

    const res = await pollAndDispatch(deps);

    const after = find(store, hook.id);
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();
    expect(res.dead).toBe(0);
  });

  it('EMAIL vẫn gửi bình thường — chốt chặn không được chặn nhầm kênh đã dựng', async () => {
    const mail = row({ channel: 'EMAIL', payload: { to: 'a@b.vn', subject: 'chào', text: 'x' } });
    const { deps, store, mailer } = build([mail]);

    const res = await pollAndDispatch(deps);

    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.vn', subject: 'chào' }),
    );
    const after = find(store, mail.id);
    expect(after.status).toBe('SENT');
    expect(after.attempts).toBe(1);
    expect(res.sent).toBe(1);
  });

  it('EMAIL hỏng vẫn dead-letter đúng như cũ', async () => {
    const bad = row({ channel: 'EMAIL', payload: {}, maxAttempts: 1 });
    const { deps, store } = build([bad]);

    const res = await pollAndDispatch(deps);

    const after = find(store, bad.id);
    expect(after.status).toBe('DEAD');
    expect(after.lastError).toContain('to');
    expect(res.dead).toBe(1);
  });

  it('đếm đúng số dòng bị bỏ qua, gộp cả INAPP lẫn WEBHOOK', async () => {
    const { deps } = build([
      row({ channel: 'INAPP' }),
      row({ channel: 'INAPP' }),
      row({ channel: 'WEBHOOK' }),
      row({ channel: 'EMAIL', payload: { to: 'a@b.vn' } }),
      row({ channel: 'INAPP', status: 'SENT' }), // đã xử lý xong từ trước, không đếm nữa
    ]);

    const res = await pollAndDispatch(deps);

    expect(res.skipped).toBe(3);
    expect(res.sent).toBe(1);
  });

  it('không im lặng: kêu lên bằng tiếng Việt, có số lượng và tên kênh', async () => {
    const { deps, logged } = build([row({ channel: 'INAPP' }), row({ channel: 'INAPP' })]);

    await pollAndDispatch(deps);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('2');
    expect(logged[0]).toContain('INAPP');
    expect(logged[0]).toMatch(/chờ|đang chờ/);
  });

  it('không có dòng nào bị bỏ qua thì không kêu, và skipped = 0', async () => {
    const { deps, logged } = build([row({ channel: 'EMAIL', payload: { to: 'a@b.vn' } })]);

    const res = await pollAndDispatch(deps);

    expect(res.skipped).toBe(0);
    expect(logged).toHaveLength(0);
  });
});

/* Đây là phần chống LỚP lỗi, không phải một ca lẻ: danh sách kênh được quét phải suy
 * ra từ CHÍNH bảng định tuyến. Thêm kênh mới mà quên viết mã gửi thì gãy ngay ở chỗ
 * khai báo, chứ không âm thầm đánh SENT như trước.
 */
describe('IMPLEMENTED_CHANNELS — một nguồn sự thật duy nhất', () => {
  it('vòng quét lọc đúng bằng danh sách kênh đã dựng, không phải danh sách gõ tay', async () => {
    const { deps, prisma } = build([row({ channel: 'EMAIL', payload: { to: 'a@b.vn' } })]);

    await pollAndDispatch(deps);

    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', channel: { in: [...IMPLEMENTED_CHANNELS] } },
      }),
    );
  });

  it('INAPP và WEBHOOK chưa nằm trong danh sách kênh đã dựng', () => {
    expect([...IMPLEMENTED_CHANNELS]).not.toContain('INAPP');
    expect([...IMPLEMENTED_CHANNELS]).not.toContain('WEBHOOK');
    expect([...IMPLEMENTED_CHANNELS]).toContain('EMAIL');
  });
});
