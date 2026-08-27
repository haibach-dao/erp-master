import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERSON_BLOCKING_REFERENCES,
  PERSON_CASCADE_REFERENCES,
  declaredPersonReferences,
} from '../src/common/lifecycle/person-references';

const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

/* RATCHET SONG SINH với `customer-reference-invariants`, cho hồ sơ NHÂN THÂN.
 *
 * Vì sao cần cái thứ hai thay vì mở rộng cái thứ nhất: hai sổ trả lời hai câu hỏi khác
 * nhau. "Còn gì trỏ tới KHÁCH HÀNG này" và "còn gì trỏ tới NHÂN THÂN này" là hai tập hợp
 * khác nhau, và xoá một khách hàng cá nhân phải hỏi cả hai. Gộp làm một bảng thì cột
 * `personId` và cột `customerId` phải chia nhau một khoá — và chỗ đó là chỗ sẽ lẫn.
 *
 * Lỗi đã trả giá (27/08/2026): rào chắn "đã được an táng" hỏi TAY vì `BurialRecord` khoá
 * theo hồ sơ người mất chứ không theo khách hàng, nên nó không nằm trong sổ nào. Hậu quả
 * không phải là bỏ sót — nó vẫn chặn đúng — mà là lời từ chối CHẤT LƯỢNG THẤP: mục duy
 * nhất không đi qua `identify`, nên nó nói "đã được an táng (1 hồ sơ)" mà không nói mộ
 * nào. Người dùng đọc xong không biết phải dọn ở đâu, và kết luận là hệ báo sai.
 */

/* Cột trỏ tới nhân thân KHÔNG chỉ tên `personId` — còn `sourcePersonId`, `targetPersonId`
 * (quan hệ), và `deceasedPersonId` (hồ sơ an táng). Bắt theo hậu tố, không theo tên đầy đủ. */
const PERSON_FK = /^\s{2}(\w*[Pp]ersonId)\s+String/;

/* Model được MIỄN khai, kèm lý do. Miễn trừ phải có lý do viết ra — "không liên quan" thì
 * không phải lý do, và một danh sách miễn trừ không ai giải thích được chính là chỗ lần
 * sau người ta nhét thêm một bảng vào cho đỡ đỏ test. */
const EXEMPT: Readonly<Record<string, string>> = {
  Customer:
    'Customer.personId là CHÍNH mối nối khách hàng ↔ nhân thân, không phải một dòng dữ liệu ' +
    'trỏ tới nhân thân. Xoá khách hàng thì chính dòng Customer đó bị xoá bằng `customer.delete` ' +
    'theo id khách hàng, rồi tới lượt Person — nên khai nó vào sổ là bảo hệ tự xoá lấy mình.',
};

/** Đọc schema thành từng model kèm danh sách cột trỏ tới nhân thân. */
function modelsWithPersonColumns(): { model: string; column: string }[] {
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
    const m = PERSON_FK.exec(line);
    if (m?.[1] === undefined) continue;
    if (EXEMPT[current] !== undefined) continue;
    out.push({ model: current, column: m[1] });
  }
  return out;
}

describe('sổ đăng ký tham chiếu nhân thân — không được bỏ sót', () => {
  const inSchema = modelsWithPersonColumns();

  it('đọc được schema và tìm ra cột (tự kiểm cái quét)', () => {
    /* Cái quét trả rỗng thì mọi test dưới luôn xanh mà chẳng kiểm gì. Neo bằng hai mô hình
     * chắc chắn phải có, và một trong hai CỐ Ý là cái bẫy: `deceasedPersonId` mang chữ
     * `PersonId` nhưng trỏ vào `deceased_persons`, không trỏ vào `persons`. */
    expect(inSchema.length).toBeGreaterThan(5);
    expect(inSchema).toContainEqual({ model: 'PersonPhone', column: 'personId' });
    expect(inSchema).toContainEqual({ model: 'BurialRecord', column: 'deceasedPersonId' });
  });

  it('mọi cột trỏ tới nhân thân đều đã được khai trong sổ', () => {
    const declared = declaredPersonReferences();
    const missing = inSchema.filter(
      (s) => !declared.some((d) => d.model === s.model && d.column === s.column),
    );
    expect(
      missing.map((m) => `${m.model}.${m.column}`),
      'Khai vào PERSON_BLOCKING_REFERENCES (chặn xoá) hoặc PERSON_CASCADE_REFERENCES (xoá theo) ở src/common/lifecycle/person-references.ts',
    ).toEqual([]);
  });

  it('sổ không khai model/cột KHÔNG tồn tại trong schema', () => {
    const stale = declaredPersonReferences().filter(
      (d) => !inSchema.some((s) => s.model === d.model && s.column === d.column),
    );
    expect(stale.map((s) => `${s.model}.${s.column}`)).toEqual([]);
  });

  it('mọi miễn trừ đều có lý do — "không liên quan" thì không phải lý do', () => {
    for (const [model, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `miễn trừ cho ${model}`).toBeGreaterThan(40);
    }
  });
});

