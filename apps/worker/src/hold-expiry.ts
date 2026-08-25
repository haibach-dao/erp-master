import type { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { appendAuditEvent, type AuditWriteClient } from '@erp/audit';
import type { AgentIdentity } from './agent-identity';

/* Expire Active holds past their expiresAt and return the plot to Available (with history).
 * Each hold is handled in its own transaction; re-checks status to stay idempotent.
 *
 * `agent` is required, not optional. Releasing a grave plot writes a status-history row,
 * and that row used to say `changedBy: null` — nobody could answer "who released this
 * plot". The seat is passed in rather than looked up here so the process fails at
 * startup, once, instead of silently falling back to anonymous on every sweep.
 */
export async function expireHolds(
  prisma: PrismaClient,
  agent: AgentIdentity,
): Promise<{ expired: number }> {
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
            changedBy: agent.userId,
          },
        });
        /* Cùng chuỗi hash với API, cùng một hàm — không phải bản sao.
         *
         * `actorType: 'AGENT'` chứ không phải 'SYSTEM': 'SYSTEM' nghĩa là "hệ tự làm,
         * không ai chịu trách nhiệm", đúng cái trạng thái ghế máy sinh ra để chấm dứt.
         * Ghi TRONG cùng transaction với việc đổi trạng thái mộ, nên không có cửa nào
         * để lô mộ được giải phóng mà nhật ký không có dòng nào. */
        await appendAuditEvent(tx as unknown as AuditWriteClient, ulid(), {
          companyId: plot.companyId,
          actorType: 'AGENT',
          actorId: agent.userId,
          action: 'GRAVE.HOLD_EXPIRED',
          entityType: 'grave_plot',
          entityId: plot.id,
          source: 'JOB',
          reason: `Phiếu giữ chỗ ${h.id} hết hạn`,
          beforeData: { status: 'Held' },
          afterData: { status: 'Available', holdId: h.id },
          changedFields: ['status'],
        });
      }
      expired += 1;
    });
  }
  return { expired };
}
