/* Integration smoke for the outbox dispatcher (run against docker postgres + mailpit):
 *   DATABASE_URL=... pnpm --filter @erp/worker exec tsx scripts/worker-smoke.ts
 * Calls pollAndDispatch directly (no BullMQ scheduling) to verify dispatch + dead-letter.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { pollAndDispatch } from '../src/dispatcher';
import { createMailer } from '../src/mailer';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

async function mailpitCount(): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/messages`);
  const body = (await res.json()) as { total: number };
  return body.total;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const mailer = createMailer();

  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }); // clear mailbox
  const before = await mailpitCount();

  const subject = `smoke-${Date.now()}`;
  await prisma.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: 'test',
      aggregateId: '1',
      eventType: 'SMOKE.EMAIL',
      channel: 'EMAIL',
      payload: { to: 'user@example.com', subject, text: 'hello from worker' },
    },
  });
  /* DEAD-LETTER phải thử bằng một kênh ĐÃ DỰNG mà nội dung hỏng, KHÔNG bằng một kênh lạ.
   *
   * Bản trước dùng `channel: 'BOGUS'` và đòi nó thành DEAD kèm chữ "Unknown channel". Từ
   * 09/09/2026 luật đổi: vòng quét chỉ lấy kênh có trong `IMPLEMENTED_CHANNELS`, nên dòng kênh
   * lạ KHÔNG được quét — nó nằm im PENDING, đúng như thiết kế. Giữ nguyên phép thử cũ là để
   * bộ smoke DUY NHẤT của dispatcher đỏ vĩnh viễn vì một hành vi cố ý; mà nó là script chạy
   * tay, không cổng CI nào gọi, nên nó sẽ đỏ trong im lặng tới ngày ai đó cần tới nó nhất.
   *
   * EMAIL thiếu `to` là ca hỏng THẬT của một kênh thật: handler ném, `attempts` lên 1, chạm
   * `maxAttempts` nên vào DEAD. Đó mới là thứ đường dead-letter sinh ra để đỡ. */
  const badId = ulid();
  await prisma.outboxEvent.create({
    data: {
      id: badId,
      aggregateType: 'test',
      aggregateId: '2',
      eventType: 'SMOKE.BAD',
      channel: 'EMAIL',
      payload: {},
      maxAttempts: 1,
    },
  });

  /* Kênh CHƯA DỰNG: phải nằm im PENDING và được ĐẾM vào `skipped` — không SENT dối (mất vĩnh
   * viễn), không bị nướng đủ lượt rồi DEAD. Đây là luật mới, nên nó phải có mặt trong chính
   * bộ smoke chạy trên CSDL thật, không chỉ trong test mock. */
  const pendingId = ulid();
  await prisma.outboxEvent.create({
    data: {
      id: pendingId,
      aggregateType: 'test',
      aggregateId: '3',
      eventType: 'SMOKE.INAPP',
      channel: 'INAPP',
      payload: { note: 'kênh chưa dựng' },
      maxAttempts: 1,
    },
  });

  const result = await pollAndDispatch({ prisma, mailer });

  const after = await mailpitCount();
  const bad = await prisma.outboxEvent.findUnique({ where: { id: badId } });
  const held = await prisma.outboxEvent.findUnique({ where: { id: pendingId } });
  const emailOk = after === before + 1 && result.sent >= 1;
  const deadOk = bad?.status === 'DEAD' && bad.attempts === 1 && (bad.lastError ?? '') !== '';
  const heldOk =
    held?.status === 'PENDING' &&
    held.attempts === 0 &&
    held.processedAt === null &&
    result.skipped >= 1;

  console.log(
    `emailOk=${emailOk} deadOk=${deadOk} heldOk=${heldOk} processed=${result.processed} sent=${result.sent} dead=${result.dead} skipped=${result.skipped}`,
  );

  // Dọn dòng INAPP vừa nạp: nó CỐ Ý không được xử lý, nên để lại là bỏ rác vào tồn đọng thật.
  await prisma.outboxEvent.delete({ where: { id: pendingId } });
  await prisma.$disconnect();
  if (!emailOk || !deadOk || !heldOk) {
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
