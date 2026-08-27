import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanCallerWideScopeApi, scanUnguardedCallerMethods } from './scope-check-scan';

const SRC = join(__dirname, '..', 'src');
const SCOPE_SERVICE = join(SRC, 'modules', 'authorization', 'scope.service.ts');

/* RATCHET PHẠM VI. Đọc chú thích dài ở `scope-check-scan.ts` trước — nó kể hai tầng lỗi.
 *
 * Việc của test này: gate quyền (`@RequirePermission`) trả lời "có được làm việc này hay
 * không". Nó KHÔNG trả lời "làm lên bản ghi NÀO". Method nhận `Caller` mà không hỏi phạm
 * vi là method tin vào id client gửi lên — biết id là chạm được, dù id đó thuộc công ty
 * hay nghĩa trang khác.
 */

/* Method nhận `Caller` mà CHƯA hỏi phạm vi, kèm LÝ DO.
 *
 * Đây là NỢ ĐÃ ĐO, không phải chỗ được miễn. Sáu dòng dưới là hiện trạng đo ngày
 * 27/08/2026, đã nêu để anh Bách quyết — chưa quyết thì chưa đổi, vì bó phạm vi ở đây là
 * đổi HÀNH VI (người đang làm được sẽ nhận 403), và neo vào đâu thì mỗi hàm một câu hỏi.
 *
 * Thêm một dòng vào đây phải viết ra vì sao KHÔNG bó được. "Vì tiện" không phải lý do, và
 * "sẽ làm sau" cũng không — đã có chỗ ghi nợ rồi.
 */
const MEASURED_UNGUARDED: Readonly<Record<string, string>> = {
  'modules/contracts/contracts.service.ts:create':
    'Neo vào `dto.companyId` do client gửi thì phải kiểm TRƯỚC khi tạo; chưa quyết vì hợp đồng có thể tạo cho công ty khác trong cùng tập đoàn (nghiệp vụ chưa chốt).',
  'modules/contracts/contracts.service.ts:verify':
    'Neo có sẵn và rõ (`contract.companyId`, y như `cancel` đang dùng), nhưng bó lại là đổi hành vi ở bước thẩm định — chờ anh Bách quyết cùng lượt với `activate`.',
  'modules/contracts/contracts.service.ts:activate':
    'Cùng neo với `verify`. Cho hiệu lực là bước sinh quyền sử dụng, nên đổi hành vi ở đây phải quyết cùng `verify` chứ không lệch nhau một bên.',
  'modules/services/services.service.ts:subscribe':
    'Không có neo nào chắc: dịch vụ gắn vào thuê bao, `companyId` phải quy qua danh mục dịch vụ hoặc phần mộ — chưa quyết quy đường nào.',
  'modules/services/services.service.ts:renew':
    'Cùng nợ với `subscribe` — gia hạn quy phạm vi qua chính thuê bao đó.',
  'modules/services/services.service.ts:cancel':
    'Cùng nợ với `subscribe`. Huỷ thuê bao là dừng thu tiền, nên bó phạm vi ở đây đổi hành vi thật.',
};

describe('phạm vi — method nhận Caller thì phải HỎI phạm vi', () => {
  const hits = scanUnguardedCallerMethods(SRC);

  /* Cái quét trả rỗng thì mọi test dưới xanh mà chẳng kiểm gì. Ratchet lọc trạng thái đã
   * bị đúng cú đó, nên neo lại: khẳng định nó ĐỌC ĐƯỢC mã nguồn và thấy method thật. */
  it('bộ quét chạy được và thật sự đọc ra method (tự kiểm cái quét)', () => {
    expect(() => scanUnguardedCallerMethods(SRC)).not.toThrow();
    expect(Object.keys(MEASURED_UNGUARDED).length).toBeGreaterThan(0);
    for (const key of Object.keys(MEASURED_UNGUARDED)) {
      const [file, method] = key.split(':');
      expect(
        hits.some((h) => h.file === file && h.method === method),
        `bộ quét KHÔNG còn thấy ${key} — nếu vừa bó phạm vi cho nó thì xoá dòng này khỏi danh sách nợ`,
      ).toBe(true);
    }
  });

  it('không có lỗ MỚI nào ngoài sáu chỗ đã đo và đã nêu để quyết', () => {
    const unexpected = hits
      .map((h) => `${h.file}:${h.method}`)
      .filter((k) => !(k in MEASURED_UNGUARDED));
    expect(
      unexpected,
      'Method này nhận `Caller` nhưng không gọi assertCompanyFor/assertSiteFor/visibleCompanyIdsFor/listSiteFilterFor (kể cả qua helper). Gate quyền không gate BẢN GHI: hãy bó phạm vi, hoặc thêm vào MEASURED_UNGUARDED kèm lý do.',
    ).toEqual([]);
  });

  it('mọi dòng nợ đều có lý do viết ra, không dòng nào để trống', () => {
    for (const [key, reason] of Object.entries(MEASURED_UNGUARDED)) {
      expect(reason.trim().length, `${key} thiếu lý do`).toBeGreaterThan(30);
    }
  });
});

/* Tầng 1 đã vá bằng cách XOÁ, không bằng cách khuyên dùng bản mới. Còn tồn tại một hàm
 * tính phạm vi ở mức toàn-người-gọi là còn một đường rẻ hơn để đi sai — và người ta sẽ đi.
 */
describe('phạm vi — không còn API tính theo mức RỘNG NHẤT của người gọi', () => {
  it('ScopeService không khai lại bốn hàm bản cũ', () => {
    expect(scanCallerWideScopeApi(SCOPE_SERVICE)).toEqual([]);
  });
});
