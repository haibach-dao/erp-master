/* In ra CHUỖI LUẬT TRUY CẬP theo đúng thứ tự được duyệt — kiểu `iptables -L`.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/authz-rules.ts
 *
 * Luật được duyệt từ `priority` nhỏ đến lớn; luật KHỚP TRƯỚC thì quyết và dừng. Vì thế
 * thứ tự là toàn bộ ý nghĩa của bảng này, và một bảng luật không đọc được theo thứ tự
 * là một bảng luật không rà được. Dòng cuối cùng in ra là "deny all" ngầm — nó không
 * nằm trong bảng, nó là hành vi mặc-định-từ-chối của guard.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const rules = await prisma.accessRule.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  await prisma.$disconnect();

  console.log(`# Chuỗi luật truy cập — ${rules.length} luật, duyệt từ trên xuống\n`);
  if (rules.length === 0) {
    console.log('  (chưa có luật nào — mọi quyết định do ma trận vai đưa ra)\n');
  }
  for (const r of rules) {
    const subject = r.subjectUserId ?? (r.roleCode !== null ? `vai:${r.roleCode}` : 'MỌI NGƯỜI');
    const window = r.validTo === null ? 'vô thời hạn' : `đến ${r.validTo.toISOString()}`;
    console.log(
      `  ${String(r.priority).padStart(4)}  ${r.effect.padEnd(5)}  ` +
        `${subject.padEnd(28)} ${r.permissionCode.padEnd(34)} (${window})`,
    );
    console.log(`        lý do: ${r.reason}`);
  }
  console.log('  ----  DENY   MỌI NGƯỜI                    *.*.*   (ngầm: guard mặc định từ chối)');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
