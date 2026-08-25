import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REVIEWED_NON_SENSITIVE,
  SENSITIVE_FIELDS,
  SUSPICIOUS_FIELD_PATTERN,
} from '../src/common/masking/sensitive-fields';
import { NEVER_SERIALIZE } from '../src/common/masking/mask.decorator';

const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

/* Tên trường Prisma, lấy từ schema. Chỉ cần tên — sổ trường nhạy cảm khớp theo tên vì
 * response đã rời khỏi ngữ cảnh bảng từ lâu khi nó đi qua interceptor.
 */
function schemaFieldNames(): string[] {
  const names = new Set<string>();
  for (const line of SCHEMA.split('\n')) {
    const m = /^\s{2}([a-z][A-Za-z0-9]*)\s+\S/.exec(line);
    if (m?.[1] !== undefined) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

const decided = new Set<string>([
  ...SENSITIVE_FIELDS.map((r) => r.field),
  ...Object.keys(REVIEWED_NON_SENSITIVE),
  ...NEVER_SERIALIZE,
]);

/* CÁI RATCHET.
 *
 * Khiếm khuyết cũ: mask chỉ áp cho trường được khai tường minh, nên mỗi cột nhạy cảm THÊM
 * VÀO SAU mặc định lọt ra API. Người thêm cột `phone` vào một model mới không có lý do gì
 * để biết mình vừa phải đi sửa một interceptor ở chỗ khác.
 *
 * Test này quét schema: cột nào có tên nghi vấn mà chưa có QUYẾT ĐỊNH nào — không nằm
 * trong sổ nhạy cảm, không nằm trong danh sách đã-rà, không nằm trong never-serialize —
 * thì gãy build. Thêm một cột nhạy cảm mà không quyết định gì về nó là không thể nữa.
 */
describe('mọi cột nghi vấn trong schema đều đã có quyết định', () => {
  const suspicious = schemaFieldNames().filter((f) => SUSPICIOUS_FIELD_PATTERN.test(f));

  it('tìm được cột nghi vấn (tự kiểm cái quét — nếu rỗng thì test này vô nghĩa)', () => {
    expect(suspicious.length).toBeGreaterThan(0);
  });

  it('không cột nghi vấn nào chưa được rà', () => {
    const undecided = suspicious.filter((f) => !decided.has(f));
    expect(
      undecided,
      'Thêm vào SENSITIVE_FIELDS (che), REVIEWED_NON_SENSITIVE (kèm lý do), hoặc NEVER_SERIALIZE',
    ).toEqual([]);
  });
});

describe('sổ trường nhạy cảm — hình dạng', () => {
  it('mỗi trường chỉ khai một lần', () => {
    const fields = SENSITIVE_FIELDS.map((r) => r.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('mọi mã mở khoá đúng 3 đoạn — sai số đoạn là khớp rỗng, tức che vĩnh viễn', () => {
    for (const r of SENSITIVE_FIELDS) {
      expect(r.permission.split('.'), `trường ${r.field}`).toHaveLength(3);
    }
  });

  it('không trường nào vừa nằm trong sổ nhạy cảm vừa nằm trong danh sách đã-rà', () => {
    const both = SENSITIVE_FIELDS.map((r) => r.field).filter((f) => f in REVIEWED_NON_SENSITIVE);
    expect(both, 'một trường không thể vừa cần che vừa không cần che').toEqual([]);
  });

  it('không trường nào vừa cần che vừa bị cấm serialize hoàn toàn', () => {
    const both = SENSITIVE_FIELDS.map((r) => r.field).filter((f) =>
      (NEVER_SERIALIZE as readonly string[]).includes(f),
    );
    expect(both, 'trường bị cấm tuyệt đối thì không cần luật che').toEqual([]);
  });

  it('mọi lý do trong danh sách đã-rà đều có nội dung — "đã rà" mà không nói vì sao là chưa rà', () => {
    for (const [field, reason] of Object.entries(REVIEWED_NON_SENSITIVE)) {
      expect(reason.length, `trường ${field}`).toBeGreaterThan(10);
    }
  });
});
