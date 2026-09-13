import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  blankCommentsAndStrings,
  scanGrantSpreadCollisions,
  scanGrantWindowCopies,
} from './grant-window-scan';

const SRC = join(__dirname, '..', 'src');
/* Quét cả `scripts/` — cùng lý lẽ đã ghi ở ratchet lọc trạng thái: script chạy lệnh thật
 * trên CSDL thật, nên một cửa sổ hiệu lực sai ở đó nói dối y hệt, và còn nguy hơn vì script
 * hay là thứ người ta dùng để ĐI TÌM LỖI. */
const SCRIPTS = join(__dirname, '..', 'scripts');

/* Quét cả app WORKER — và đây là bài học đắt nhất của lượt này.
 *
 * Lưới bản đầu chỉ soi `apps/api`. Trong khi đó `apps/worker/src/agent-identity.ts` chép
 * NGUYÊN mảnh cửa sổ hiệu lực, trên đúng bảng `roleAssignment`, từ trước lượt gom — và lưới
 * vẫn xanh. Bộ quét không hỏng một chút nào; không ai chia nó về phía đó. Một cái lưới chỉ
 * bắt được đúng phần mã người ta trỏ nó vào, nên PHẠM VI QUÉT là thứ phải soi trước regex.
 *
 * Worker đổi trạng thái mộ dưới ghế máy, và nó quyết định "ghế này còn quyền không" bằng
 * chính mảnh đó. Lệch biên ở đây là tiến trình nền chạy tiếp bằng một quyền đã hết hạn — không
 * người dùng nào nhìn thấy để mà kêu.
 *
 * Tiền lệ quét chéo app đã có: `permission-catalog-invariants.spec.ts` soi `apps/web`.
 */
const WORKER = join(__dirname, '..', '..', 'worker', 'src');

/* CÒN GÌ CHƯA QUÉT — khai ra để chú thích trên đừng hứa nhiều hơn mã làm được.
 *
 * `apps/web` KHÔNG nằm trong gốc quét, và có thật một bản chép tay ở đó:
 * `app/(admin)/organization/assignments/page.tsx` lọc "còn hiệu lực" bằng
 * `r.validTo === null || new Date(r.validTo) > new Date()` (hai chỗ). Nó còn thiếu hẳn vế
 * `validFrom`, tức một grant CHƯA tới ngày hiệu lực vẫn được màn hình đếm là đang chạy.
 *
 * Chưa gom vào đây vì hai lẽ, cả hai đều là quyết định chứ không phải quên: (1) bộ quét chỉ đi
 * file `.ts`, mà màn hình là `.tsx` — mở sang `.tsx` là đổi phạm vi của cả lưới; (2) `apps/web`
 * cũng không import được `apps/api/src/common`, nên chuyển nó cần đúng cái gói dùng chung mà
 * `apps/worker` đang chờ. Gom một lượt khi nâng `grantInForce` lên gói chung thì hợp lý hơn là
 * vá lẻ ở đây.
 *
 * Ghi ra vì đó là bài học vừa trả giá: điểm mù không kêu, chỉ có người đọc chú thích mới thấy.
 */

/* Mồi có chủ đích, KHÔNG nằm trong gốc quét thật — xem `fixtures/grant-window-bait.ts`. Chỉ
 * phép tự kiểm dưới trỏ vào đây. */
const FIXTURES = join(__dirname, 'fixtures');

/* RATCHET CỬA SỔ HIỆU LỰC CỦA QUYỀN — anh em ruột với ratchet lọc trạng thái, khác bộ cột.
 *
 * LỖI ĐÃ TRẢ GIÁ (09/09/2026): mảnh "grant còn hiệu lực" trên `valid_from`/`valid_to` bị chép
 * tay ở SÁU service trong `apps/api` (và một bản thứ bảy ở `apps/worker`, xem dưới), vì bản
 * dùng chung `stillValid()` viết sai kiểu nên không ai gọi được. Một bản trong sáu dùng `gte`
 * thay vì `gt`. Đúng khoảnh khắc `validTo = now`, danh mục người ký nói "được ký" còn
 * `PermissionGuard` nói 403 — người dùng thấy nút bấm được, bấm vào thì bị từ chối, và không
 * gì trên màn hình giải thích nổi.
 *
 * Đây là tầng QUYỀN. Hai nơi trả lời khác nhau ở đây không phải một màn hình hiển thị sai —
 * nó là cửa mở cho người lẽ ra đã hết hạn, hoặc cửa đóng với người đang còn hạn.
 *
 * Từ nay: mọi chỗ hỏi "grant này còn hiệu lực không" phải lấy định nghĩa từ
 * `common/lifecycle/active.ts` (`grantInForce` cho mệnh đề `where`, `grantInForceAt` cho một
 * bản ghi đã đọc về). Thêm một bản chép tay ở ba gốc trên là ĐỎ.
 */

