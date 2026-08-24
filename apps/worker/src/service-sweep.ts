import { PrismaClient, Prisma } from '@prisma/client';
import { ulid } from 'ulid';

const DAY_MS = 86_400_000;

// Expire past-due Active subscriptions and enqueue expiry reminders at configured
// milestones (idempotent via outbox dedupKey per subscription+milestone).
export async function sweepServices(
  prisma: PrismaClient,
): Promise<{ expired: number; reminders: number }> {
  const now = new Date();

  const expiredRes = await prisma.serviceSubscription.updateMany({
    where: { status: 'Active', effectiveTo: { lt: now } },
    data: { status: 'Expired' },
  });

  const active = await prisma.serviceSubscription.findMany({
    where: { status: 'Active' },
    include: { catalog: { select: { reminderDays: true, name: true } } },
    take: 500,
  });

  let reminders = 0;
  for (const sub of active) {
    const daysUntil = Math.ceil((sub.effectiveTo.getTime() - now.getTime()) / DAY_MS);
    if (!sub.catalog.reminderDays.includes(daysUntil)) {
      continue;
    }
    try {
      await prisma.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: 'service_subscription',
          aggregateId: sub.id,
          eventType: 'SERVICE.EXPIRY_REMINDER',
          channel: 'INAPP',
          payload: {
            subscriptionId: sub.id,
            service: sub.catalog.name,
            daysUntil,
            effectiveTo: sub.effectiveTo.toISOString(),
          },
          dedupKey: `svc-reminder:${sub.id}:${daysUntil}`,
        },
      });
      reminders += 1;
    } catch (err) {
      // Duplicate reminder for this (subscription, milestone) already enqueued.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
        throw err;
      }
    }
  }
  return { expired: expiredRes.count, reminders };
}
