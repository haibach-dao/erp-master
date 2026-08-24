/* Dev-only: create/update a login user for local testing. NOT for production.
 *   DATABASE_URL=... DEV_USER_EMAIL=admin@local DEV_USER_PASSWORD=... \
 *     pnpm --filter @erp/api exec tsx scripts/seed-dev-user.ts
 * Password MUST come from env — no credential is committed.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';

async function main(): Promise<void> {
  const email = process.env.DEV_USER_EMAIL ?? 'admin@local';
  const password = process.env.DEV_USER_PASSWORD;
  if (password === undefined || password.length === 0) {
    throw new Error('DEV_USER_PASSWORD env is required');
  }
  const prisma = new PrismaClient();
  const passwordHash = await hash(password);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: 'active' },
    create: { id: ulid(), email, passwordHash, status: 'active' },
  });
  console.log(`dev user ready: ${email}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