/* NỢ ĐÃ BIẾT — bản chép tay còn sót, CHƯA chuyển, KHÔNG phải miễn trừ.
 *
 * KHOÁ THEO `đường-dẫn:số-dòng`, không theo tên file. Bản đầu khoá theo tên file, và một dòng
 * nợ ở `users.service.ts` che luôn MỌI hit trong file đó — đúng cái file rủi ro nhất, nơi một
 * bản `gte` mới có thể mọc thêm mà lưới vẫn xanh. Hai lưới anh em khoá mịn hơn từ đầu
 * (`scope-check-invariants` và `route-caller-invariants` khoá theo `file:method`); lưới này
 * nay theo kịp. Một dòng miễn trừ chỉ được che ĐÚNG một dòng.
 *
 * Đổi lại: sửa file làm dịch số dòng thì phép kiểm 2 và 3 cùng đỏ. Đó là ý muốn — số dòng
 * dịch nghĩa là có người vừa sửa đúng file đang nợ, và đó là lúc nên nhìn lại món nợ chứ không
 * phải lúc để lưới im.
 *
 * Khác hẳn một dòng "đã rà, cho qua": mấy dòng dưới đây là VIỆC CÒN NỢ, và hai phép kiểm
 * dưới ép danh sách này chỉ được NGẮN ĐI. Thêm bản mới → đỏ ở phép kiểm 2. Chữa xong mà quên
 * xoá dòng khỏi đây → đỏ ở phép kiểm 3, nên không ai bỏ lại được một cái tên chết trong danh
 * sách rồi tưởng là mình vẫn còn nợ.
 */
const KNOWN_UNCONVERTED: Readonly<Record<string, string>> = {
  'apps/api/src/modules/iam/users.service.ts:22':
    'Ô chọn người ở danh bạ IAM còn chép tay cửa sổ hiệu lực. Ngoài phạm vi lượt gom 09/09/2026 (lượt đó chỉ đụng authorization + cards); phải chuyển sang grantInForce ở lượt sau.',
  'apps/worker/src/agent-identity.ts:43':
    '`apps/worker` là package RIÊNG (`rootDir: src`, chỉ phụ thuộc `@erp/audit`), KHÔNG import được `apps/api/src/common/lifecycle`. Muốn hết chép tay thì phải nâng `grantInForce` lên một gói dùng chung như `packages/audit` — đó là một quyết định thiết kế riêng, không phải việc dọn kèm của lượt này.',
  'apps/worker/src/agent-identity.ts:44':
    'Nửa `OR` của cùng mảnh ở dòng 43, cùng một món nợ và cùng một lý do: `apps/worker` không với tới `apps/api/src/common` được, phải nâng `grantInForce` lên gói dùng chung trước đã.',
};

