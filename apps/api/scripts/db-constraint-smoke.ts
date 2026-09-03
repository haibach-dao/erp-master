/* Thử xem các ràng buộc CSDL có THẬT SỰ CHẶN không.
 *
 *   pnpm --filter @erp/api exec tsx scripts/db-constraint-smoke.ts
 *
 * VÌ SAO CẦN. `CHECK` và partial unique index chỉ tồn tại trong SQL thuần của migration —
 * `schema.prisma` không diễn tả được chúng, `prisma migrate diff` không nhìn thấy chúng, và
 * mock Prisma trong vitest không dựng lại được chúng. Nghĩa là hôm nay chúng KHÔNG có một
 * phép kiểm tự động nào: một migration gõ sai điều kiện `WHERE` sẽ áp trót lọt, mọi test xanh,
 * và ràng buộc lặng lẽ không chặn gì cả.
 *
 * Đó không phải lo xa. Chính repo này đã ghi lại một lần `CHECK` bị vô hiệu vì chạm cột NULL
 * (biểu thức ra NULL thì `CHECK` cho qua) — nếp `IS TRUE` ra đời từ đó. Một cái bọc `IS TRUE`
 * viết sai chỗ trông y hệt một cái viết đúng.
 *
 * MỌI PHÉP THỬ NẰM TRONG GIAO DỊCH VÀ ROLLBACK — script này không để lại một dòng nào.
 *
 * Có ca `nhận` chứ không chỉ ca `chặn`, và đó là phần quan trọng nhất: một index chặn được thứ
 * phải chặn nhưng cũng chặn luôn thứ phải cho qua là một index đã hỏng theo chiều khó thấy hơn.
 * Ca `card_signers`: hai người TRÙNG TÊN được phép tồn tại nếu một người đã ngừng dùng — đó
 * chính là mệnh đề `WHERE status = 'Active'`, và nếu ai đó bỏ mệnh đề ấy đi thì tên người đã
 * nghỉ không lưu lại được nữa, mà không phép kiểm nào khác thấy.
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from './_env';

loadDotEnv();

const prisma = new PrismaClient();

/* Ném ra để buộc Prisma cuộn giao dịch lại, kể cả khi mọi lệnh đều chạy trót lọt. */
const ROLLBACK = Symbol('rollback');

interface Case {
  /** Câu mô tả đọc lên là hiểu luật nghiệp vụ, không phải tên ràng buộc. */
  readonly name: string;
  readonly statements: readonly string[];
  /** `reject` = CSDL phải từ chối; `accept` = CSDL phải cho qua. */
  readonly expect: 'reject' | 'accept';
  /** Chuỗi phải có trong câu lỗi. Bắt ĐÚNG ràng buộc, chứ không phải "có lỗi nào đó" — một
   * lỗi cú pháp cũng là lỗi, và nó sẽ làm phép thử xanh giả. Chỉ dùng khi `expect: 'reject'`.
   *
   * ĐO ĐƯỢC 03/09/2026, và đây là chỗ dễ viết sai nhất: qua đường RAW, Prisma gói mọi lỗi
   * Postgres thành `P2010` và `meta` chỉ còn `{ code, message }` — TÊN INDEX BỊ BỎ MẤT.
   * Nên ca UNIQUE không đối chiếu được theo tên; thứ còn lại và ổn định là DANH SÁCH CỘT trong
   * câu của Postgres: `Key (is_default)=(t) already exists.`
   * Ca `CHECK` thì ngược lại — Postgres nêu thẳng tên ràng buộc và Prisma giữ nguyên, nên đối
   * chiếu theo tên được. Hai loại ràng buộc, hai cách nhận dạng; gộp làm một là sai. */
  readonly expectError?: string;
}

const SIGNER = (id: string, name: string, title: string, isDefault: boolean, status: string) =>
  `INSERT INTO cemetery.card_signers (id, full_name, title, is_default, status, updated_at)
   VALUES ('${id}', '${name}', '${title}', ${String(isDefault)}, '${status}', now())`;

