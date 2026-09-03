import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/* Quét: route CÓ GATE quyền nào KHÔNG truyền người gọi xuống service.
 *
 * VÌ SAO CẦN CÁI LƯỚI THỨ HAI. `scope-check-invariants` soi method NHẬN `Caller` mà không
 * hỏi phạm vi. Nó có một điểm mù, và điểm mù đó đã sinh ra IDOR thật:
 *
 *   `ContractsService.get(id)` không nhận `Caller` NÀO CẢ. Không nhận thì không bị soi, nên
 *   cái lưới kia im lặng trong khi ai cầm `contract.record.view` đọc được hợp đồng của mọi
 *   công ty chỉ cần biết id. Cùng dạng: `revealNationalId` giải mã CCCD của mọi nhân thân.
 *
 * Nên phải soi từ đầu kia: TỪ ROUTE. `@RequirePermission` trả lời "có được gọi endpoint này
 * hay không". Nó KHÔNG trả lời "lên bản ghi nào". Route nào gate quyền mà không hề đưa danh
 * tính người gọi xuống service thì service KHÔNG THỂ kiểm phạm vi — không phải "quên kiểm",
 * mà là không có dữ liệu để kiểm.
 *
 * Đây là cái LƯỚI, không phải trình biên dịch: nó chỉ hỏi "có TRUYỀN người gọi xuống không",
 * không hỏi "truyền xuống rồi có DÙNG đúng không" — phần sau là việc của cái lưới kia. Hai
 * cái bù nhau, và cần cả hai.
 */

/* Truyền người gọi xuống, dưới bất kỳ dạng nào đang có trong repo. `this.actor(req)` KHÔNG
 * tính: nó chỉ mang userId, và phạm vi tính theo TỪNG MÃ QUYỀN nên thiếu mã là hỏi phạm vi
 * trên một câu hỏi khác câu đang chạy — đúng tầng lỗi đã vá bằng cách xoá bản cũ. */
const PASSES_CALLER = ['this.caller(', 'callerOf('];

const HTTP_VERB = /^ {2}@(Get|Post|Put|Patch|Delete)[(]/;
const REQUIRE_PERMISSION = /@RequirePermission[(][ ]*'([^']*)'/;
const PUBLIC = /@Public[(]/;
const HANDLER = /^ {2}(?:public |private |protected )?(?:async )?([A-Za-z_$][A-Za-z0-9_$]*)[ ]*[(]/;

export interface ScannedHandler {
  /** `customers/customers.controller.ts:profile` — id ổn định, dùng cho sổ nợ. */
  id: string;
  permission: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (name.endsWith('.controller.ts')) {
      out.push(p);
    }
  }
  return out;
}

function countOf(line: string, re: RegExp): number {
  return (line.match(re) ?? []).length;
}

export interface RouteScan {
  /** Mọi route có gate quyền (không tính `@Public`). */
  gated: number;
  /** Trong số đó, những route không truyền người gọi xuống service. */
  withoutCaller: ScannedHandler[];
}

export function scanRouteCallers(srcDir: string): RouteScan {
  let gated = 0;
  const withoutCaller: ScannedHandler[] = [];

  for (const file of walk(srcDir)) {
    const rel = file
      .replace(srcDir + sep, '')
      .split(sep)
      .join('/');
    const lines = readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      if (!HTTP_VERB.test(lines[i]!)) continue;

      // Gom các decorator từ dòng @Get/@Post tới dòng chữ ký handler.
      let j = i;
      let permission: string | null = null;
      let isPublic = false;
      while (j < lines.length && !HANDLER.test(lines[j]!)) {
        const m = REQUIRE_PERMISSION.exec(lines[j]!);
        if (m !== null) permission = m[1]!;
        if (PUBLIC.test(lines[j]!)) isPublic = true;
        j += 1;
      }
      if (j >= lines.length) break;

      // Thân handler: đếm ngoặc nhọn từ dòng chữ ký.
      let body = '';
      let depth = 0;
      let started = false;
      for (let k = j; k < lines.length; k += 1) {
        body += lines[k]!;
        const open = countOf(lines[k]!, /[{]/g);
        depth += open - countOf(lines[k]!, /[}]/g);
        if (open > 0) started = true;
        if (started && depth <= 0) break;
      }

      i = j;
      /* `@Public` là quyết định tường minh rằng không cần token; route không gate thì đã có
       * ratchet `authz-invariants` lo — không soi lại ở đây. */
      if (isPublic || permission === null) continue;

      gated += 1;
      if (!PASSES_CALLER.some((needle) => body.includes(needle))) {
        const name = HANDLER.exec(lines[j]!)![1]!;
        withoutCaller.push({ id: `${rel}:${name}`, permission });
      }
    }
  }
  return { gated, withoutCaller };
}
