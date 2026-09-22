import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/* Quét: method nào NHẬN `Caller` mà KHÔNG hỏi phạm vi.
 *
 * LỖI ĐÃ TRẢ GIÁ (27/08/2026). Phạm vi trong hệ này có hai tầng lỗi, và tầng thứ hai chỉ
 * lộ ra khi vá tầng thứ nhất:
 *
 *   Tầng 1 — hỏi phạm vi ở mức RỘNG NHẤT của người gọi thay vì theo TỪNG MÃ QUYỀN. Người
 *   vừa giữ vai kiểm toán GROUP (chỉ đọc) vừa phụ trách nghĩa trang A huỷ được hồ sơ ở
 *   nghĩa trang B. Đã vá: bốn hàm bản cũ bị XOÁ khỏi `ScopeService`, nên tầng này không
 *   tái diễn được — trình biên dịch chặn.
 *
 *   Tầng 2 — KHÔNG hỏi phạm vi một dòng nào. `@RequirePermission` gate được "có được làm
 *   việc này hay không", nhưng không gate "làm lên BẢN GHI NÀO". Đo được 7 method như vậy
 *   ở 4 service. Trình biên dịch không bắt được: nhận `caller` rồi chỉ dùng
 *   `caller.userId` để ghi vết kiểm toán là mã hợp lệ hoàn hảo, và im lặng.
 *
 * Test này là cái lưới cho tầng 2: thêm một method nhận `Caller` mà quên hỏi phạm vi là
 * gãy build, chứ không lặng lẽ thành lỗ thứ 8.
 *
 * HAI LƯỢT, vì có method UỶ NHIỆM. `BurialsService.verify` không tự gọi `assertPlotFor`;
 * nó gọi `assertRecordInScope`, và hàm đó mới hỏi. Quét một lượt sẽ báo nhầm mọi chỗ uỷ
 * nhiệm — và báo nhầm làm hỏng cái lưới: người ta ghi bừa lý do miễn trừ cho đỡ đỏ, rồi
 * lần sau miễn trừ thật lọt theo (đúng bài học của ratchet lọc trạng thái).
 */

/* Hỏi phạm vi = gọi một trong SÁU hàm này. Chỉ còn bản THEO MÃ QUYỀN tồn tại.
 *
 * `assertSiteFor` ĐÃ BỊ XOÁ (17/09/2026), thay bằng `assertPlotFor` — hàm hỏi CẢ HAI TRỤC
 * trong MỘT lời gọi. Hai lý do, cả hai là lỗi đã xảy ra thật: gọi lẻ vế nghĩa trang thì
 * mức COMPANY thoát ngay (đã cắn hai lần), và `level` là hợp trên MỌI công ty nên mức ở
 * công ty này xoá phép bó nghĩa trang ở công ty kia — thủng NGAY CẢ KHI gọi đủ cặp. Danh
 * sách này phải theo: để tên cũ lại thì cái lưới đang đo một hàm không còn tồn tại.
 *
 * `levelFor` thêm 27/08/2026: nó trả về MỨC phạm vi cấp cho một mã, và có chỗ cần đúng nó
 * chứ không phải `assertCompanyFor` — `authz-matrix` sửa nội dung VAI, mà vai là dữ liệu
 * toàn cục không thuộc công ty nào, nên câu phải hỏi là "người này có ở mức GROUP không".
 * Thiếu `levelFor` trong danh sách thì cái lưới báo nhầm ba method đã bó phạm vi ĐÚNG cách
 * — và báo nhầm làm hỏng lưới, vì người ta sẽ ghi bừa lý do miễn trừ cho đỡ đỏ. */
