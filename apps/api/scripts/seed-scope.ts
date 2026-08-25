/* Dev-only: gán người dùng vào nghĩa trang (trục hub) để thử phạm vi SITE.
 *
 *   DATABASE_URL=... DEV_USER_EMAIL=admin@local DEV_SCOPE_CEMETERIES=NT01,NT02 \
 *     pnpm --filter @erp/api exec tsx scripts/seed-scope.ts
 *
 * Đây là một trong các đường GHI vào `authz`, nên nó từ chối chạy ngoài development/test
 * — giống seed-dev-user. Ở môi trường thật, phạm vi được gán qua màn hình quản trị hoặc
 * migration có review, không qua script chạy tay.
 *
 * Bỏ `DEV_SCOPE_CEMETERIES` thì script chỉ IN ra ai đang được gán gì, không ghi gì cả.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const DEV_ENVIRONMENTS = ['development', 'test'];

function assertDevEnvironment(): void {
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  if (!DEV_ENVIRONMENTS.includes(appEnv)) {
    throw new Error(
      `Từ chối chạy: đây là script GÁN PHẠM VI chỉ dùng cho dev, nhưng APP_ENV/NODE_ENV = "${appEnv}".`,
    );
  }
}

async function main(): Promise<void> {
  assertDevEnvironment();
  const prisma = new PrismaClient();

  const email = process.env.DEV_USER_EMAIL ?? 'admin@local';
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user === null) {
    throw new Error(`Không tìm thấy người dùng ${email} — chạy seed-dev-user.ts trước`);
  }

  const codes = (process.env.DEV_SCOPE_CEMETERIES ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (codes.length > 0) {
    const cemeteries = await prisma.cemetery.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, name: true },
    });
    const missing = codes.filter((c) => !cemeteries.some((x) => x.code === c));
    if (missing.length > 0) {
      throw new Error(`Không tìm thấy nghĩa trang có mã: ${missing.join(', ')}`);
    }
    for (const c of cemeteries) {
      await prisma.scopeAssignment.upsert({
        where: { userId_cemeteryId: { userId: user.id, cemeteryId: c.id } },
        update: { validTo: null },
        create: { id: ulid(), userId: user.id, cemeteryId: c.id, grantedBy: 'seed-scope.ts' },
      });
      console.log(`gán ${email} -> ${c.code} (${c.name})`);
    }
  }

  const current = await prisma.scopeAssignment.findMany({ where: { userId: user.id } });
  const names = await prisma.cemetery.findMany({
    where: { id: { in: current.map((s) => s.cemeteryId) } },
    select: { id: true, code: true, name: true },
  });
  console.log(`\n${email} đang phụ trách ${current.length} nghĩa trang:`);
  for (const n of names) {
    console.log(`  ${n.code}  ${n.name}`);
  }
  if (current.length === 0) {
    console.log('  (chưa gán nghĩa trang nào — vai phạm vi SITE sẽ không thấy bản ghi nào)');
  }

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
