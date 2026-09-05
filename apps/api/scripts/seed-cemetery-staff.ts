/* Dev-only: dựng NGƯỜI THẬT cho luồng cấp thẻ mộ — một quản lý nghĩa trang (người ký) và
 * một nhân viên kinh doanh (người gửi duyệt ở lát 1).
 *
 *   DATABASE_URL=... SEED_STAFF_PASSWORD=... SEED_STAFF_COMPANY=<mã công ty> \
 *     pnpm --filter @erp/api seed:staff
 *
 * VÌ SAO CẦN: đo 05/09/2026 trên CSDL dev — `scope_assignments` có ĐÚNG 0 dòng, và 15/17 vai
 * KHÔNG ai giữ, gồm cả `QL_NGHIA_TRANG` lẫn `KD_KINH_DOANH`. Toàn hệ chỉ có 4 tài khoản
 * ADMIN. Luồng phê duyệt in thẻ vì thế không có diễn viên nào: không ai gửi được, không ai
 * duyệt được, và danh mục người ký không thêm được ai vì không ai đủ tư cách.
 *
 * BA BƯỚC, KHÔNG PHẢI HAI. Quyền hiệu dụng là GIAO của hai trục — `ScopeAssignment` ghi thẳng
 * trong schema: "Holding a role grants nothing here". Cấp vai `QL_NGHIA_TRANG` (phạm vi SITE)
 * mà QUÊN gán nghĩa trang thì `permissions.service.ts` trả danh sách nghĩa trang RỖNG và từ
 * chối mọi thứ — ghế duyệt CHẾT CÂM, và màn hình không nói vì sao. Đó là cái bẫy chính mà
 * script này sinh ra để không ai còn tự cắn.
 *
 * Mật khẩu BẮT BUỘC đến từ môi trường — không có credential nào được commit.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';
import { loadDotEnv } from './_env';
import { activeCardSigner } from '../src/common/lifecycle/active';

/* NẠP `.env` — đây là bước mà `seed-dev-user.ts`, `seed-scope.ts` và `seed-service-catalog.ts`
 * đang THIẾU. `tsx` không nạp gì cả, nên thiếu dòng này thì `DATABASE_URL` bắt buộc phải gõ
 * trên dòng lệnh, và người chạy nhận một lỗi kết nối chứ không phải một câu nói rõ vì sao. */
loadDotEnv();

const DEV_ENVIRONMENTS = ['development', 'test'];

/** Ai được ký thẻ mộ. Anh Bách chốt 05/09/2026: người ký LÀ người quản lý nghĩa trang. */
const SIGNER_ROLE = 'QL_NGHIA_TRANG';
/** Ai gửi hồ sơ xin cấp thẻ ở lát 1. */
const SALES_ROLE = 'KD_KINH_DOANH';

type Seat = { email: string; fullName: string; title: string; roleCode: string };

const SEATS: readonly Seat[] = [
  {
    email: 'quanly.nghiatrang@erp.local',
    fullName: 'Nguyễn Văn Quản',
    /* CHỨC DANH HÀNH CHÍNH — thứ IN LÊN tờ thẻ, khác hẳn mã vai kỹ thuật `QL_NGHIA_TRANG`.
     * Danh mục người ký chép đúng chuỗi này, nên nó phải đọc được trên giấy. */
    title: 'GIÁM ĐỐC NGHĨA TRANG',
    roleCode: SIGNER_ROLE,
  },
  {
    email: 'kinhdoanh@erp.local',
    fullName: 'Phạm Thị Kinh',
    title: 'NHÂN VIÊN KINH DOANH',
    roleCode: SALES_ROLE,
  },
];

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

  const password = process.env.SEED_STAFF_PASSWORD;
  if (password === undefined || password.length === 0) {
    throw new Error(
      'SEED_STAFF_PASSWORD env là BẮT BUỘC — không có mật khẩu nào được commit vào mã nguồn.',
    );
  }

  const prisma = new PrismaClient();
  try {
    const { company, cemetery } = await resolveTarget(prisma);
    console.log(`Công ty: ${company.code} · Nghĩa trang: ${cemetery.name}`);

    const passwordHash = await hash(password);
    const seeded: { seat: Seat; userId: string }[] = [];

    for (const seat of SEATS) {
      const role = await prisma.role.findUnique({ where: { code: seat.roleCode } });
      if (role === null) {
        throw new Error(
          `Không tìm thấy vai "${seat.roleCode}" — chạy \`pnpm --filter @erp/api db:seed\` trước.`,
        );
      }

      const user = await prisma.user.upsert({
        where: { email: seat.email },
        update: {
          passwordHash,
          status: 'active',
          fullName: seat.fullName,
          title: seat.title,
        },
        create: {
          id: ulid(),
          email: seat.email,
          passwordHash,
          status: 'active',
          fullName: seat.fullName,
          title: seat.title,
        },
      });

      /* TRỤC 1 — VAI, bó theo công ty. KHÔNG để `companyId = null`: đó nghĩa là "mọi công ty",
       * và một ghế tác nghiệp ở một nghĩa trang thì không có lý do gì phủ cả tập đoàn.
       * `grantedBy`/`grantReason` ghi rõ — 4 dòng ADMIN hiện có trong CSDL để trống hai cột
       * này, nên không truy được ai cấp và vì sao. Đừng thêm dòng thứ năm như thế. */
      const existingRole = await prisma.roleAssignment.findFirst({
        where: { userId: user.id, roleId: role.id, companyId: company.id },
      });
      if (existingRole === null) {
        await prisma.roleAssignment.create({
          data: {
            id: ulid(),
            userId: user.id,
            roleId: role.id,
            companyId: company.id,
            grantedBy: 'seed:seed-cemetery-staff',
            grantReason: 'Dựng diễn viên cho luồng phê duyệt in thẻ mộ (lát 0, 05/09/2026)',
          },
        });
      }

      /* TRỤC 2 — NGHĨA TRANG. Bước hay bị quên nhất, và quên thì không có gì báo: người dùng
       * đăng nhập được, thấy menu, bấm vào thì mọi thứ rỗng hoặc 403. */
      const existingScope = await prisma.scopeAssignment.findFirst({
        where: { userId: user.id, cemeteryId: cemetery.id },
      });
      if (existingScope === null) {
        await prisma.scopeAssignment.create({
          data: {
            id: ulid(),
            userId: user.id,
            cemeteryId: cemetery.id,
            grantedBy: 'seed:seed-cemetery-staff',
          },
        });
      }

      seeded.push({ seat, userId: user.id });
      console.log(`  ✓ ${seat.email} — ${seat.title} · vai ${seat.roleCode} · nghĩa trang đã gán`);
    }

    await seedSigner(prisma, seeded, cemetery.id, cemetery.name);
    console.log('\nXong. Mật khẩu của cả hai tài khoản = SEED_STAFF_PASSWORD vừa truyền vào.');
  } finally {
    await prisma.$disconnect();
  }
}

