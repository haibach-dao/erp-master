import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { pollAndDispatch } from './dispatcher';
import { createMailer } from './mailer';

const QUEUE = 'maintenance';
const OUTBOX_JOB = 'outbox-dispatch';
const POLL_EVERY_MS = 5000;

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

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === OUTBOX_JOB) {
        return pollAndDispatch({ prisma, mailer });
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