const CASES: readonly Case[] = [
  {
    name: 'card_signers · toàn hệ nhiều nhất MỘT người ký mặc định',
    statements: [
      SIGNER('smoke1', 'Nguoi A', 'GIAM DOC', true, 'Active'),
      SIGNER('smoke2', 'Nguoi B', 'PHO GIAM DOC', true, 'Active'),
    ],
    expect: 'reject',
    expectError: 'Key (is_default)',
  },
  {
    name: 'card_signers · người đã NGỪNG DÙNG không được là mặc định',
    statements: [SIGNER('smoke1', 'Nguoi A', 'GIAM DOC', true, 'Retired')],
    expect: 'reject',
    expectError: 'card_signers_default_active_check',
  },
  {
    name: 'card_signers · trạng thái là TẬP ĐÓNG (gõ thường không lọt)',
    statements: [SIGNER('smoke1', 'Nguoi A', 'GIAM DOC', false, 'active')],
    expect: 'reject',
    expectError: 'card_signers_status_check',
  },
  {
    name: 'card_signers · hai người ĐANG DÙNG không được trùng cả tên lẫn chức danh',
    statements: [
      SIGNER('smoke1', 'Nguoi A', 'GIAM DOC', false, 'Active'),
      SIGNER('smoke2', 'Nguoi A', 'GIAM DOC', false, 'Active'),
    ],
    expect: 'reject',
    expectError: 'Key (full_name, title)',
  },
  {
    /* Ca NHẬN — chứng minh index kia là index MỘT PHẦN chứ không phải index toàn phần. Bỏ mệnh
     * đề `WHERE status = 'Active'` đi thì ca này đỏ, và không gì khác trong repo thấy được. */
    name: 'card_signers · trùng tên với một người ĐÃ NGHỈ thì PHẢI cho qua',
    statements: [
      SIGNER('smoke1', 'Nguoi A', 'GIAM DOC', false, 'Retired'),
      SIGNER('smoke2', 'Nguoi A', 'GIAM DOC', false, 'Active'),
    ],
    expect: 'accept',
  },
];

/* Gộp `message` VÀ `meta` thành MỘT chuỗi để đối chiếu.
 *
 * Phải có `meta`, vì qua đường raw thì `message` gần như không mang thông tin: nó mở đầu bằng
 * một dòng trống rồi tới "Invalid `prisma.$executeRawUnsafe()` invocation:". Thứ nói được
 * chuyện gì đã xảy ra nằm ở `meta` — đo thật 03/09/2026:
 *   { "code": "23505", "message": "Key (is_default)=(t) already exists." }
 * `23505` là unique_violation, `23514` là check_violation của Postgres. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const meta = (err as { meta?: unknown }).meta;
  return meta === undefined ? err.message : `${err.message} ${JSON.stringify(meta)}`;
}

/** Ép về MỘT dòng để bảng kết quả không vỡ. Không cắt lấy dòng đầu — dòng đầu của Prisma là
 * dòng vô nghĩa nhất, còn phần `meta` mới là phần cần đọc, và nó nằm ở cuối. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat;
}

/** Chạy các lệnh trong một giao dịch rồi CUỘN LẠI. Trả câu lỗi nếu CSDL từ chối, `null` nếu qua. */
async function attempt(statements: readonly string[]): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const sql of statements) {
        await tx.$executeRawUnsafe(sql);
      }
      throw ROLLBACK;
    });
  } catch (err) {
    if (err === ROLLBACK) return null;
    return errorText(err);
  }
  /* Không tới được: callback luôn ném. Có nhánh này để kiểu trả về không phải `string | null | undefined`. */
  return null;
}

async function main(): Promise<void> {
  console.log('# Thử ràng buộc CSDL (mọi phép thử đều rollback)\n');

  let failed = 0;
  for (const c of CASES) {
    const error = await attempt(c.statements);

    if (c.expect === 'accept') {
      if (error === null) {
        console.log(`  OK    NHẬN   ${c.name}`);
      } else {
        failed += 1;
        console.log(`  HỎNG  NHẬN   ${c.name}`);
        console.log(`        CSDL từ chối một thứ lẽ ra phải cho qua: ${oneLine(error)}`);
      }
      continue;
    }

    if (error === null) {
      failed += 1;
      console.log(`  HỎNG  CHẶN   ${c.name}`);
      console.log('        CSDL CHO QUA — ràng buộc không còn tác dụng.');
    } else if (c.expectError !== undefined && !error.includes(c.expectError)) {
      /* Có lỗi nhưng SAI LOẠI. Không tính là qua: một lỗi cú pháp trong chính phép thử cũng ném
       * ra lỗi, và đếm nó là "chặn được" là cách phép thử tự nói dối. */
      failed += 1;
      console.log(`  HỎNG  CHẶN   ${c.name}`);
      console.log(`        Có lỗi nhưng KHÔNG phải \`${c.expectError}\`: ${oneLine(error)}`);
    } else {
      console.log(`  OK    CHẶN   ${c.name}`);
    }
  }

  await prisma.$disconnect();

  console.log('');
  if (failed === 0) {
    console.log(`${CASES.length}/${CASES.length} ràng buộc còn nguyên tác dụng.`);
    return;
  }
  console.log(`!! ${failed}/${CASES.length} phép thử HỎNG. Ràng buộc trong migration không còn`);
  console.log('   chặn đúng thứ nó sinh ra để chặn — đọc từng dòng HỎNG ở trên.');
  process.exitCode = 1;
}

/* Không nối được CSDL cũng là THOÁT 1: đây là bước gác trong CI, và "chưa biết" phải chặn giống
 * "có hỏng". Cùng lý lẽ đã ghi ở `authz-catalog-check.ts`. */
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