describe('sổ đăng ký nhân thân — hình dạng', () => {
  it('mỗi mục chặn đều có câu tiếng Việt mang con số', () => {
    for (const ref of PERSON_BLOCKING_REFERENCES) {
      const msg = ref.message(2);
      expect(msg.length, `${ref.model}`).toBeGreaterThan(8);
      expect(msg, `${ref.model}`).toContain('2');
    }
  });

  it('mọi mục chặn đều CHỈ ĐÍCH DANH được, không chỉ đếm', () => {
    /* Đây là bất biến sinh ra từ đúng lỗi ngày 27/08/2026. Sổ theo khách hàng để `identify`
     * là TUỲ CHỌN vì có bảng không có gì đáng gọi tên (thẻ đã in, giao dịch thu tiền). Sổ
     * này thì KHÔNG: mọi thứ chặn ở đây đều gắn với một chỗ vật lý trong nghĩa trang, và
     * "còn 1 hồ sơ" mà không nói mộ nào là bắt người dùng đi dò cả nghĩa trang. */
    const mute = PERSON_BLOCKING_REFERENCES.filter((r) => r.identify === undefined);
    expect(
      mute.map((r) => `${r.model}.${r.column}`),
      'Mục chặn theo nhân thân phải có identify() — xem lý do trong test',
    ).toEqual([]);
  });

  it('`where` trả về object cho mọi mục, ở cả hai nhóm', () => {
    const now = new Date();
    for (const ref of PERSON_BLOCKING_REFERENCES) {
      expect(typeof ref.where('p1', now), `${ref.model}`).toBe('object');
    }
    for (const ref of PERSON_CASCADE_REFERENCES) {
      expect(typeof ref.where('p1'), `${ref.model}`).toBe('object');
    }
  });

  it('hồ sơ an táng phải được XOÁ THEO trước hồ sơ người mất', () => {
    /* Không phải chuyện thẩm mỹ: `burial_records.deceased_person_id` có khoá ngoại
     * `ON DELETE RESTRICT` tới `deceased_persons`. Sai thứ tự thì xoá khách hàng ném
     * `P2003` — một lỗi ràng buộc thô, không phải câu tiếng Việt nào. Thứ tự là HỢP ĐỒNG
     * của mảng này, nên nó phải có test, không phải chỉ có chú thích. */
    const order = PERSON_CASCADE_REFERENCES.map((r) => r.model);
    const burial = order.indexOf('BurialRecord');
    const deceased = order.indexOf('DeceasedPerson');
    expect(burial, 'BurialRecord phải nằm trong nhóm xoá theo').toBeGreaterThanOrEqual(0);
    expect(deceased, 'DeceasedPerson phải nằm trong nhóm xoá theo').toBeGreaterThanOrEqual(0);
    expect(burial).toBeLessThan(deceased);
  });

  it('không mục nào bị khai hai lần TRONG CÙNG một nhóm', () => {
    /* Trùng GIỮA hai nhóm là CÓ CHỦ ĐÍCH và phải giữ được: `BurialRecord.deceasedPersonId`
     * vừa CHẶN (hồ sơ còn hiệu lực) vừa XOÁ THEO (hồ sơ đã huỷ) — hai mệnh đề `where` loại
     * trừ nhau trên cùng một bảng. Sổ theo khách hàng cũng vậy với quyền sử dụng và phiếu
     * giữ chỗ. Nên chỉ soi trùng trong từng nhóm. */
    for (const [name, group] of [
      ['chặn', PERSON_BLOCKING_REFERENCES],
      ['xoá theo', PERSON_CASCADE_REFERENCES],
    ] as const) {
      const keys = group.map((r) => `${r.model}.${r.column}`);
      expect(new Set(keys).size, `${name}: ${keys.join(', ')}`).toBe(keys.length);
    }
  });
});
