/* XOÁ SẠCH dữ liệu nghiệp vụ nghĩa trang rồi seed lại bộ dữ liệu thử mạch lạc.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/reset-cemetery-data.ts [--apply]
 *
 * Mặc định CHỈ LIỆT KÊ. Phải thêm `--apply` mới xoá — một script xoá chạy nhầm là mất dữ
 * liệu, nên mặc định phải là không làm gì.
 *
 * ==== XOÁ ====
 * Toàn bộ dữ liệu GIAO DỊCH: hồ sơ an táng, người mất, khách hàng, nhân thân, quan hệ,
 * quyền sử dụng mộ, phiếu giữ chỗ, thẻ đã cấp, hợp đồng, dịch vụ và giao dịch thu tiền.
 *
 * ==== GIỮ ====
 * Danh mục và hạ tầng: công ty, nghĩa trang, loại mộ, PHẦN MỘ, danh mục quan hệ, danh mục
 * dịch vụ, tài khoản đăng nhập, toàn bộ phân quyền.
 *
 * Phần mộ được GIỮ nhưng RESET về `Available` — chúng là tài sản có thật ngoài đời, xoá đi
 * là mất cả sơ đồ mặt bằng và toạ độ đã nhập. Chỉ trạng thái là thứ trỏ vào dữ liệu vừa
 * xoá, nên chỉ trạng thái được đặt lại.
 *
 * ==== KHÔNG ĐỘNG TỚI ====
 * `audit.audit_events` — có trigger CSDL chặn UPDATE/DELETE. Nhật ký kiểm toán sống lâu
 * hơn thứ nó nói về; xoá được nó thì nó đã chẳng để làm gì. Sau khi chạy script này, nhật
 * ký vẫn kể lại những việc đã làm trên dữ liệu nay không còn.
 */
import { PrismaClient } from '@prisma/client';
import { PiiService } from '../src/common/pii/pii.service';
import { ConfigService } from '@nestjs/config';

const prisma = new PrismaClient();
const pii = new PiiService(new ConfigService());

/* Thứ tự xoá đi từ CON tới CHA. Sai thứ tự là va khoá ngoại và dừng giữa chừng, để lại
 * một nửa dữ liệu — tệ hơn cả không xoá. */
const DELETE_ORDER = [
  ['burial_records', () => prisma.burialRecord.deleteMany()],
  ['card_print_logs', () => prisma.cardPrintLog.deleteMany()],
  ['service_transactions', () => prisma.serviceTransaction.deleteMany()],
  ['service_subscriptions', () => prisma.serviceSubscription.deleteMany()],
  ['contract_parties', () => prisma.contractParty.deleteMany()],
  ['external_contracts', () => prisma.externalContract.deleteMany()],
  ['grave_usage_rights', () => prisma.graveUsageRight.deleteMany()],
  ['grave_holds', () => prisma.graveHold.deleteMany()],
  ['grave_plot_status_history', () => prisma.gravePlotStatusHistory.deleteMany()],
  ['deceased_persons', () => prisma.deceasedPerson.deleteMany()],
  ['family_relationships', () => prisma.familyRelationship.deleteMany()],
  ['person_phones', () => prisma.personPhone.deleteMany()],
  ['person_addresses', () => prisma.personAddress.deleteMany()],
  ['person_education', () => prisma.personEducation.deleteMany()],
  ['person_bank_accounts', () => prisma.personBankAccount.deleteMany()],
  ['customers', () => prisma.customer.deleteMany()],
  ['persons', () => prisma.person.deleteMany()],
] as const;

/* Id có thứ tự để chạy lại script cho ra cùng id — dễ đối chiếu giữa hai lần reset.
 * KHÔNG dùng `ulid()`: nó phụ thuộc đồng hồ, nên hai lần chạy cho hai bộ id khác nhau và
 * không so được ảnh chụp màn hình của lần trước với lần này. */
const id = (prefix: string, n: number): string =>
  `SEED${prefix.toUpperCase()}${String(n).padStart(4, '0')}`.padEnd(26, '0');

function nid(raw: string) {
  return {
    nationalIdHash: pii.hash(raw),
    nationalIdMasked: pii.mask(raw),
    nationalIdCipher: pii.encrypt(raw),
  };
}

/* Bộ dữ liệu thử được chọn để phủ các NHÁNH khác nhau của màn hình, không phải để trông
 * cho nhiều: một người đủ trường (kiểm hiển thị + che), một người chỉ có tên (kiểm trạng
 * thái rỗng), một người đã mất (kiểm nhánh người mất), một tổ chức (kiểm nhánh không có
 * nhân thân). */
