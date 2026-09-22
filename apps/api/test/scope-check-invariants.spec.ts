import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  scanCallerWideScopeApi,
  scanUnguardedCallerMethods,
  unguardedInText,
} from './scope-check-scan';

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
 * Đây là NỢ ĐÃ ĐO, không phải chỗ được miễn. Bốn dòng dưới là phần CÒN LẠI sau khi anh Bách
 * quyết bó `contracts.verify` + `activate` (27/08/2026) — chưa quyết thì chưa đổi, vì bó phạm vi ở đây là
 * đổi HÀNH VI (người đang làm được sẽ nhận 403), và neo vào đâu thì mỗi hàm một câu hỏi.
 *
 * Thêm một dòng vào đây phải viết ra vì sao KHÔNG bó được. "Vì tiện" không phải lý do, và
 * "sẽ làm sau" cũng không — đã có chỗ ghi nợ rồi.
 */
/* HAI DÒNG ĐÃ TRẢ (18/09/2026): `contracts.service.ts:create` và `services.service.ts:
 * subscribe`. Lý do hoãn của cả hai là CÙNG MỘT câu hỏi nghiệp vụ — "hợp đồng / thuê bao có
 * thể thuộc công ty khác với phần mộ không" — và anh Bách đã chốt 17/09: CÓ, khách công ty A
 * được đứng tên mộ công ty B. Chốt xong thì lý do hoãn hết hiệu lực, và cả hai nay hỏi phạm
 * vi trên CẢ HAI VẾ (công ty của chính bản ghi, và phần mộ nơi công việc diễn ra) mà KHÔNG
 * đổi ngữ nghĩa cột `companyId`. */
const MEASURED_UNGUARDED: Readonly<Record<string, string>> = {
  'modules/services/services.service.ts:renew':
    'Cùng nợ với `subscribe` — gia hạn quy phạm vi qua chính thuê bao đó.',
  'modules/services/services.service.ts:cancel':
    'Cùng nợ với `subscribe`. Huỷ thuê bao là dừng thu tiền, nên bó phạm vi ở đây đổi hành vi thật.',
};

