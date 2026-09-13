import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/* Quét mã nguồn tìm CỬA SỔ HIỆU LỰC CỦA QUYỀN bị chép tay.
 *
 * Anh em ruột với `status-filter-scan.ts`, cùng một bệnh, khác bộ cột. Ở đó là "mỗi nơi tự
 * quyết định thế nào là còn hiệu lực" trên cột `status`; ở đây là trên cặp
 * `valid_from`/`valid_to` của ba bảng cấp quyền: `RoleAssignment`, `ScopeAssignment`,
 * `AccessRule`.
 *
 * LỖI ĐÃ TRẢ GIÁ (09/09/2026): `common/lifecycle/active.ts` có sẵn một bản dùng chung tên
 * `stillValid()`, nhưng nó KHÔNG DÙNG ĐƯỢC — mang nhánh `{ validFrom: null }` trong khi cột
 * là NOT NULL, nên còn không qua nổi kiểu Prisma. Hệ quả đo được: không một chỗ nào gọi nó,
 * và mảnh này bị chép tay ở SÁU chỗ trong `apps/api`. Một trong sáu bản dùng `gte` thay vì
 * `gt`, tức đúng khoảnh khắc `validTo = now` thì danh mục người ký nói "được ký" còn
 * `PermissionGuard` nói 403: người dùng thấy nút bấm được, bấm vào thì bị từ chối, và không
 * gì trên màn hình giải thích nổi.
 *
 * Vá sáu chỗ là vá sáu CA. Lưới này là thuốc: thêm một bản chép tay ở một gốc ĐANG ĐƯỢC QUÉT
 * là ĐỎ, chứ không lặng lẽ đẻ ra nguồn sự thật thứ hai cho tầng QUYỀN.
 *
 * BẢN THỨ BẢY KHÔNG PHẢI CHUYỆN TƯƠNG LAI — nó đã nằm sẵn ở `apps/worker/src/agent-identity.ts`
 * suốt lượt gom, và lưới bản đầu KHÔNG hề đỏ vì nó chỉ được trỏ vào `apps/api`. Bộ quét không
 * hỏng; không ai chia nó về phía đó. Đó là lý do gốc quét nay gồm cả `apps/worker/src`, và là
 * lời nhắc rằng phạm vi quét mới là thứ quyết định lưới này bắt được gì — không phải regex.
 *
 * BA dạng bị bắt, vì cùng một bệnh có ba cách viết ra:
 *   1. Mệnh đề `where` chép tay  — `validFrom: { lte: now }` / `validTo: { gt: now }`.
 *   2. Biên SAI                  — `validTo: { gte: now }`, gộp luôn vào dạng 1.
 *   3. VỊ TỪ chép tay trên dòng đã đọc — `r.validTo > now`, dạng của `grantInForceAt`.
 *
 * Và một dạng thứ tư, không phải bản sao mà là cách DÙNG SAI bản gốc — xem
 * `scanGrantSpreadCollisions` ở cuối file.
 *
 * Vế GHI không bị soi và không cần soi: đặt `data: { validTo: new Date() }` là gán một Date,
 * không mang hình dạng `{ toán_tử: ... }` mà lưới tìm. Nên ở đây không cần đoán đọc/ghi như
 * `status-filter-scan.ts` phải làm — bớt được đúng cái chỗ hay báo nhầm nhất của lưới kia.
 */

/* SOI TRÊN CẢ FILE, KHÔNG SOI TỪNG DÒNG.
 *
 * Bản đầu tách nguồn ra thành từng dòng rồi thử regex trên mỗi dòng. Hệ quả: một mệnh đề bị
 * XUỐNG DÒNG là lọt sạch — mà `validFrom: {\n  lte: now,\n}` chính là thứ Prettier sinh ra khi
 * dòng dài quá. Bản đã đo: cả `gte` sai biên viết theo lối xuống dòng cũng lọt.
 *
 * Nay regex chạy trên TOÀN BỘ nguồn (đã xoá chú thích/chuỗi), nên `\s*` nuốt luôn dấu xuống
 * dòng; số dòng tính ngược lại từ vị trí ký tự. Phải tính bằng offset chứ không tách dòng,
 * đó là toàn bộ điểm khác nhau.
 */

