/* Đối chiếu DANH MỤC QUYỀN trong mã nguồn với BẢNG `authz.permissions` trong CSDL.
 *
 * VÌ SAO PHẢI CÓ (đo được 03/09/2026): hai cửa vào bảng này KHÔNG đối xứng.
 *   · Cửa XOÁ mã đi qua `prisma migrate deploy` — chạy tự động mỗi lần triển khai, và đã
 *     dùng thật hai lần (`20260825200000_drop_wildcard_permission`,
 *     `20260826151000_drop_person_search_permission`).
 *   · Cửa THÊM mã chỉ đi qua `prisma db seed`, mà KHÔNG lệnh nào tự gọi (`postinstall`
 *     chỉ `prisma generate`).
 * Nên thêm một dòng `p('...')` vào danh mục là một thay đổi có thể triển khai xong mà
 * CSDL không hề biết. Chú thích ở đầu `permission-catalog.ts` đã dặn "adding one is a
 * deliberate edit + migration" từ đầu; nó chưa bao giờ được ÉP. Đây là chỗ ép.
 *
 * HÀM THUẦN, CỐ Ý: không Nest, không Prisma, không đọc file, không biến môi trường. Nhờ
 * vậy nó chạy được trong bộ vitest hiện có — CI (`.github/workflows/ci.yml`) không có
 * Postgres, nên bất cứ thứ gì cần CSDL là thứ CI không canh được. Việc lấy dữ liệu thật
 * là của `scripts/authz-catalog-check.ts`; việc SO SÁNH là của file này.
 *
 * ĐỪNG dùng phép đếm "danh mục có bao nhiêu mã / CSDL có bao nhiêu dòng" thay cho hàm
 * này, và nhất là đừng chạy nó ngay sau khi seed: `prisma/seed.ts` import THẲNG
 * `PERMISSION_CATALOG` rồi upsert, nên trên một CSDL vừa seed thì đó là so một danh sách
 * với CHÍNH NÓ — không bao giờ đỏ, kể cả khi mọi thứ đang sai.
 *
 *
 * BA NHÓM LỆCH, KHÔNG PHẢI MỘT — vì hậu quả của chúng khác hẳn nhau, và gộp lại thành
 * một con số "lệch N dòng" là làm mất đúng cái thông tin để quyết định phải làm gì.
 *
 * 1. THIẾU MÃ — có trong mã nguồn, không có dòng trong CSDL. Đây là lỗi 03/09/2026.
 *    Hậu quả: CHẾT TÍNH NĂNG, KHÔNG BAO GIỜ CẤP THỪA. Đã đọc `permission.guard.ts` để
 *    xác minh chứ không đoán: guard gọi `permissions.getPermissionMeta(required)`, hàm
 *    này `findUnique` trên bảng `authz.permissions`; không có dòng thì trả `null`, và
 *    guard ném ngay `ForbiddenException('Mã quyền không có trong danh mục: ...')` TRƯỚC
 *    khi hỏi ma trận vai. Fail-closed đúng nghĩa: mọi người đều bị chặn, ADMIN cũng vậy,
 *    và chặn với một câu lỗi không giống "thiếu quyền" nên dễ bị đọc nhầm thành lỗi cấp
 *    quyền. Cách sửa: chạy seed. Seed chỉ thêm dòng danh mục, KHÔNG cấp cho ai.
 *
 * 2. MÃ THỪA — còn dòng trong CSDL, không còn trong mã nguồn. Đây là nhóm NGUY HIỂM.
 *    Hậu quả ngược hẳn nhóm 1: dòng còn đó nên `getPermissionMeta` trả về khác `null`,
 *    guard đi tiếp, và `authz.role_permissions` vẫn trỏ vào nó được — tức là mã vẫn CẤP
 *    ĐƯỢC từ màn hình quản trị và vẫn MỞ CỬA ĐƯỢC, trong khi đọc mã nguồn không thấy nó
 *    ở đâu. Một quyền không ai rà được bằng cách đọc code. Cách sửa KHÔNG phải là seed
 *    (seed không xoá gì): phải viết migration xoá, và xoá cả `role_permissions` trỏ vào
 *    nó — đúng nếp hai migration `drop_*_permission` đã có.
 *
 * 3. LỆCH SIÊU DỮ LIỆU — cùng mã, khác `sensitivity` hoặc `wildcardExempt`. Nhóm này im
 *    lặng nhất vì cả hai bên đều "có mã", đếm bao nhiêu cũng khớp.
 *    Hậu quả của `wildcardExempt` là LEO THANG: guard đọc cờ này từ DÒNG CSDL rồi truyền
 *    vào `permissionMatches(..., { wildcardExempt })`. Nguồn ghi `true` (mọi leaf S3) mà
 *    CSDL còn `false` thì một grant `*` với tới được leaf S3 — đúng thứ mà việc bỏ
 *    `*.*.*` sinh ra để chặn, và đọc mã nguồn sẽ không bao giờ thấy.
 *    Hậu quả của `sensitivity` là RÀ SAI: `authz-matrix.service.ts` đọc cột này từ CSDL
 *    cho màn hình ma trận, nên người duyệt nhìn thấy "S1" cạnh một mã mà nguồn đã nâng
 *    lên "S3" và cấp nó như một quyền vô hại.
 */

