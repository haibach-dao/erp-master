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
  const badId = ulid();
  await prisma.outboxEvent.create({
    data: {
      id: badId,
      aggregateType: 'test',
      aggregateId: '2',
      eventType: 'SMOKE.BAD',
      channel: 'BOGUS',
      payload: {},
      maxAttempts: 1,
    },
  });

  const result = await pollAndDispatch({ prisma, mailer });

  const after = await mailpitCount();
  const bad = await prisma.outboxEvent.findUnique({ where: { id: badId } });
  const emailOk = after === before + 1 && result.sent >= 1;
  const deadOk =
    bad?.status === 'DEAD' &&
    bad.attempts === 1 &&
    (bad.lastError ?? '').includes('Unknown channel');

  console.log(
    `emailOk=${emailOk} deadOk=${deadOk} processed=${result.processed} sent=${result.sent} dead=${result.dead}`,
  );
  await prisma.$disconnect();
  if (!emailOk || !deadOk) {
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
