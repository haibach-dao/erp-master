import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // T05 seed harness — intentionally empty.
  // Foundation only; domain/reference seed data is added in later tasks once Gate 0 is decided.
  console.log('[seed] no seed data yet (foundation stage)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