describe('phạm vi — method nhận Caller thì phải HỎI phạm vi', () => {
  const hits = scanUnguardedCallerMethods(SRC);

  /* Cái quét trả rỗng thì mọi test dưới xanh mà chẳng kiểm gì. Ratchet lọc trạng thái đã
   * bị đúng cú đó, nên neo lại: khẳng định nó ĐỌC ĐƯỢC mã nguồn và thấy method thật. */
  it('bộ quét chạy được và đọc ra mã nguồn thật (tự kiểm cái quét)', () => {
    expect(() => scanUnguardedCallerMethods(SRC)).not.toThrow();
  });

  /* Dòng nợ nào bộ quét KHÔNG còn thấy thì phải xoá khỏi sổ — nếu không, sổ nợ nói dối theo
   * hướng NHỎ ĐI: nó giữ một miễn trừ cho một chỗ đã bó xong, và miễn trừ ấy sẽ che đúng chỗ
   * đó nếu lần sau ai gỡ phép bó ra.
   *
   * KHÔNG còn khẳng định "sổ nợ phải khác rỗng". Khẳng định đó biến ngày TRẢ HẾT NỢ thành
   * ngày test đỏ, và sức ép đổ thẳng vào cái đang canh. Việc "bộ quét có thật sự thấy method
   * hay không" nay do nhóm tự-kiểm bằng văn bản dựng sẵn ở dưới lo, và nhóm đó không mục. */
  it('sổ nợ không giữ dòng nào bộ quét đã hết thấy', () => {
    const stale = Object.keys(MEASURED_UNGUARDED).filter((key) => {
      const [file, method] = key.split(':');
      return !hits.some((h) => h.file === file && h.method === method);
    });
    expect(
      stale,
      'Những dòng này đã bó phạm vi xong — xoá khỏi MEASURED_UNGUARDED, đừng để miễn trừ sống thừa',
    ).toEqual([]);
  });

  it('không có lỗ MỚI nào ngoài bốn chỗ đã đo và đã nêu để quyết', () => {
    const unexpected = hits
      .map((h) => `${h.file}:${h.method}`)
      .filter((k) => !(k in MEASURED_UNGUARDED));
    expect(
      unexpected,
      'Method này nhận `Caller` nhưng không gọi assertCompanyFor/assertPlotFor/plotScopeFilterFor/visibleCompanyIdsFor/levelFor (kể cả qua helper). Gate quyền không gate BẢN GHI: hãy bó phạm vi, hoặc thêm vào MEASURED_UNGUARDED kèm lý do.',
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

/* TỰ KIỂM BỘ QUÉT bằng văn bản dựng sẵn.
 *
 * Nhóm trên đo TRẠNG THÁI của kho; nhóm này đo CHÍNH CÁI THƯỚC. Tách ra vì hai thứ mục theo
 * hai nhịp khác nhau: kho thay đổi mỗi ngày, còn thước thì chỉ được phép đổi có chủ đích.
 *
 * Mỗi ca dưới đây tương ứng một lỗ ĐO ĐƯỢC của bản trước: một lượt soi độc lập viết thử các
 * hình dạng này và bộ quét im lặng cho qua cả ba.
 */
describe('bộ quét phạm vi — tự kiểm bằng văn bản dựng sẵn', () => {
  const wrap = (members: string) =>
    `import { Caller } from './caller';\n\nexport class T {\n${members}\n}\n`;

  it('thấy method thường không hỏi phạm vi', () => {
    const text = wrap(`  async doGi(id: string, caller: Caller) {
    return this.prisma.x.findMany({ where: { id }, take: 1, skip: 0, orderBy: { id: 'asc' } });
  }`);
    expect(unguardedInText(text).map((m) => m.method)).toEqual(['doGi']);
  });

  // LỖ 1: method có tham số kiểu. `METHOD_HEAD` bản đầu dừng ở `ten(` nên không khớp `ten<T>(`.
  it('thấy method GENERIC không hỏi phạm vi', () => {
    const text = wrap(`  async doGi<T extends object>(id: string, caller: Caller): Promise<T[]> {
    return [] as T[];
  }`);
    expect(unguardedInText(text).map((m) => m.method)).toEqual(['doGi']);
  });

  // LỖ 2: method viết dạng thuộc tính arrow — bản đầu không nhận hình dạng này chút nào.
  it('thấy method dạng ARROW không hỏi phạm vi', () => {
    const text = wrap(`  doGi = async (id: string, caller: Caller) => {
    return id + caller.userId;
  };`);
    expect(unguardedInText(text).map((m) => m.method)).toEqual(['doGi']);
  });

  /* LỖ 3, tệ nhất: nhắc tên hàm bó phạm vi trong CHÚ THÍCH là đủ để được tính đã bó. Kho này
   * viết chú thích rất dày và hay dẫn tên hàm, nên đây không phải giả thuyết. */
  it('KHÔNG tính là đã bó khi tên hàm chỉ nằm trong chú thích', () => {
    const text = wrap(`  /* Chỗ này đáng ra phải gọi assertPlotFor( ... ) nhưng chưa làm. */
  async doGi(id: string, caller: Caller) {
    // Ghi chú: xem thêm assertCompanyFor( ) ở ScopeService.
    return id;
  }`);
    expect(unguardedInText(text).map((m) => m.method)).toEqual(['doGi']);
  });

  // Và không phải "báo tất cho chắc": gọi thật thì im, kể cả ở hai hình dạng mới.
  it('im lặng khi method THẬT SỰ hỏi phạm vi — cả ba hình dạng', () => {
    const text = wrap(`  async thuong(id: string, caller: Caller) {
    await this.scope.assertPlotFor(caller.userId, caller.permission, 'c', 's');
    return id;
  }

  async generic<T>(id: string, caller: Caller): Promise<T[]> {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, 'c');
    return [] as T[];
  }

  arrow = async (id: string, caller: Caller) => {
    await this.scope.plotScopeFilterFor(caller.userId, caller.permission);
    return id;
  };`);
    expect(unguardedInText(text)).toEqual([]);
  });

  /* UỶ NHIỆM vẫn phải được công nhận — mất vế này là báo nhầm hàng loạt, mà báo nhầm làm
   * hỏng lưới: người ta ghi bừa lý do miễn trừ cho đỡ đỏ, rồi miễn trừ thật lọt theo. */
  it('công nhận uỷ nhiệm qua helper, kể cả helper viết dạng arrow', () => {
    const text = wrap(`  private guard = async (caller: Caller) => {
    await this.scope.assertPlotFor(caller.userId, caller.permission, 'c', 's');
  };

  async doGi(id: string, caller: Caller) {
    await this.guard(caller);
    return id;
  }`);
    expect(unguardedInText(text)).toEqual([]);
  });
});
