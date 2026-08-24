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
}

// Deliver one outbox row by channel. Throw to signal failure (caller records the attempt).
async function dispatchOne(
  row: { channel: string; payload: unknown },
  mailer: Transporter,
): Promise<void> {
  switch (row.channel) {
    case 'EMAIL': {
      const p = row.payload as EmailPayload;
      if (p.to === undefined || p.to.length === 0) {
        throw new Error('EMAIL payload missing "to"');
      }
      await mailer.sendMail({
        from: process.env.MAIL_FROM ?? 'no-reply@erp.local',
        to: p.to,
        subject: p.subject ?? '(no subject)',
        text: p.text,
        html: p.html,
      });
      return;
    }
    case 'INAPP':
      // Stub: in-app notifications will be persisted by a later task.
      return;
    default:
      throw new Error(`Unknown channel: ${row.channel}`);
  }
}

// Poll PENDING outbox rows and dispatch them at-least-once. On failure, increment
// attempts; once attempts >= maxAttempts the row is dead-lettered (status DEAD).
// Single-worker safe; multi-worker needs SELECT ... FOR UPDATE SKIP LOCKED (follow-up).
export async function pollAndDispatch(
  deps: DispatchDeps,
): Promise<{ processed: number; sent: number; dead: number }> {
  const { prisma, mailer } = deps;
  const rows = await prisma.outboxEvent.findMany({
    where: { status: 'PENDING' },
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
  return { processed: rows.length, sent, dead };
}
