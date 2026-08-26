/* Vì sao KHÔNG xoá được khách hàng này?
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/why-cannot-delete.ts <customerCode>
 *
 * CHỈ ĐỌC. Chạy đúng bộ đếm mà rào chắn xoá dùng — cùng `CUSTOMER_BLOCKING_REFERENCES`, cùng
 * bộ lọc "còn hiệu lực" — nhưng in ra TỪNG mục thay vì chỉ ném một câu lỗi.
 *
 * Vì sao cần: rào chắn nói "còn 2 hợp đồng đang hiệu lực" là đủ cho người dùng, nhưng khi
 * đi tìm lỗi thì cần thấy cả những mục ĐANG BẰNG 0 — để biết chắc bộ lọc đang chạy chứ
 * không phải đang bỏ qua. Một mục bằng 0 vì lọc đúng và một mục bằng 0 vì truy vấn sai
 * trông giống hệt nhau trong câu lỗi.
 */
import { PrismaClient } from '@prisma/client';
import { CUSTOMER_BLOCKING_REFERENCES } from '../src/common/lifecycle/customer-references';
import { activeBurial } from '../src/common/lifecycle/active';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const code = process.argv[2];
  if (code === undefined) {
    console.error('Cách dùng: tsx scripts/why-cannot-delete.ts <customerCode>');
    process.exitCode = 1;
    return;
  }

  const customer = await prisma.customer.findFirst({
    where: { customerCode: code },
    select: { id: true, customerCode: true, personId: true, orgName: true },
  });
  if (customer === null) {
    console.error(`Không tìm thấy khách hàng ${code}`);
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const client = prisma as unknown as Record<
    string,
    { count: (a: { where: Record<string, unknown> }) => Promise<number> }
  >;

  console.log(`Khách hàng ${customer.customerCode}\n`);
  console.log(`${'MỤC'.padEnd(24)}| ${'ĐANG CHẶN'.padEnd(10)}| BỘ LỌC "CÒN HIỆU LỰC"`);
  console.log('-'.repeat(92));

  let blocking = 0;
  for (const ref of CUSTOMER_BLOCKING_REFERENCES) {
    const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
    const where = { [ref.column]: customer.id, ...ref.activeWhere(now) };
    const n = await client[model]!.count({ where });
    if (n > 0) blocking += 1;
    const filter = JSON.stringify(ref.activeWhere(now));
    console.log(
      `${ref.model.padEnd(24)}| ${String(n).padEnd(10)}| ${filter === '{}' ? '(cố ý không lọc)' : filter}`,
    );
  }

  /* Hồ sơ an táng trỏ vào hồ sơ NGƯỜI MẤT, không trỏ vào hồ sơ khách hàng — nên nó nằm
   * ngoài sổ đăng ký theo cột khách hàng và phải hỏi riêng. */
  const deceased =
    customer.personId === null
      ? null
      : await prisma.deceasedPerson.findUnique({
          where: { personId: customer.personId },
          select: { id: true },
        });
  const asDeceased =
    deceased === null
      ? 0
      : await prisma.burialRecord.count({
          where: { deceasedPersonId: deceased.id, ...activeBurial() },
        });
  if (asDeceased > 0) blocking += 1;
  console.log(
    `${'(đã được an táng)'.padEnd(24)}| ${String(asDeceased).padEnd(10)}| hồ sơ còn hiệu lực`,
  );

  console.log(
    blocking === 0 ? '\n=> KHÔNG có gì chặn. Xoá được.' : `\n=> ${blocking} mục đang chặn.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