/* Đưa người quản lý nghĩa trang vào DANH MỤC NGƯỜI KÝ và đặt làm mặc định của nghĩa trang đó.
 *
 * Chép `fullName`/`title` từ hồ sơ tài khoản, đúng như `CardSignersService.create` làm — hai
 * đường phải sinh ra cùng một hình dạng dữ liệu, nếu không thì dòng do seed tạo sẽ khác dòng
 * do người dùng tạo và không ai biết cho tới lúc in ra tờ thẻ.
 */
async function seedSigner(
  prisma: PrismaClient,
  seeded: { seat: Seat; userId: string }[],
  cemeteryId: string,
  cemeteryName: string,
): Promise<void> {
  const manager = seeded.find((s) => s.seat.roleCode === SIGNER_ROLE);
  if (manager === undefined) {
    return;
  }

  const existing = await prisma.cardSigner.findFirst({
    where: { userId: manager.userId, cemeteryId, ...activeCardSigner },
  });
  if (existing !== null) {
    console.log(`  · người ký đã có sẵn cho ${cemeteryName}, không tạo lại`);
    return;
  }

  /* Bỏ cờ mặc định của nghĩa trang NÀY trước, trong cùng giao dịch — `card_signers_one_default_per_site`
   * chỉ cho một dòng mặc định mỗi nghĩa trang. Lọc theo `cemeteryId`, KHÔNG bỏ cờ toàn hệ:
   * làm thế là lặng lẽ cướp người ký mặc định của một nghĩa trang chẳng liên quan. */
  await prisma.$transaction(async (tx) => {
    await tx.cardSigner.updateMany({
      where: { isDefault: true, cemeteryId },
      data: { isDefault: false },
    });
    await tx.cardSigner.create({
      data: {
        id: ulid(),
        userId: manager.userId,
        cemeteryId,
        fullName: manager.seat.fullName,
        title: manager.seat.title,
        isDefault: true,
        createdBy: 'seed:seed-cemetery-staff',
      },
    });
  });
  console.log(`  ✓ người ký mặc định của ${cemeteryName}: ${manager.seat.fullName}`);
}

/* Chọn công ty và nghĩa trang đích.
 *
 * Bắt người chạy CHỌN thay vì đoán hộ, cùng nếp `seed-dev-user.ts`: CSDL dev có 9 công ty mà
 * 8 là rác test, nên "lấy công ty đầu tiên" sẽ dựng người vào một công ty không có khách nào.
 * Chỉ tự suy khi có đúng một ứng viên — lúc đó không còn gì để chọn sai.
 */
async function resolveTarget(prisma: PrismaClient): Promise<{
  company: { id: string; code: string };
  cemetery: { id: string; name: string };
}> {
  const code = process.env.SEED_STAFF_COMPANY;
  let company: { id: string; code: string } | null = null;

  if (code !== undefined && code.length > 0) {
    company = await prisma.company.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    if (company === null) {
      throw new Error(`Không tìm thấy công ty có mã "${code}"`);
    }
  } else {
    const companies = await prisma.company.findMany({ select: { id: true, code: true }, take: 2 });
    const only = companies[0];
    if (companies.length !== 1 || only === undefined) {
      throw new Error(
        'Phải chỉ rõ công ty: đặt SEED_STAFF_COMPANY=<mã công ty>. ' +
          'CSDL dev có nhiều công ty và phần lớn là dữ liệu thử, nên đoán hộ sẽ dựng người vào nhầm chỗ.',
      );
    }
    company = only;
  }

  const cemeteries = await prisma.cemetery.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  const first = cemeteries[0];
  if (first === undefined) {
    throw new Error(`Công ty ${company.code} chưa có nghĩa trang nào — seed hạ tầng trước.`);
  }
  if (cemeteries.length > 1) {
    /* Danh mục người ký gắn theo NGHĨA TRANG (anh Bách chốt 05/09), nên "công ty này" không
     * còn đủ để xác định đích. Nói ra thay vì lặng lẽ lấy cái đầu tiên. */
    console.log(
      `  ! Công ty ${company.code} có ${cemeteries.length} nghĩa trang — script này dựng cho "${first.name}". ` +
        'Nghĩa trang còn lại cần người ký riêng, thêm tay ở Danh mục › Người ký thẻ mộ.',
    );
  }
  return { company, cemetery: first };
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
