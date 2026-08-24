/* Integration smoke for the audit chain (run against docker postgres):
 *   DATABASE_URL=postgresql://erp:erp@localhost:5432/erp pnpm --filter @erp/api exec tsx scripts/audit-smoke.ts
 * Services are instantiated directly (no Nest DI) because tsx/esbuild does not emit
 * decorator metadata; DI wiring is verified separately by booting the compiled app.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const audit = new AuditService(prisma as unknown as PrismaService);
  const outbox = new OutboxService(prisma as unknown as PrismaService);
  const company = `smoke-${Date.now()}`;

  const e1 = await audit.record({
    companyId: company,
    actorType: 'SYSTEM',
    action: 'SMOKE.ONE',
    entityType: 'test',
    entityId: '1',
    afterData: { nationalId: '079123456789', note: 'ok' },
  });
  const e2 = await audit.record({
    companyId: company,
    actorType: 'SYSTEM',
    action: 'SMOKE.TWO',
    entityType: 'test',
    entityId: '2',
  });

  const chainOk = e1.previousEventHash === null && e2.previousEventHash === e1.eventHash;
  const after = e1.afterData as { nationalId?: string } | null;
  const maskedOk = after?.nationalId === '079***789';

  const ob = await outbox.enqueue({
    aggregateType: 'test',
    aggregateId: '1',
    eventType: 'SMOKE.NOTIFY',
    channel: 'EMAIL',
    payload: { hello: 'world' },
    dedupKey: `smoke-${company}`,
  });
  const outboxOk = ob.status === 'PENDING' && ob.attempts === 0;

  console.log(`chainOk=${chainOk} maskedOk=${maskedOk} outboxOk=${outboxOk}`);
  await prisma.$disconnect();
  if (!chainOk || !maskedOk || !outboxOk) {
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
