/* Dev-only: create/update a login user for local testing. NOT for production.
 *   DATABASE_URL=... DEV_USER_EMAIL=admin@local DEV_USER_PASSWORD=... \
 *     pnpm --filter @erp/api exec tsx scripts/seed-dev-user.ts
 * Password MUST come from env — no credential is committed.
 *
 * This script writes to `authz.role_assignments`, which makes it one of the ways rights
 * enter the system. Blueprint doc 16 §D.11 requires that list to be closed and guarded,
 * so it refuses to run outside a development/test environment instead of trusting the
 * operator to remember. It also refuses to hand out a group-wide assignment silently:
 * `company_id = NULL` means "every company", so it has to be asked for explicitly.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';

const DEV_ENVIRONMENTS = ['development', 'test'];

function assertDevEnvironment(): void {
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  if (!DEV_ENVIRONMENTS.includes(appEnv)) {
    throw new Error(
      `Từ chối chạy: đây là script CẤP QUYỀN chỉ dùng cho dev, nhưng APP_ENV/NODE_ENV = "${appEnv}". ` +
        'Cấp quyền ở môi trường thật phải đi qua migration có review.',
    );
  }
}

async function main(): Promise<void> {
  assertDevEnvironment();

  const email = process.env.DEV_USER_EMAIL ?? 'admin@local';
  const password = process.env.DEV_USER_PASSWORD;
  if (password === undefined || password.length === 0) {
    throw new Error('DEV_USER_PASSWORD env is required');
  }
  const prisma = new PrismaClient();
  const passwordHash = await hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: 'active' },
    create: { id: ulid(), email, passwordHash, status: 'active' },
  });

  const roleCode = process.env.DEV_USER_ROLE ?? 'ADMIN';
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (role === null) {
    console.log(`dev user ready: ${email} (role ${roleCode} not found — run pnpm db:seed)`);
    await prisma.$disconnect();
    return;
  }

  // Resolve the company the assignment is bound to. DEV_USER_COMPANY is a company CODE
  // so the command stays readable; DEV_USER_ALL_COMPANIES=true is the explicit opt-in
  // to the unbounded assignment that used to be the silent default.
  const companyId = await resolveCompanyId(prisma);

  const existing = await prisma.roleAssignment.findFirst({
    where: { userId: user.id, roleId: role.id, companyId },
  });
  if (existing === null) {
    await prisma.roleAssignment.create({
      data: { id: ulid(), userId: user.id, roleId: role.id, companyId },
    });
  }
  console.log(
    `dev user ready: ${email} (role ${roleCode}, company ${companyId ?? 'TẤT CẢ (companyId=null)'})`,
  );
  await prisma.$disconnect();
}

async function resolveCompanyId(prisma: PrismaClient): Promise<string | null> {
  if (process.env.DEV_USER_ALL_COMPANIES === 'true') {
    return null;
  }
  const code = process.env.DEV_USER_COMPANY;
  if (code !== undefined && code.length > 0) {
    const company = await prisma.company.findUnique({ where: { code } });
    if (company === null) {
      throw new Error(`Không tìm thấy công ty có mã "${code}"`);
    }
    return company.id;
  }
  // Fall back to the only company if the dev database has exactly one; otherwise make
  // the operator choose rather than guessing on their behalf.
  const companies = await prisma.company.findMany({ select: { id: true, code: true }, take: 2 });
  const only = companies[0];
  if (companies.length === 1 && only !== undefined) {
    return only.id;
  }
  throw new Error(
    'Phải chỉ rõ phạm vi: đặt DEV_USER_COMPANY=<mã công ty>, ' +
      'hoặc DEV_USER_ALL_COMPANIES=true nếu thật sự muốn gán toàn bộ công ty.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
