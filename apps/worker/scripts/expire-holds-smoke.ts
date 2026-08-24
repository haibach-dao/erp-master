/* Run the hold-expiry sweep once against docker postgres:
 *   DATABASE_URL=... pnpm --filter @erp/worker exec tsx scripts/expire-holds-smoke.ts
 */
import { PrismaClient } from '@prisma/client';
import { expireHolds } from '../src/hold-expiry';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const result = await expireHolds(prisma);
  console.log(`expired=${result.expired}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
