/* Bản chiếu "ai đang có quyền gì" — máy sinh, không sửa tay.
 *
 *   pnpm --filter @erp/api exec tsx scripts/authz-report.ts            # đọc danh mục nguồn
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/authz-report.ts --db
 *
 * Chạy TRƯỚC và SAU mỗi thay đổi ma trận quyền rồi diff hai bản: một thay đổi cấp quyền
 * mà không ai đọc được hệ quả thì không phải là một thay đổi đã được rà (doc 16 §F PR-4).
 * `--db` đọc trạng thái THẬT trong database; không có cờ thì đọc danh mục trong mã nguồn.
 */
import { PERMISSION_CATALOG, ROLE_CATALOG } from '../src/modules/authorization/permission-catalog';

interface Row {
  role: string;
  code: string;
  scope: string;
}

async function fromDatabase(): Promise<Row[]> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const roles = await prisma.role.findMany({
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: { code: 'asc' },
  });
  await prisma.$disconnect();
  return roles.flatMap((r) =>
    r.rolePermissions.map((rp) => ({ role: r.code, code: rp.permission.code, scope: rp.scope })),
  );
}

function fromCatalog(): Row[] {
  return Object.entries(ROLE_CATALOG).flatMap(([role, def]) =>
    def.grants.map((g) => ({ role, code: g.code, scope: g.scope })),
  );
}

async function main(): Promise<void> {
  const useDb = process.argv.includes('--db');
  const rows = useDb ? await fromDatabase() : fromCatalog();
  const sensitivity = new Map(PERMISSION_CATALOG.map((d) => [d.code, d.sensitivity]));

  const byRole = new Map<string, Row[]>();
  for (const row of rows) {
    byRole.set(row.role, [...(byRole.get(row.role) ?? []), row]);
  }

  console.log(`# Bản chiếu quyền — nguồn: ${useDb ? 'DATABASE' : 'danh mục mã nguồn'}`);
  console.log(`# vai: ${byRole.size} · dòng grant: ${rows.length}\n`);

  for (const [role, grants] of [...byRole.entries()].sort()) {
    const s3 = grants.filter((g) => sensitivity.get(g.code) === 'S3');
    console.log(`## ${role}  (${grants.length} mã, ${s3.length} leaf S3)`);
    for (const g of [...grants].sort((a, b) => a.code.localeCompare(b.code))) {
      const level = sensitivity.get(g.code) ?? '??';
      console.log(`  ${level}  ${g.code.padEnd(38)} ${g.scope}`);
    }
    console.log('');
  }

  const wildcard = rows.filter((r) => r.code.includes('*'));
  if (wildcard.length > 0) {
    console.log('!! Còn grant wildcard đang mở:');
    for (const w of wildcard) {
      console.log(`   ${w.role} -> ${w.code} (${w.scope})`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
