import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/* Quét mã nguồn tìm TRẠNG THÁI GÕ THẲNG trong mệnh đề đọc.
 *
 * Lỗi cần chặn (đã xảy ra 26/08/2026): mỗi nơi tự quyết định thế nào là "còn hiệu lực",
 * nên hai nơi lệch nhau. Màn hình lọc `status: 'Active'`, rào chắn xoá không lọc gì, và
 * người dùng nhận hai câu trả lời trái nhau cho cùng một câu hỏi.
 *
 * Chỉ soi vế ĐỌC. Vế GHI (`data: { status: 'Completed' }`) là chỗ hợp lệ để nêu đích danh
 * một trạng thái — đó chính là việc nó đang làm: đặt trạng thái.
 *
 * Phân biệt đọc/ghi bằng cách nhìn ngược lên: từ khoá `where` hay `data`/`create`/`update`
 * nào gần nhất phía trên. Không hoàn hảo, nhưng đây là cái LƯỚI, không phải trình biên
 * dịch — thà cảnh báo thừa rồi ghi lý do, hơn là bỏ sót.
 */

const STATUS_LITERAL = /status:\s*'([A-Za-z_]+)'/;
/* Dạng thứ hai: `status: { in: ['Draft', 'Verified'] }`.
 *
 * Thêm 27/08/2026. Cái lưới cũ chỉ bắt `status: 'X'`, nên một bản sao ĐẦY ĐỦ của
 * `ACTIVE_BURIAL_STATUSES` nằm trong `scripts/check-burial-candidates.ts` sống sót suốt —
 * đúng dạng nguy hiểm nhất, vì nó là cả một DANH SÁCH chứ không phải một giá trị lẻ. Cái
 * lưới bắt được giá trị lẻ mà để lọt cả danh sách là cái lưới bắt nhầm con. */
const STATUS_IN_LIST = /status:\s*\{\s*in:\s*\[\s*'([A-Za-z_]+)'/;
const READ_HINT = /\bwhere\b|\bcount\(|\bfindMany\(|\bfindFirst\(|\bfindUnique\(/;
/* `update:` và `create:` (có DẤU HAI CHẤM) là KHOÁ trong thân `upsert`, và thân đó là vế
 * GHI. Thêm 27/08/2026: thiếu hai dạng này thì `upsert({ where, update, create })` bị nhìn
 * ngược lên thấy `where` trước và cả hai payload ghi bị báo nhầm thành đọc — đúng hai dòng
 * `seed-dev-user.ts` đã báo nhầm ngay lần đầu nới lưới. Báo nhầm cũng làm hỏng cái lưới:
 * người ta sẽ ghi bừa lý do miễn trừ cho đỡ đỏ, và lần sau miễn trừ thật lọt theo. */
const WRITE_HINT = /\bdata:|\bcreate\(|\bupdate\(|\bupsert\(|\bupdate:|\bcreate:/;

export interface StatusRead {
  file: string;
  line: number;
  value: string;
  text: string;
}

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

/** Nhìn ngược tối đa 8 dòng: gặp `where` trước `data` thì đây là vế đọc. */
function isReadContext(lines: string[], index: number): boolean {
  for (let i = index; i >= Math.max(0, index - 8); i -= 1) {
    const line = lines[i] ?? '';
    if (WRITE_HINT.test(line)) return false;
    if (READ_HINT.test(line)) return true;
  }
  return false;
}

/* Quét NHIỀU gốc, không chỉ `src/`.
 *
 * `scripts/` cũng chạy lệnh thật trên CSDL thật, nên một bộ lọc sai ở đó nói dối y hệt một
 * bộ lọc sai trong `src/` — và còn nguy hơn, vì script hay là thứ người ta dùng để ĐI TÌM
 * LỖI. Trước 27/08/2026 cái lưới chỉ nhìn `src/`; đó là lý do bản sao thứ tư nằm yên ở
 * `scripts/check-burial-candidates.ts` mà không ai biết. */
export function scanStatusReads(...roots: string[]): StatusRead[] {
  return roots.flatMap((r) => scanOneRoot(r));
}

function scanOneRoot(srcRoot: string): StatusRead[] {
  const out: StatusRead[] = [];
  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file).replace(/\\/g, '/');
    /* Chính file định nghĩa được phép nêu đích danh trạng thái — đó là việc của nó. */
    if (rel === 'common/lifecycle/active.ts') continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      // Bỏ dòng chú thích: ví dụ trong chú thích không phải mã chạy.
      const trimmed = text.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

      const m = STATUS_IN_LIST.exec(text) ?? STATUS_LITERAL.exec(text);
      if (m?.[1] === undefined) return;
      if (!isReadContext(lines, i)) return;
      out.push({ file: rel, line: i + 1, value: m[1], text: trimmed });
    });
  }
  return out;
}

/* Danh sách TẬP CON trạng thái bị CHÉP RA NHIỀU BẢN — dạng khác của cùng một bệnh.
 *
 * Hai bản sao sẽ lệch nhau vào ngày ai đó thêm một trạng thái vào một bản. Trước khi gom
 * về `common/lifecycle`, `ACTIVE_BURIAL_STATUSES` từng có BỐN bản trong bốn service.
 *
 * Chỉ soi danh sách mang PHÁN XÉT "cái nào còn tính" — tên bắt đầu bằng ACTIVE_/LIVE_/
 * BINDING_/VALID_/EFFECTIVE_. KHÔNG soi TỪ VỰNG đầy đủ như `GRAVE_PLOT_STATUSES`: liệt kê
 * mọi giá trị hợp lệ của một cột là việc khác, nó thuộc về module sở hữu cột đó và không
 * phải thứ hai nơi có thể trả lời khác nhau.
 */
const SUBSET_JUDGEMENT = /const\s+(ACTIVE|LIVE|BINDING|VALID|EFFECTIVE)_[A-Z_]*\s*=\s*\[/;

export function findDuplicateStatusLists(srcRoot: string): string[] {
  return walk(srcRoot)
    .map((f) => ({ full: f, rel: relative(srcRoot, f).replace(/\\/g, '/') }))
    .filter((f) => !f.rel.startsWith('common/lifecycle/'))
    .filter((f) => SUBSET_JUDGEMENT.test(readFileSync(f.full, 'utf8')))
    .map((f) => f.rel);
}
