/* Tiền kiểm trước khi bật ràng buộc phạm vi công ty.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/authz-scope-check.ts
 *
 * Từ nay `companyId` không còn do client khai: người gọi phải được GÁN công ty, trừ khi
 * phạm vi của họ là GROUP (không giới hạn bản ghi). Nghĩa là có một nhóm người sẽ mất
 * quyền đúng lúc thay đổi này chạy: người được gán vai với `company_id = NULL` mà phạm vi
 * KHÔNG phải GROUP — họ không bó vào công ty nào, nên không với tới được bản ghi nào.
 *
 * Chạy script này TRƯỚC khi deploy. Có dòng nào ở mục "SẼ MẤT QUYỀN" thì gán công ty cho
 * họ trước, đừng để phát hiện bằng ticket của người dùng.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const assignments = await prisma.roleAssignment.findMany({
    include: { role: { include: { rolePermissions: true } } },
  });
  await prisma.$disconnect();

  const willBreak: string[] = [];
  const unrestricted: string[] = [];
  const bound: string[] = [];

  for (const a of assignments) {
    const scopes = new Set(a.role.rolePermissions.map((rp) => a.scope ?? rp.scope));
    const label = `${a.userId}  vai=${a.role.code}  company=${a.companyId ?? 'NULL'}`;
    if (scopes.has('GROUP')) {
      unrestricted.push(label);
    } else if (a.companyId === null) {
      willBreak.push(label);
    } else {
      bound.push(label);
    }
  }

  console.log(`# Tiền kiểm phạm vi — ${assignments.length} dòng gán vai\n`);
  console.log(`## SẼ MẤT QUYỀN (${willBreak.length}) — company_id NULL mà phạm vi không GROUP`);
  for (const l of willBreak) {
    console.log(`  ${l}`);
  }
  console.log(`\n## Không giới hạn, phạm vi GROUP (${unrestricted.length})`);
  for (const l of unrestricted) {
    console.log(`  ${l}`);
  }
  console.log(`\n## Đã bó vào công ty, chạy bình thường (${bound.length})`);
  for (const l of bound) {
    console.log(`  ${l}`);
  }

  if (willBreak.length > 0) {
    console.log(`\n!! ${willBreak.length} dòng cần gán công ty TRƯỚC khi deploy.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