async function seedDemo(companyId: string): Promise<void> {
  const people = [
    {
      key: 'p1',
      person: {
        fullName: 'Nguyễn Văn An',
        gender: 'MALE',
        dateOfBirth: new Date('1958-03-12'),
        placeOfBirth: 'Quảng Ninh',
        ...nid('012345678901'),
        nationalIdIssuedOn: new Date('2021-06-15'),
        nationalIdIssuedPlace: 'Cục CSQLHC về TTXH',
        phone: '0912000001',
        email: 'an.nguyen@example.vn',
        permanentAddress: 'Số 12, phường Hồng Hải, TP Hạ Long',
        contactAddress: 'Số 12, phường Hồng Hải, TP Hạ Long',
        ethnicity: 'Kinh',
        religion: 'Phật giáo',
      },
      customerCode: 'KH-DEMO-001',
    },
    {
      key: 'p2',
      person: {
        fullName: 'Trần Thị Bình',
        gender: 'FEMALE',
        dateOfBirth: new Date('1962-09-30'),
        placeOfBirth: 'Hải Phòng',
        ...nid('012345678902'),
        phone: '0912000002',
        permanentAddress: 'Số 12, phường Hồng Hải, TP Hạ Long',
        ethnicity: 'Kinh',
        religion: 'Phật giáo',
      },
      customerCode: 'KH-DEMO-002',
    },
    {
      key: 'p3',
      // Chỉ có tên: để kiểm màn hình khi mọi trường khác đều trống.
      person: { fullName: 'Lê Văn Cường' },
      customerCode: 'KH-DEMO-003',
    },
    {
      key: 'p4',
      person: {
        fullName: 'Phạm Thị Dung',
        gender: 'FEMALE',
        dateOfBirth: new Date('1935-01-20'),
        placeOfBirth: 'Nam Định',
        permanentAddress: 'Số 12, phường Hồng Hải, TP Hạ Long',
        religion: 'Phật giáo',
      },
      customerCode: 'KH-DEMO-004',
      deceasedOn: new Date('2026-02-14'),
    },
  ];

  for (const [i, p] of people.entries()) {
    const personId = id('per', i + 1);
    await prisma.person.create({ data: { id: personId, ...p.person } });
    await prisma.customer.create({
      data: {
        id: id('cus', i + 1),
        personId,
        customerCode: p.customerCode,
        type: 'INDIVIDUAL',
        companyId,
        ...(p.person.phone !== undefined ? { phone: p.person.phone } : {}),
      },
    });
    if (p.deceasedOn !== undefined) {
      /* Người mất CŨNG LÀ khách hàng — hồ sơ khách hàng đã tạo ở trên. Tạo hồ sơ người
       * mất SAU, đúng thứ tự mà service ép. */
      await prisma.deceasedPerson.create({
        data: { id: id('dec', i + 1), personId, dateOfDeath: p.deceasedOn },
      });
    }
  }

  // Khách hàng TỔ CHỨC: không có nhân thân, để kiểm nhánh còn lại của mọi màn hình.
  await prisma.customer.create({
    data: {
      id: id('cus', 9),
      customerCode: 'KH-DEMO-009',
      type: 'ORGANIZATION',
      orgName: 'Công ty TNHH Thành Đạt',
      companyId,
      phone: '02033000009',
      email: 'lienhe@thanhdat.example.vn',
    },
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const counts = await Promise.all(
    DELETE_ORDER.map(async ([table]) => {
      const n = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `select count(*)::bigint as c from ${table.includes('service') ? 'services' : table.includes('contract') ? 'contracts' : 'cemetery'}.${table}`,
      );
      return { table, n: Number(n[0]?.c ?? 0) };
    }),
  );

  console.log('SẼ XOÁ:');
  for (const c of counts) {
    console.log(`  ${c.table.padEnd(28)} ${c.n}`);
  }
  const plots = await prisma.gravePlot.count();
  console.log(`\nGIỮ nhưng RESET trạng thái: ${plots} phần mộ -> Available`);
  console.log('KHÔNG động tới: audit.audit_events (trigger CSDL chặn xoá), tài khoản, phân quyền');

  if (!apply) {
    console.log('\n(chỉ liệt kê — thêm --apply để thực sự xoá và seed lại)');
    return;
  }

  for (const [table, del] of DELETE_ORDER) {
    const r = await del();
    console.log(`  xoá ${table.padEnd(28)} ${r.count}`);
  }

  await prisma.gravePlot.updateMany({ data: { status: 'Available' } });
  console.log(`  reset ${plots} phần mộ về Available`);

  const company = await prisma.cemetery.findFirst({ select: { companyId: true } });
  if (company === null) {
    console.log('\nKhông có nghĩa trang nào — bỏ qua bước seed dữ liệu thử.');
    return;
  }
  await seedDemo(company.companyId);

  const after = await Promise.all([prisma.customer.count(), prisma.deceasedPerson.count()]);
  console.log(`\nĐÃ SEED: ${after[0]} khách hàng (trong đó ${after[1]} đã mất)`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
