/* Danh mục dịch vụ NGHĨA TRANG — bản ĐỀ XUẤT, giá là số NHÁP.
 *
 *   DATABASE_URL=... DEV_COMPANY=<mã công ty> \
 *     pnpm --filter @erp/api exec tsx scripts/seed-service-catalog.ts
 *
 * ============================================================================
 *  GIÁ TRONG FILE NÀY LÀ SỐ TÔI TỰ ĐẶT, KHÔNG PHẢI GIÁ THẬT CỦA INDEVCO.
 * ============================================================================
 *
 * Chủ doanh nghiệp bảo "chủ động seed đi", nên tôi dựng cấu trúc danh mục và tên gói —
 * những thứ suy được từ nghiệp vụ nghĩa trang. Nhưng GIÁ và CHU KỲ là dữ liệu kinh doanh
 * thật, tôi không có căn cứ nào để biết. Tự điền rồi để chúng chạy như giá thật là bịa
 * dữ liệu nghiệp vụ — thứ đắt nhất để phát hiện muộn, vì nó sẽ nằm trong hợp đồng và
 * báo cáo doanh thu trước khi ai kịp nhận ra.
 *
 * Vì vậy script này:
 *   - CHỈ chạy ở development/test (giống các script ghi dữ liệu khác);
 *   - đặt `active = false` cho mọi gói, nên chúng KHÔNG bán được cho tới khi có người
 *     bật lên sau khi xác nhận giá;
 *   - in ra đúng danh sách con số cần anh Bách xác nhận.
 *
 * Khi có giá thật: sửa `PRICE_VND` + `durationMonths` ở đây rồi chạy lại (upsert theo
 * mã), hoặc nhập trực tiếp trên màn hình `/cemetery/services`.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const DEV_ENVIRONMENTS = ['development', 'test'];

interface DraftService {
  code: string;
  name: string;
  /** SỐ NHÁP — cần xác nhận. */
  priceVnd: number;
  durationMonths: number;
  reminderDays: number[];
  note: string;
}

/* Cấu trúc và tên gói: suy từ nghiệp vụ nghĩa trang (chăm sóc định kỳ, vệ sinh, lễ,
 * cây cảnh). Chu kỳ 12 tháng và mốc nhắc 90/60/30/7 lấy theo mặc định blueprint.
 * Con số tiền: NHÁP.
 */
const DRAFT_CATALOG: DraftService[] = [
  {
    code: 'CS-CB-12',
    name: 'Chăm sóc mộ cơ bản (12 tháng)',
    priceVnd: 1_200_000,
    durationMonths: 12,
    reminderDays: [90, 60, 30, 7],
    note: 'Quét dọn, cắt cỏ, kiểm tra định kỳ',
  },
  {
    code: 'CS-NC-12',
    name: 'Chăm sóc mộ nâng cao (12 tháng)',
    priceVnd: 2_400_000,
    durationMonths: 12,
    reminderDays: [90, 60, 30, 7],
    note: 'Cơ bản + trồng và thay hoa theo mùa, lau bia',
  },
  {
    code: 'CS-TRON-24',
    name: 'Chăm sóc mộ trọn gói (24 tháng)',
    priceVnd: 4_200_000,
    durationMonths: 24,
    reminderDays: [120, 90, 30, 7],
    note: 'Nâng cao + báo cáo hình ảnh định kỳ cho gia đình',
  },
  {
    code: 'LE-GIO-01',
    name: 'Dịch vụ lễ giỗ (một lần/năm)',
    priceVnd: 1_500_000,
    durationMonths: 12,
    reminderDays: [30, 14, 7],
    note: 'Chuẩn bị lễ, hương hoa, sắp đặt theo yêu cầu gia đình',
  },
  {
    code: 'VS-BIA-06',
    name: 'Vệ sinh - đánh bóng bia mộ (6 tháng)',
    priceVnd: 800_000,
    durationMonths: 6,
    reminderDays: [30, 7],
    note: 'Làm sạch, chống rêu, đánh bóng bề mặt đá',
  },
  {
    code: 'CAY-CANH-12',
    name: 'Cây cảnh - tiểu cảnh quanh mộ (12 tháng)',
    priceVnd: 1_800_000,
    durationMonths: 12,
    reminderDays: [90, 30, 7],
    note: 'Trồng, tỉa, thay thế cây theo mùa',
  },
];

function assertDevEnvironment(): void {
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  if (!DEV_ENVIRONMENTS.includes(appEnv)) {
    throw new Error(
      `Từ chối chạy: đây là danh mục ĐỀ XUẤT với giá NHÁP, chỉ dùng cho dev. APP_ENV/NODE_ENV = "${appEnv}". ` +
        'Giá thật phải do chủ doanh nghiệp xác nhận rồi nhập qua màn hình dịch vụ.',
    );
  }
}

async function main(): Promise<void> {
  assertDevEnvironment();
  const prisma = new PrismaClient();

  const code = process.env.DEV_COMPANY;
  const company =
    code === undefined || code.length === 0
      ? await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } })
      : await prisma.company.findUnique({ where: { code } });
  if (company === null) {
    throw new Error(
      code === undefined
        ? 'Chưa có công ty nào trong hệ. Tạo công ty trước, hoặc đặt DEV_COMPANY=<mã>.'
        : `Không tìm thấy công ty có mã "${code}"`,
    );
  }

  for (const s of DRAFT_CATALOG) {
    await prisma.serviceCatalog.upsert({
      where: { companyId_code: { companyId: company.id, code: s.code } },
      update: {
        name: s.name,
        price: s.priceVnd,
        durationMonths: s.durationMonths,
        reminderDays: s.reminderDays,
      },
      create: {
        id: ulid(),
        companyId: company.id,
        code: s.code,
        name: s.name,
        price: s.priceVnd,
        durationMonths: s.durationMonths,
        reminderDays: s.reminderDays,
        // TẮT SẴN. Gói chưa xác nhận giá thì không được bán.
        active: false,
      },
    });
  }

  console.log(`\n[seed] ${DRAFT_CATALOG.length} gói dịch vụ ĐỀ XUẤT -> công ty ${company.code}`);
  console.log('[seed] Tất cả đang active = FALSE, chưa bán được.\n');
  console.log('CẦN ANH BÁCH XÁC NHẬN — giá dưới đây là SỐ TÔI TỰ ĐẶT, không phải giá thật:');
  console.log('  mã            chu kỳ   giá nháp (VND)   nội dung');
  for (const s of DRAFT_CATALOG) {
    console.log(
      `  ${s.code.padEnd(13)} ${String(s.durationMonths).padStart(2)} tháng  ` +
        `${s.priceVnd.toLocaleString('vi-VN').padStart(13)}   ${s.note}`,
    );
  }
  console.log(
    '\nXác nhận xong: sửa PRICE trong script này rồi chạy lại, hoặc nhập trên /cemetery/services.',
  );
  console.log('Bật bán: đặt active = true cho từng gói sau khi giá đã đúng.\n');

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
