import type { PrismaClient } from '@prisma/client';
import type { Transporter } from 'nodemailer';

interface EmailPayload {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface DispatchDeps {
  prisma: PrismaClient;
  mailer: Transporter;
  batchSize?: number;
  /** Chỗ kêu lên khi có dòng bị bỏ qua. Mặc định ra log worker; test truyền hàm giả. */
  log?: (message: string) => void;
}

export interface DispatchResult {
  processed: number;
  sent: number;
  dead: number;
  /** Số dòng PENDING thuộc kênh CHƯA dựng — chưa gửi, chưa mất, vẫn nằm đó chờ. */
  skipped: number;
}

interface ChannelContext {
  mailer: Transporter;
}

type ChannelHandler = (payload: unknown, ctx: ChannelContext) => Promise<void>;

/* MỘT NƠI DUY NHẤT khai kênh đã dựng thật.
 *
 * Bảng này vừa là bảng định tuyến, vừa là bộ lọc của vòng quét — IMPLEMENTED_CHANNELS
 * bên dưới suy ra từ chính khoá của nó, không gõ tay lần thứ hai. Nhờ vậy KHÔNG có cách
 * nào để một kênh lọt vào vòng quét mà chưa có mã gửi: muốn được quét thì phải đặt hàm
 * gửi vào đây.
 *
 * Kênh chưa có mặt ở đây (INAPP, WEBHOOK) sẽ KHÔNG bị quét: dòng nằm nguyên PENDING —
 * không bị đánh dấu SENT dối (mất vĩnh viễn), cũng không bị nướng đủ maxAttempts rồi
 * DEAD. Khi kênh được dựng, thêm hàm vào đây là toàn bộ tồn đọng được xử lý ngược lại.
 */
const CHANNEL_HANDLERS: Record<string, ChannelHandler | undefined> = {
  EMAIL: async (payload, { mailer }) => {
    const p = payload as EmailPayload;
    if (p.to === undefined || p.to.length === 0) {
      throw new Error('Thiếu người nhận trong nội dung EMAIL (trường "to")');
    }
    await mailer.sendMail({
      from: process.env.MAIL_FROM ?? 'no-reply@erp.local',
      to: p.to,
      subject: p.subject ?? '(no subject)',
      text: p.text,
      html: p.html,
    });
  },
};

/** Danh sách kênh đã dựng thật, suy ra từ bảng định tuyến ở trên. */
export const IMPLEMENTED_CHANNELS: readonly string[] = Object.keys(CHANNEL_HANDLERS);

// Deliver one outbox row by channel. Throw to signal failure (caller records the attempt).
async function dispatchOne(
  row: { channel: string; payload: unknown },
  mailer: Transporter,
): Promise<void> {
  const handler = CHANNEL_HANDLERS[row.channel];
  if (handler === undefined) {
    // Vòng quét đã lọc theo IMPLEMENTED_CHANNELS nên đường này lẽ ra không tới được.
    // Giữ lại làm chốt chặn cho ai gọi thẳng dispatchOne.
    throw new Error(`Kênh chưa được dựng nên không gửi được: ${row.channel}`);
  }
  await handler(row.payload, { mailer });
}

/* Đếm và KÊU LÊN số dòng đang nằm chờ vì kênh chưa dựng. Im lặng chính là con bệnh cũ:
 * trước đây nhắc hạn dịch vụ biến mất mà không ai biết. */
async function reportSkipped(
  prisma: PrismaClient,
  log: (message: string) => void,
): Promise<number> {
  const groups = await prisma.outboxEvent.groupBy({
    by: ['channel'],
    where: { status: 'PENDING', channel: { notIn: [...IMPLEMENTED_CHANNELS] } },
    _count: { _all: true },
  });

  let total = 0;
  const parts: string[] = [];
  for (const g of groups) {
    const n = g._count._all;
    total += n;
    parts.push(`${n} dòng ${g.channel}`);
  }

  if (total > 0) {
    log(
      `[worker] outbox: còn ${parts.join(', ')} đang chờ dựng kênh — chưa gửi, KHÔNG mất, ` +
        `sẽ gửi lại được toàn bộ khi kênh được bật.`,
    );
  }
  return total;
}

// Poll PENDING outbox rows and dispatch them at-least-once. On failure, increment
// attempts; once attempts >= maxAttempts the row is dead-lettered (status DEAD).
// Chỉ quét các kênh có trong IMPLEMENTED_CHANNELS — xem chú thích ở CHANNEL_HANDLERS.
// Single-worker safe; multi-worker needs SELECT ... FOR UPDATE SKIP LOCKED (follow-up).
export async function pollAndDispatch(deps: DispatchDeps): Promise<DispatchResult> {
  const { prisma, mailer } = deps;
  const log =
    deps.log ??
    ((message: string) => {
      console.warn(message);
    });

  const rows = await prisma.outboxEvent.findMany({
    where: { status: 'PENDING', channel: { in: [...IMPLEMENTED_CHANNELS] } },
    orderBy: { createdAt: 'asc' },
    take: deps.batchSize ?? 50,
  });

  let sent = 0;
  let dead = 0;
  for (const row of rows) {
    try {
      await dispatchOne(row, mailer);
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: 'SENT', attempts: row.attempts + 1, processedAt: new Date() },
      });
      sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const isDead = attempts >= row.maxAttempts;
      if (isDead) {
        dead += 1;
      }
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts,
          status: isDead ? 'DEAD' : 'PENDING',
          lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          ...(isDead ? { processedAt: new Date() } : {}),
        },
      });
    }
  }

  const skipped = await reportSkipped(prisma, log);
  return { processed: rows.length, sent, dead, skipped };
}
