/* Run the service sweep once against docker postgres:
 *   DATABASE_URL=... pnpm --filter @erp/worker exec tsx scripts/service-sweep-smoke.ts
 */
import { PrismaClient } from '@prisma/client';
import { sweepServices } from '../src/service-sweep';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const result = await sweepServices(prisma);
  console.log(`expired=${result.expired} reminders=${result.reminders}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