const SCOPE_CALL =
  /\b(assertCompanyFor|assertPlotFor|plotScopeFilterFor|visibleCompanyIdsFor|levelFor)\s*\(/;

/** Bản CŨ, tính phạm vi ở mức rộng nhất của người gọi. Đã xoá — canh để không ai dựng lại. */
const CALLER_WIDE_SCOPE_DECL =
  /^\s*async (assertCompany|assertSite|assertSiteFor|visibleCompanyIds|listSiteFilter|listSiteFilterFor)\s*\(/;

const TAKES_CALLER = /\bcaller\s*:\s*Caller\b/;

/* BA hình dạng method, không phải một.
 *
 * Bản đầu chỉ nhận `  ten(` — nên MÙ với hai cách viết hợp lệ: method có tham số kiểu
 * (`  async doGi<T>(caller: Caller)`) và method viết dạng thuộc tính arrow
 * (`  doGi = async (caller: Caller) => {`). Một lượt soi độc lập đo được: một đường mới viết
 * theo hai kiểu đó thì không hỏi phạm vi mà lưới vẫn im. Lỗ theo CÚ PHÁP là lỗ tệ nhất — nó
 * không báo gì cả, và cách thoát lại là một cách viết mã hoàn toàn bình thường.
 */
const METHOD_HEAD =
  /^ {2}(?:private |public |protected )?(?:static )?(?:async )?([A-Za-z_][\w]*)\s*(?:<[^>()]*>)?\s*\(/;
const ARROW_HEAD =
  /^ {2}(?:private |public |protected )?(?:readonly )?([A-Za-z_][\w]*)\s*(?:<[^>()]*>)?\s*=\s*(?:async\s*)?\(/;

/* BỎ CHÚ THÍCH TRƯỚC KHI DÒ.
 *
 * `SCOPE_CALL` khớp cả trong chú thích, nên một method chỉ cần NHẮC TÊN `assertPlotFor(` trong
 * một đoạn giải thích là được tính là đã bó phạm vi. Kho này viết chú thích rất dày và hay dẫn
 * tên hàm, nên đó không phải giả thuyết — nó là cách thoát dễ gặp nhất.
 *
 * Giữ nguyên văn bản GỐC để cắt method và đếm dòng; chỉ bản đã bỏ chú thích mới đem đi dò, nên
 * số dòng báo ra vẫn trỏ đúng chỗ. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

export interface UnguardedMethod {
  file: string;
  line: number;
  method: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (name.endsWith('.service.ts') && !name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

interface Method {
  name: string;
  line: number;
  body: string;
  takesCaller: boolean;
}

/* Cắt file thành từng method bằng cách đếm ngoặc từ dòng chữ ký.
 *
 * Đây là cái LƯỚI, không phải trình phân tích cú pháp: chỉ nhận method thụt đúng 2 dấu
 * cách — tức là thành viên trực tiếp của class, đúng thứ cần soi.
 */
function methodsOf(text: string): Method[] {
  const lines = text.split('\n');
  const found: Method[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = METHOD_HEAD.exec(lines[i]!) ?? ARROW_HEAD.exec(lines[i]!);
    if (head === null) continue;
    // Chữ ký có thể trải nhiều dòng: gom tới khi ngoặc tròn đóng hết.
    let sig = '';
    let j = i;
    let round = 0;
    do {
      sig += lines[j]! + '\n';
      round += (lines[j]!.match(/\(/g) ?? []).length - (lines[j]!.match(/\)/g) ?? []).length;
      j += 1;
    } while (round > 0 && j < lines.length);
    // Thân: đếm ngoặc nhọn từ dòng cuối của chữ ký.
    let body = '';
    let curly = 0;
    let started = false;
    for (let k = j - 1; k < lines.length; k += 1) {
      body += lines[k]! + '\n';
      curly += (lines[k]!.match(/\{/g) ?? []).length - (lines[k]!.match(/\}/g) ?? []).length;
      if ((lines[k]!.match(/\{/g) ?? []).length > 0) started = true;
      if (started && curly <= 0) break;
    }
    found.push({
      name: head[1]!,
      line: i + 1,
      body,
      takesCaller: TAKES_CALLER.test(stripComments(sig)),
    });
    i = j - 1;
  }
  return found;
}

/* Lượt 1: helper nào TỰ hỏi phạm vi. Lượt 2..n: helper nào hỏi qua helper khác.
 * Lặp tới khi không thêm được ai — chuỗi uỷ nhiệm có thể dài hơn một bước.
 */
function guardedNames(methods: Method[]): Set<string> {
  const guarded = new Set<string>();
  const code = new Map(methods.map((m) => [m.name, stripComments(m.body)]));
  for (const m of methods) {
    if (SCOPE_CALL.test(code.get(m.name)!)) guarded.add(m.name);
  }
  for (let round = 0; round < 5; round += 1) {
    let grew = false;
    for (const m of methods) {
      if (guarded.has(m.name)) continue;
      const body = code.get(m.name)!;
      for (const g of guarded) {
        if (body.includes(`this.${g}(`) || body.includes(`this.${g} (`)) {
          guarded.add(m.name);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }
  return guarded;
}

/* Lõi của bộ quét, tách ra để TỰ KIỂM ĐƯỢC bằng văn bản dựng sẵn.
 *
 * Trước lát này cái tự-kiểm neo vào SỔ NỢ (`MEASURED_UNGUARDED` phải khác rỗng). Nghĩa là
 * ngày trả hết nợ thì tự-kiểm ĐỎ, và sức ép đổ vào chính cái đang canh — ai đó sẽ xoá nó.
 * Neo vào văn bản dựng sẵn thì không bao giờ mục: nó đo bộ quét, không đo trạng thái kho. */
export function unguardedInText(text: string): { method: string; line: number }[] {
  const methods = methodsOf(text);
  const guarded = guardedNames(methods);
  return methods
    .filter((m) => m.takesCaller && !guarded.has(m.name))
    .map((m) => ({ method: m.name, line: m.line }));
}

/** Method nhận `Caller` mà không hỏi phạm vi, dù trực tiếp hay qua uỷ nhiệm. */
export function scanUnguardedCallerMethods(srcDir: string): UnguardedMethod[] {
  const hits: UnguardedMethod[] = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    if (!TAKES_CALLER.test(text)) continue;
    for (const m of unguardedInText(text)) {
      hits.push({
        file: relative(srcDir, file).split(sep).join('/'),
        line: m.line,
        method: m.method,
      });
    }
  }
  return hits;
}

/** Khai báo bản CŨ (phạm vi mức toàn-người-gọi) còn sót lại trong `ScopeService`. */
export function scanCallerWideScopeApi(scopeServiceFile: string): string[] {
  return readFileSync(scopeServiceFile, 'utf8')
    .split('\n')
    .filter((l) => CALLER_WIDE_SCOPE_DECL.test(l))
    .map((l) => l.trim());
}