/** Một dòng danh mục trong MÃ NGUỒN. Chỉ ba trường mà seed thực sự ghi và guard thực sự
 * đọc; `description`/`introducedIn` cố ý không so — sửa một câu mô tả không phải là một
 * thay đổi quyền, và bắt nó đỏ là dạy người ta bỏ qua đèn đỏ. */
export interface CatalogPermission {
  readonly code: string;
  readonly sensitivity: string;
  readonly wildcardExempt: boolean;
}

/** Một dòng đọc từ `authz.permissions`.
 * `sensitivity` để `string` chứ không phải union 'S0'|'S1'|'S2'|'S3': cột đó là `String`
 * trong Prisma và không có ràng buộc CHECK, nên nó GIỮ ĐƯỢC 'S9' hay chuỗi rỗng. Khai
 * union ở đây là nói dối về dữ liệu thật và làm hàm này mù đúng cái nó phải bắt. */
export interface StoredPermission {
  readonly code: string;
  readonly sensitivity: string;
  readonly wildcardExempt: boolean;
}

/** Một trường lệch. Giá trị để dạng chuỗi để in ra được đồng nhất, không phải vì không
 * biết kiểu — `wildcardExempt` là boolean, ở đây nó thành 'true'/'false'. */
export interface MetadataDrift {
  readonly code: string;
  readonly field: 'sensitivity' | 'wildcardExempt';
  readonly inSource: string;
  readonly inDatabase: string;
}

export interface CatalogDrift {
  /** Nhóm 1 — có trong nguồn, thiếu dòng CSDL. Chết tính năng. */
  readonly missingInDatabase: readonly CatalogPermission[];
  /** Nhóm 2 — còn dòng CSDL, không còn trong nguồn. Quyền không ai rà được. */
  readonly orphanedInDatabase: readonly StoredPermission[];
  /** Nhóm 3 — cùng mã, khác siêu dữ liệu. Leo thang / rà sai. */
  readonly metadataMismatches: readonly MetadataDrift[];
}

/* Sắp theo mã để đầu ra ổn định: hai lần chạy trên cùng dữ liệu phải cho cùng một bản in,
 * nếu không thì không diff được hai lần chạy — mà diff hai lần chạy chính là cách dùng. */
function byCode<T extends { readonly code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

/** So danh mục mã nguồn với ảnh chụp bảng `authz.permissions`, trả về ba nhóm lệch. */
export function diffCatalogAgainstDatabase(
  catalog: readonly CatalogPermission[],
  database: readonly StoredPermission[],
): CatalogDrift {
  const storedByCode = new Map(database.map((row) => [row.code, row]));
  const catalogCodes = new Set(catalog.map((def) => def.code));

  const missingInDatabase: CatalogPermission[] = [];
  const metadataMismatches: MetadataDrift[] = [];

  for (const def of catalog) {
    const stored = storedByCode.get(def.code);
    if (stored === undefined) {
      missingInDatabase.push(def);
      continue;
    }
    /* Hai trường so RIÊNG, không gộp thành một dòng "khác siêu dữ liệu": người đọc phải
     * thấy ngay cái nào lệch, vì một cái là leo thang và một cái là rà sai. */
    if (stored.sensitivity !== def.sensitivity) {
      metadataMismatches.push({
        code: def.code,
        field: 'sensitivity',
        inSource: def.sensitivity,
        inDatabase: stored.sensitivity,
      });
    }
    if (stored.wildcardExempt !== def.wildcardExempt) {
      metadataMismatches.push({
        code: def.code,
        field: 'wildcardExempt',
        inSource: String(def.wildcardExempt),
        inDatabase: String(stored.wildcardExempt),
      });
    }
  }

  const orphanedInDatabase = database.filter((row) => !catalogCodes.has(row.code));

  return {
    missingInDatabase: byCode(missingInDatabase),
    orphanedInDatabase: byCode(orphanedInDatabase),
    metadataMismatches: byCode(metadataMismatches),
  };
}

/** Tổng số dòng lệch của cả ba nhóm — CHỈ để quyết định mã thoát, không để báo cáo.
 * Báo cáo phải in ba nhóm riêng; xem chú thích đầu file. */
export function totalDrift(drift: CatalogDrift): number {
  return (
    drift.missingInDatabase.length +
    drift.orphanedInDatabase.length +
    drift.metadataMismatches.length
  );
}