describe('cửa sổ hiệu lực của quyền — một định nghĩa, không nhiều bản', () => {
  const hits = scanGrantWindowCopies(SRC, SCRIPTS, WORKER);

  /* PHÉP TỰ KIỂM — neo vào MỒI, không neo vào NỢ.
   *
   * Bản đầu neo bằng `expect(hits.length).toBeGreaterThan(0)`, tức là bắt bộ quét phải còn
   * thấy nợ thật. Nó xanh nhờ đúng MỘT dòng nợ, trong khi một phép kiểm khác lại BẮT BUỘC
   * phải chuyển dòng đó đi và xoá tên khỏi `KNOWN_UNCONVERTED`. Làm đúng theo lệnh của chính
   * cái lưới ⇒ `hits` rỗng ⇒ phép tự kiểm đỏ, kèm câu chẩn đoán sai hẳn ("bộ quét hỏng") giữa
   * lúc bộ quét đang chạy đúng. Một phép kiểm phạt người trả xong nợ là một phép kiểm dạy
   * người ta đừng trả.
   *
   * Nên neo vào `fixtures/grant-window-bait.ts`: mấy con mồi ở đó không bao giờ được chữa, nên
   * phép kiểm này chỉ đỏ khi bộ quét thật sự hỏng. Cùng nếp `scope-check-invariants.spec.ts`
   * (neo vào thứ bộ quét PHẢI thấy), và cố ý khác `status-filter-invariants.spec.ts` — anh em
   * cùng nhà ở đó CÓ Ý không neo kiểu này, nên chỗ này phải nói rõ vì sao mình neo.
   */
  it('bộ quét đọc được mã và BẮT được mọi hình dạng đã biết (tự kiểm bằng mồi)', () => {
    const bait = scanGrantWindowCopies(FIXTURES);
    const where = bait.filter((h) => h.kind === 'where');
    const predicate = bait.filter((h) => h.kind === 'predicate');

    const shape = 'ĐỪNG sửa fixtures/grant-window-bait.ts để cho test xanh — nó là cái neo.';
    expect(where.length, `mệnh đề where. ${shape}`).toBe(4);
    expect(predicate.length, `vị từ. ${shape}`).toBe(4);

    /* Mồi 2 — mệnh đề bị XUỐNG DÒNG, mang luôn biên sai. Bản đầu bỏ lọt sạch hình dạng này.
     * Đòi `startsWith` chứ không `includes`: chữ `gte` còn nằm trong chú thích và chuỗi đối
     * chứng của chính file mồi, mà đoạn trích lấy trên nguồn GỐC nên `includes` có thể xanh
     * nhờ một chữ trong chú thích lân cận — tức xanh mà chẳng chứng minh gì. */
    expect(
      where.some((h) => h.text.startsWith('validTo: { gte')),
      'mệnh đề `validTo: {\\n gte: now\\n}` viết xuống dòng đã lọt — bộ quét lại soi từng dòng một?',
    ).toBe(true);

    /* Mồi 4 — vị từ đã phá cấu trúc, không còn dấu `.` trước tên cột. Phải loại trừ `row.`:
     * mồi 3 (dạng có dấu chấm) cũng cho đoạn trích mở đầu bằng `validFrom <=`, nên nếu không
     * loại thì phép kiểm này xanh nhờ mồi 3 và câu nó khẳng định là câu nói dối. */
    expect(
      predicate.some((h) => h.text.startsWith('validFrom <=') && !h.text.includes('row.')),
      'vị từ trên biến đã phá cấu trúc đã lọt — regex lại bắt buộc có dấu `.` trước tên cột?',
    ).toBe(true);

    // Đường dẫn phải đọc ra được là của app nào, vì nay quét nhiều package.
    expect(bait.every((h) => h.file.startsWith('apps/api/test/fixtures/'))).toBe(true);

    // Mồi 5 + Đối chứng 1: đúng MỘT vụ trải đè `OR`, và cách viết `AND: [...]` đúng thì im.
    expect(
      scanGrantSpreadCollisions(FIXTURES).map((c) => `${c.file}:${String(c.line)}`),
      `trải đè khoá OR. ${shape}`,
    ).toHaveLength(1);
  });

  it('không chỗ nào chép tay mảnh validFrom/validTo (gồm cả biên `gte` sai)', () => {
    const undecided = hits.filter(
      (h) => KNOWN_UNCONVERTED[`${h.file}:${String(h.line)}`] === undefined,
    );
    expect(
      undecided.map((h) => `${h.file}:${String(h.line)} [${h.kind}] → ${h.text}`),
      [
        'Dùng grantInForce() / grantInForceAt() ở common/lifecycle/active.ts. Biên là `gt`, KHÔNG phải `gte` — PermissionGuard dùng gt, lệch một bên là màn hình nói được mà cửa nói 403.',
        'LƯỚI NÀY CHỈ QUẢN BA BẢNG CẤP QUYỀN: RoleAssignment, ScopeAssignment, AccessRule.',
        'Nếu `validTo` bạn vừa viết là của mô hình KHÁC — ví dụ `ExternalContract.validTo`, tức HẠN HỢP ĐỒNG, một khái niệm hoàn toàn khác và không có `validFrom` đi kèm — thì ĐỪNG nhét grantInForce vào (nó mang theo `validFrom` mà bảng đó không có). Khai một dòng miễn trừ ở KNOWN_UNCONVERTED kèm lý do nói rõ đó là cột của mô hình nào.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('danh sách nợ chỉ được NGẮN ĐI — chữa xong thì phải xoá dòng khỏi đây', () => {
    const stillCopying = new Set(hits.map((h) => `${h.file}:${String(h.line)}`));
    const stale = Object.keys(KNOWN_UNCONVERTED).filter((k) => !stillCopying.has(k));
    expect(
      stale,
      'Dòng này không còn chép tay nữa: hoặc đã chuyển sang grantInForce (thì bỏ hẳn dòng khỏi KNOWN_UNCONVERTED), hoặc số dòng vừa dịch vì có người sửa file (thì cập nhật lại số dòng — và nhân thể nhìn lại xem có trả được món nợ luôn không).',
    ).toEqual([]);
  });

  it('mọi dòng nợ đều nói rõ vì sao chưa chuyển — "đã rà" mà không nói gì là chưa rà', () => {
    for (const [key, reason] of Object.entries(KNOWN_UNCONVERTED)) {
      expect(reason.length, `lý do cho ${key}`).toBeGreaterThan(40);
    }
  });
});

/* Dạng lỗi thứ hai, KHÔNG phải bản sao: dùng đúng hàm chung nhưng TRẢI vào nhầm chỗ.
 *
 * `grantInForce()` mang khoá `OR`. Trải nó vào một object đã có `OR` riêng (ví dụ `accessRule`
 * lọc `subjectUserId`) thì khoá sau đè khoá trước — không lỗi, không cảnh báo, mất im lặng
 * một nửa điều kiện. Cách viết đúng là `AND: [grantInForce(now)]`, và lưới chỉ soi dạng TRẢI
 * nên cách viết đúng không bao giờ bị báo.
 *
 * GIỚI HẠN đã biết, chép lại ở đây để không ai tưởng phép kiểm này hứa nhiều hơn: lưới bám vào
 * hình dạng `...grantInForce(`. Gán qua biến trung gian rồi mới trải thì LỌT. Xem chú thích ở
 * `grant-window-scan.ts`.
 */
describe('grantInForce mang khoá OR — không được trải vào object đã có OR riêng', () => {
  it('không chỗ nào để hai khoá OR đè nhau', () => {
    expect(
      scanGrantSpreadCollisions(SRC, SCRIPTS, WORKER).map(
        (c) => `${c.file}:${String(c.line)} → ${c.text}`,
      ),
      'Object này đã có khoá OR riêng. Đặt cửa sổ hiệu lực vào AND: [grantInForce(now)] thay vì trải ra.',
    ).toEqual([]);
  });
});

/* Bộ xoá chú thích/chuỗi là chỗ cái lưới dễ nói dối nhất: xoá hụt thì ví dụ trong chú thích
 * bị báo đỏ (dạy người ta đừng viết chú thích), xoá quá tay thì mã thật biến mất và lưới
 * chẳng bắt được gì. Kiểm thẳng nó. */
describe('bộ xoá chú thích/chuỗi — giữ mã, bỏ chữ', () => {
  it('mảnh nằm trong chú thích không bị tính là mã', () => {
    const out = blankCommentsAndStrings('// validTo: { gte: now }\nconst a = 1;\n');
    expect(out).not.toContain('gte');
    expect(out).toContain('const a = 1;');
  });

  it('mảnh nằm trong chuỗi không bị tính là mã', () => {
    const out = blankCommentsAndStrings("const s = 'validTo: { gte: now }';\n");
    expect(out).not.toContain('gte');
  });

  it('giữ nguyên số dòng để chỉ đúng chỗ', () => {
    const src = '/* một\nhai\nba */\nconst a = 1;\n';
    expect(blankCommentsAndStrings(src).split('\n').length).toBe(src.split('\n').length);
  });

  /* Giữ nguyên ĐỘ DÀI, không chỉ số dòng: số dòng và đoạn trích đều tính bằng offset trên
   * nguồn gốc, nên lệch một ký tự là chỉ sai chỗ. */
  it('giữ nguyên độ dài để offset còn trỏ đúng', () => {
    const src = "/* xoá */ const s = 'chuỗi'; // đuôi\n";
    expect(blankCommentsAndStrings(src).length).toBe(src.length);
  });

  it('mã thật thì giữ nguyên', () => {
    expect(blankCommentsAndStrings('validTo: { gt: now }')).toContain('gt');
  });
});
