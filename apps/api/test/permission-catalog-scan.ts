import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/* Quét: mã quyền nào được MIGRATION mang đi, mã nào đã bị migration GỠ, và mã nào đang được
 * `apps/web` dùng.
 *
 * VÌ SAO CẦN CÁI LƯỚI NÀY — một bất đối xứng đo được ngày 03/09/2026. Hai cửa vào bảng
 * `authz.permissions` KHÔNG giống nhau:
 *   · Cửa XOÁ đi qua `prisma migrate deploy`, chạy TỰ ĐỘNG mỗi lần triển khai. Đã dùng thật
 *     hai lần: `20260825200000_drop_wildcard_permission`, `20260826151000_drop_person_search_permission`.
 *   · Cửa THÊM chỉ đi qua `prisma db seed`, mà KHÔNG lệnh nào tự gọi — `postinstall` chỉ chạy
 *     `prisma generate`.
 * Nên thêm một dòng `p('...')` vào danh mục là một thay đổi có thể triển khai xong xuôi mà CSDL
 * không hề biết. Đó đúng là chuyện đã xảy ra: hai mã người ký thẻ mộ vào mã nguồn, 814 test xanh,
 * và mục menu biến mất với mọi người dùng vì `authz.permissions` chưa có hai dòng đó.
 *
 * Chú thích ở đầu `permission-catalog.ts` đã dặn từ đầu — "adding one is a deliberate edit +
 * migration". Luật có sẵn; chỗ ÉP thì chưa bao giờ tồn tại. Đây là chỗ ép.
 *
 * KHÔNG so danh mục với CSDL ở tầng test, và đó là chủ ý. `prisma/seed.ts` import THẲNG
 * `PERMISSION_CATALOG` rồi upsert, nên trên một CSDL vừa seed thì phép so ấy là so một danh sách
 * với CHÍNH NÓ: không bao giờ đỏ được, kể cả hôm 03/09. Việc đối chiếu CSDL thật là của
 * `scripts/authz-catalog-check.ts` và người gác lúc boot; việc của file này là ép cái ĐIỀU KIỆN
 * khiến CSDL nào rồi cũng nhận được mã mới.
 */

/* Mã quyền được migration MANG ĐI: chuỗi mã nằm trong một `migration.sql` nào đó.
 *
 * Đối chiếu dạng CÓ NHÁY vì mã quyền trong SQL luôn là literal `'...'`. Không có nháy thì
 * `cemetery.card.view` khớp nhầm vào giữa `cemetery.card.view_sensitive` và một mã chưa có
 * migration sẽ lặng lẽ được coi là đã có. */
const SQL_STRING_LITERAL = /'([^']*)'/g;

/* Mã bị GỠ khỏi danh mục bằng migration. Chỉ bắt dạng xoá theo MÃ CỤ THỂ.
 *
 * Cố ý không bắt dạng xoá theo HÌNH DẠNG — `drop_wildcard_permission` còn một lệnh
 * `DELETE ... WHERE array_length(string_to_array(code, '.'), 1) <> 3` dọn mã sai số đoạn. Lệnh
 * ấy không nêu tên mã nào, nên không có gì để đối chiếu; và mã sai số đoạn đã bị chặn ở tầng
 * khác rồi (`authz-invariants` canh đúng ba đoạn). */
const DELETE_PERMISSION_BY_CODE =
  /DELETE\s+FROM\s+authz\.permissions\s+WHERE\s+code\s*=\s*'([^']+)'/gi;

/* Mã quyền dùng ở web: literal đúng ba đoạn `module.resource.action`.
 *
 * Hẹp có chủ ý — chỉ `[a-z][a-z0-9_]*` từng đoạn, đúng hình dạng mà `permission-catalog.ts` cho
 * phép. Nới ra để bắt cả `foo.Bar.baz` là mời vào hàng loạt chuỗi không phải mã quyền (đường dẫn,
 * tên tệp, chuỗi i18n), và một cái lưới đầy dương tính giả là một cái lưới người ta học cách tắt. */
const WEB_PERMISSION_LITERAL = /'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g;

/* Thư mục sinh ra, không phải mã người viết. Quét vào đây là quét bản build của chính mình. */
const WEB_SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo']);

export interface RetiredCode {
  /** Mã đã bị một migration xoá khỏi danh mục. */
  code: string;
  /** `20260826151000_drop_person_search_permission/migration.sql` — id ổn định để nêu tên. */
  id: string;
}

export interface WebCodeRef {
  code: string;
  /** `lib/nav.ts` — id ổn định, đủ để mở đúng file. */
  id: string;
}

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (WEB_SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, keep, out);
    } else if (keep(name)) {
      out.push(p);
    }
  }
  return out;
}

/** `a\b\c.ts` -> `a/b/c.ts`. Đường dẫn trong sổ phải giống nhau ở Windows và Linux, nếu không
 * thì một sổ nợ viết trên máy này không khớp trên CI. */
function idOf(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function migrationFiles(migrationsRoot: string): string[] {
  return walk(migrationsRoot, (name) => name === 'migration.sql');
}

/** Mọi chuỗi literal xuất hiện trong các file migration — tập để tra "mã này có được migration
 * nào mang đi không". */
export function codesCarriedByMigration(migrationsRoot: string): Set<string> {
  const carried = new Set<string>();
  for (const file of migrationFiles(migrationsRoot)) {
    const text = readFileSync(file, 'utf8');
    /* `matchAll` chứ KHÔNG `exec()` trong vòng lặp: hằng regex `/g` ở cấp module mang `lastIndex`
     * sang lần gọi sau và bỏ sót từ file thứ hai trở đi. */
    for (const m of text.matchAll(SQL_STRING_LITERAL)) {
      const value = m[1];
      if (value !== undefined) carried.add(value);
    }
  }
  return carried;
}

/** Các mã đã bị migration gỡ khỏi danh mục, kèm tên migration đã gỡ. */
export function codesRetiredByMigration(migrationsRoot: string): RetiredCode[] {
  const retired: RetiredCode[] = [];
  for (const file of migrationFiles(migrationsRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(DELETE_PERMISSION_BY_CODE)) {
      const code = m[1];
      if (code !== undefined) retired.push({ code, id: idOf(migrationsRoot, file) });
    }
  }
  return retired;
}

/** Mọi mã quyền `apps/web` đang dùng — ở `lib/nav.ts`, ở các lời gọi `can(...)`, ở bất cứ đâu.
 *
 * Phải quét từ đây chứ không đặt test bên web: `apps/web/package.json` KHÔNG có script `test`,
 * nên `pnpm -r test` không bao giờ với tới một file nằm trong đó. */
export function scanWebPermissionCodes(webRoot: string): WebCodeRef[] {
  const refs: WebCodeRef[] = [];
  const files = walk(webRoot, (name) => name.endsWith('.ts') || name.endsWith('.tsx'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(WEB_PERMISSION_LITERAL)) {
      const code = m[1];
      if (code !== undefined) refs.push({ code, id: idOf(webRoot, file) });
    }
  }
  return refs;
}
