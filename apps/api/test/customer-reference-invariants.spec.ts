import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CUSTOMER_BLOCKING_REFERENCES,
  declaredCustomerReferences,
} from '../src/common/lifecycle/customer-references';

const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

/* CÁI RATCHET BẮT "BỎ SÓT".
 *
 * Hai ratchet trước bắt được chuyện CHÉP ĐỊNH NGHĨA ra nhiều bản. Chúng KHÔNG bắt được
 * chuyện bỏ sót — một truy vấn thiếu bộ lọc trông y hệt một truy vấn cố ý không lọc, và
 * một bảng mới trỏ tới khách hàng mà rào chắn chưa biết thì chẳng có gì báo.
 *
 * Đó là lỗ hổng đã cắn ba lần trong ngày 26/08/2026: rào chắn xoá khách hàng lần lượt bỏ
 * sót quyền sử dụng đã thu hồi, phiếu giữ chỗ đã hết hạn, rồi hợp đồng đã huỷ. Mỗi lần vá
 * một chỗ mà không hỏi "còn chỗ nào nữa không".
 *
 * Test này đọc `schema.prisma`, tìm MỌI cột trỏ tới khách hàng, và đòi mỗi cột phải được
 * khai trong sổ đăng ký. Thêm một bảng mà quên khai thì đỏ ngay, kèm tên bảng.
 */

/* Cột trỏ tới khách hàng KHÔNG chỉ tên `customerId` — có `holderCustomerId` (quyền sử
 * dụng) và `ownerCustomerId` (hồ sơ an táng). Bắt theo hậu tố, không theo tên đầy đủ. */
const CUSTOMER_FK = /^\s{2}(\w*[Cc]ustomerId)\s+String/;

/** Đọc schema thành từng model kèm danh sách cột. */
function modelsWithCustomerColumns(): { model: string; column: string }[] {
  const out: { model: string; column: string }[] = [];
  let current: string | null = null;
  for (const line of SCHEMA.split('\n')) {
    const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelStart?.[1] !== undefined) {
      current = modelStart[1];
      continue;
    }
    if (line.startsWith('}')) {
      current = null;
      continue;
    }
    if (current === null) continue;
    const m = CUSTOMER_FK.exec(line);
    if (m?.[1] === undefined) continue;
    /* Bỏ chính model Customer: `Customer.id` không phải tham chiếu tới chính nó, và
     * `Person.customer` là quan hệ ngược chứ không phải cột. */
    if (current === 'Customer') continue;
    out.push({ model: current, column: m[1] });
  }
  return out;
}

describe('sổ đăng ký tham chiếu khách hàng — không được bỏ sót', () => {
  const inSchema = modelsWithCustomerColumns();

  it('đọc được schema và tìm ra cột (tự kiểm cái quét)', () => {
    /* Cái quét trả rỗng thì test dưới luôn xanh mà chẳng kiểm gì. Neo lại bằng một mô
     * hình chắc chắn phải có: quyền sử dụng phần mộ trỏ tới chủ mộ. */
    expect(inSchema.length).toBeGreaterThan(3);
    expect(inSchema).toContainEqual({
      model: 'GraveUsageRight',
      column: 'holderCustomerId',
    });
  });

  it('mọi cột trỏ tới khách hàng đều đã được khai trong sổ', () => {
    const declared = declaredCustomerReferences();
    const missing = inSchema.filter(
      (s) => !declared.some((d) => d.model === s.model && d.column === s.column),
    );
    expect(
      missing.map((m) => `${m.model}.${m.column}`),
      'Khai vào CUSTOMER_BLOCKING_REFERENCES (chặn xoá) hoặc CUSTOMER_CASCADE_REFERENCES (xoá theo) ở src/common/lifecycle/customer-references.ts',
    ).toEqual([]);
  });

  it('sổ không khai model/cột KHÔNG tồn tại trong schema', () => {
    /* Chiều ngược lại cũng phải đúng: một dòng trong sổ trỏ tới cột đã bị đổi tên là một
     * lời gọi `count` sẽ nổ lúc chạy, chứ không phải một rào chắn im lặng. */
    const stale = declaredCustomerReferences().filter(
      (d) => !inSchema.some((s) => s.model === d.model && s.column === d.column),
    );
    expect(stale.map((s) => `${s.model}.${s.column}`)).toEqual([]);
  });
});

describe('sổ đăng ký — hình dạng', () => {
  it('mỗi mục chặn đều có câu tiếng Việt nói rõ cái gì đang chặn', () => {
    for (const ref of CUSTOMER_BLOCKING_REFERENCES) {
      const msg = ref.message(2);
      expect(msg.length, `${ref.model}`).toBeGreaterThan(8);
      // Câu phải mang CON SỐ, nếu không người dùng không biết phải dọn bao nhiêu.
      expect(msg, `${ref.model}`).toContain('2');
    }
  });

  it('không model nào bị khai hai lần ở nhóm chặn', () => {
    const keys = CUSTOMER_BLOCKING_REFERENCES.map((r) => `${r.model}.${r.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('`activeWhere` trả về object, kể cả khi cố ý không lọc gì', () => {
    const now = new Date();
    for (const ref of CUSTOMER_BLOCKING_REFERENCES) {
      expect(typeof ref.activeWhere(now), `${ref.model}`).toBe('object');
    }
  });
});