/** Dạng 1 + 2: so sánh trên `validFrom`/`validTo` trong một mệnh đề lọc. */
const WHERE_COMPARISON = /\bvalid(?:From|To)\s*:\s*\{\s*(?:lte|lt|gte|gt)\b/g;

/* Dạng 3: so sánh trên một bản ghi đã đọc về (`row.validTo > now`).
 *
 * KHÔNG đòi dấu `.` đứng trước tên cột. Bản đầu đòi, và một dòng đã phá cấu trúc
 * (`const { validFrom, validTo } = row; return validFrom <= now && ...`) lọt qua — cùng một
 * luật, cùng một chỗ sai được, chỉ khác cách gõ.
 *
 * CỐ Ý loại `===`/`!==`: `r.validTo === null` một mình không phải phép xét cửa sổ hiệu lực,
 * nó là một phép kiểm null bình thường (`authz-rules.ts` in ra "vô thời hạn" bằng đúng nó).
 * Bắt cả thứ đó là báo nhầm, mà báo nhầm làm hỏng lưới: người ta ghi bừa lý do miễn trừ cho
 * đỡ đỏ, rồi lần sau miễn trừ thật lọt theo — bài học đã ghi ở `status-filter-scan.ts`.
 */
const PREDICATE_COMPARISON = /\bvalid(?:From|To)\s*(?:<=|>=|<|>)(?!=)/g;

export interface GrantWindowHit {
  file: string;
  line: number;
  kind: 'where' | 'predicate';
  text: string;
}

/* Đường dẫn báo ra là ĐƯỜNG TỪ GỐC REPO (`apps/api/src/...`, `apps/worker/src/...`), không
 * phải đường tương đối theo từng gốc quét. Từ khi quét nhiều package, `agent-identity.ts`
 * trần trụi không nói được nó ở app nào — mà sổ nợ thì phải đọc ra được là ai đang nợ. */
const REPO_ROOT = join(__dirname, '..', '..', '..');

/* Chỉ file ĐỊNH NGHĨA được phép viết mảnh này ra — đó là việc của nó, và đó là lý do nó tồn
 * tại. Đúng MỘT miễn trừ, cùng nếp `status-filter-scan.ts`. */
const DEFINITION_FILE = 'apps/api/src/common/lifecycle/active.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/* Xoá CHÚ THÍCH và CHUỖI, thay bằng khoảng trắng để giữ nguyên số dòng và vị trí ký tự.
 *
 * Bắt buộc, không phải cho gọn: `common/lifecycle/active.ts` chép nguyên mảnh vào chú thích
 * để giải thích cái bẫy, và mọi câu lỗi tiếng Việt đều là chuỗi. Lưới nhìn thấy chữ trong
 * chú thích rồi báo đỏ là lưới dạy người ta đừng viết chú thích.
 *
 * Giữ nguyên ĐỘ DÀI là một hợp đồng, không phải chi tiết cài đặt: cả số dòng lẫn đoạn trích
 * đều tính bằng offset trên nguồn GỐC, nên một ký tự lệch là chỉ sai chỗ.
 *
 * Chuỗi mẫu (`/.../`) KHÔNG được xử lý riêng — chấp nhận được, vì phép đếm ngoặc ở
 * `scanGrantSpreadCollisions` chỉ chạy NGƯỢC từ một vị trí đã biết là mã thật, nên nó chỉ đọc
 * đoạn ngắn giữa dấu `{` bao ngoài và chỗ đó.
 */
export function blankCommentsAndStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  const keepNewline = (idx: number) => {
    if (out[idx] !== '\n') out[idx] = ' ';
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') keepNewline(i++);
      continue;
    }
    if (two === '/*') {
      keepNewline(i++);
      keepNewline(i++);
      while (i < src.length && src.slice(i, i + 2) !== '*/') keepNewline(i++);
      keepNewline(i++);
      keepNewline(i++);
      continue;
    }
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      keepNewline(i++);
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') keepNewline(i++);
        if (i < src.length) keepNewline(i++);
      }
      keepNewline(i++);
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Số dòng (1-based) của một vị trí ký tự. */
function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (src[i] === '\n') line += 1;
  }
  return line;
}

/* Đoạn trích để người đọc nhận ra chỗ sai — lấy trên nguồn GỐC (còn chú thích/chuỗi) vì
 * offset hai bản trùng khít. Ép về một dòng: mệnh đề bị bắt thường trải ra nhiều dòng, mà một
 * câu báo lỗi trải ra nhiều dòng thì không ai đọc.
 *
 * Cắt ở dấu `;` đầu tiên nếu có, để đoạn trích dừng lại ở hết CÂU LỆNH chứ không tràn sang
 * câu sau — trích lẫn câu sau thì người đọc đi tìm nhầm chỗ. */
const EXCERPT_CHARS = 72;

function excerpt(raw: string, index: number): string {
  const window = raw.slice(index, index + EXCERPT_CHARS);
  const stop = window.indexOf(';');
  const text = (stop === -1 ? window : window.slice(0, stop + 1)).replace(/\s+/g, ' ').trim();
  return stop === -1 && index + EXCERPT_CHARS < raw.length ? `${text} …` : text;
}

