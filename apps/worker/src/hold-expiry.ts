import type { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

// Expire Active holds past their expiresAt and return the plot to Available (with history).
// Each hold is handled in its own transaction; re-checks status to stay idempotent.
export async function expireHolds(prisma: PrismaClient): Promise<{ expired: number }> {
  const now = new Date();
  const due = await prisma.graveHold.findMany({
    where: { status: 'Active', expiresAt: { lt: now } },
    take: 100,
  });

  let expired = 0;
  for (const h of due) {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.graveHold.findUnique({ where: { id: h.id } });
      if (cur === null || cur.status !== 'Active') {
        return;
      }
      await tx.graveHold.update({
        where: { id: h.id },
        data: { status: 'Expired', releasedAt: now },
      });
      const plot = await tx.gravePlot.findUnique({ where: { id: h.gravePlotId } });
      if (plot !== null && plot.status === 'Held') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Available', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: 'Held',
            toStatus: 'Available',
            reason: 'hold expired',
            changedBy: null,
          },
        });
      }
      expired += 1;
    });
  }
  return { expired };
}
