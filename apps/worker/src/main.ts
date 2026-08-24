import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { pollAndDispatch } from './dispatcher';
import { expireHolds } from './hold-expiry';
import { createMailer } from './mailer';

const QUEUE = 'maintenance';
const OUTBOX_JOB = 'outbox-dispatch';
const HOLD_EXPIRY_JOB = 'hold-expiry';
const POLL_EVERY_MS = 5000;
const HOLD_EXPIRY_EVERY_MS = 60000;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const mailer = createMailer();
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const queue = new Queue(QUEUE, { connection });
  // Repeatable poll of the transactional outbox.
  await queue.add(
    OUTBOX_JOB,
    {},
    { repeat: { every: POLL_EVERY_MS }, jobId: OUTBOX_JOB, removeOnComplete: true },
  );
  // Repeatable sweep of expired grave holds.
  await queue.add(
    HOLD_EXPIRY_JOB,
    {},
    { repeat: { every: HOLD_EXPIRY_EVERY_MS }, jobId: HOLD_EXPIRY_JOB, removeOnComplete: true },
  );

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === OUTBOX_JOB) {
        return pollAndDispatch({ prisma, mailer });
      }
      if (job.name === HOLD_EXPIRY_JOB) {
        return expireHolds(prisma);
      }
      return undefined;
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.name ?? '?'} failed:`, err.message);
  });

  console.log(`[worker] ready — polling outbox every ${POLL_EVERY_MS}ms`);

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