export function scanGrantWindowCopies(...roots: string[]): GrantWindowHit[] {
  return roots
    .flatMap((r) => scanOneRoot(r))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function scanOneRoot(root: string): GrantWindowHit[] {
  const out: GrantWindowHit[] = [];
  for (const file of walk(root)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (rel === DEFINITION_FILE) continue;

    const raw = readFileSync(file, 'utf8');
    const src = blankCommentsAndStrings(raw);
    const passes: readonly (readonly [GrantWindowHit['kind'], RegExp])[] = [
      ['where', WHERE_COMPARISON],
      ['predicate', PREDICATE_COMPARISON],
    ];
    for (const [kind, pattern] of passes) {
      for (const m of src.matchAll(pattern)) {
        out.push({ file: rel, line: lineAt(src, m.index), kind, text: excerpt(raw, m.index) });
      }
    }
  }
  return out;
}

/* ---- Dạng thứ tư: DÙNG ĐÚNG hàm chung nhưng TRẢI RA nhầm chỗ ---- */

/* `grantInForce()` trả một object MANG KHOÁ `OR`. Trải nó (`...grantInForce(now)`) vào một
 * object literal ĐÃ CÓ khoá `OR` của riêng nó thì khoá sau đè khoá trước — JavaScript im
 * lặng, TypeScript im lặng, Prisma im lặng, và một nửa điều kiện biến mất.
 *
 * Ở tầng quyền, "một nửa điều kiện biến mất" đọc ra thành: hoặc mất phép lọc chủ thể (luật
 * của người khác áp lên người này), hoặc mất cửa sổ hiệu lực (luật DENY đã hết hạn vẫn chặn,
 * luật ALLOW đã hết hạn vẫn mở). Không có ngoại lệ nào nổ ra để ai đó đi tìm.
 *
 * Cách viết ĐÚNG khi đã có `OR` riêng: `AND: [grantInForce(now)]`. Lưới này chỉ soi dạng
 * TRẢI, nên cách viết đúng không bao giờ bị báo — đó là điều làm nó dùng được thay vì phiền.
 *
 * GIỚI HẠN, nói thẳng ra để chú thích đừng hứa nhiều hơn thứ làm được: lưới bám vào chính
 * cái hình dạng `...grantInForce(`. Đặt qua một biến trung gian —
 * `const w = grantInForce(now); return { OR: [...], ...w };` — thì LỌT, và không có phép kiểm
 * nào ở đây bắt được. Muốn chặn hẳn phải đọc luồng dữ liệu chứ không đọc chữ, và đó là việc
 * lớn hơn hẳn. Cái này chặn được đúng lối viết mà người ta thật sự hay gõ ra; hết.
 *
 * Bắt được TRƯỚC khi thành lỗi: chính chú thích BẪY trong `common/lifecycle/active.ts` đã
 * cảnh báo, nhưng một dòng chú thích không chặn được ai. Cái này chặn.
 */
const SPREAD_PATTERN = /\.\.\.\s*grantInForce\s*\(/g;

export interface GrantSpreadCollision {
  file: string;
  line: number;
  text: string;
}

export function scanGrantSpreadCollisions(...roots: string[]): GrantSpreadCollision[] {
  return roots
    .flatMap((r) => collisionsInRoot(r))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function collisionsInRoot(root: string): GrantSpreadCollision[] {
  const out: GrantSpreadCollision[] = [];
  for (const file of walk(root)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (rel === DEFINITION_FILE) continue;

    const raw = readFileSync(file, 'utf8');
    const src = blankCommentsAndStrings(raw);
    for (const m of src.matchAll(SPREAD_PATTERN)) {
      const span = enclosingObject(src, m.index);
      if (span !== null && hasOwnOrKey(src.slice(span.open + 1, span.close))) {
        out.push({ file: rel, line: lineAt(src, m.index), text: excerpt(raw, m.index) });
      }
    }
  }
  return out;
}

/* Object literal BAO NGOÀI vị trí `from`: đi NGƯỢC tới dấu `{` chưa đóng, rồi đi XUÔI từ đó
 * tới dấu `}` khớp với nó. Đi ngược từ một vị trí đã biết là mã thật nên chỉ phải đọc đoạn
 * ngắn ở giữa — không phụ thuộc phần còn lại của file có cân ngoặc hay không. */
function enclosingObject(src: string, from: number): { open: number; close: number } | null {
  let depth = 0;
  let open = -1;
  for (let i = from; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }
  if (open === -1) return null;

  let level = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') level += 1;
    else if (ch === '}') {
      level -= 1;
      if (level === 0) return { open, close: i };
    }
  }
  return null;
}

/** Có khoá `OR:` ở NGAY object này không (bỏ qua mọi tầng lồng bên trong). */
function hasOwnOrKey(body: string): boolean {
  let level = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') level += 1;
    else if (ch === '}' || ch === ']' || ch === ')') level -= 1;
    else if (level === 0 && /^OR\s*:/.test(body.slice(i, i + 6))) {
      const prev = body.slice(0, i).trimEnd().slice(-1);
      if (prev === '' || prev === '{' || prev === ',') return true;
    }
  }
  return false;
}
