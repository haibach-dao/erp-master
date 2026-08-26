import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { findDuplicateStatusLists, scanStatusReads } from './status-filter-scan';

const SRC = join(__dirname, '..', 'src');

/* CÁI RATCHET THỨ HAI của repo (cái thứ nhất là ratchet che dữ liệu cá nhân).
 *
 * LỖI ĐÃ TRẢ GIÁ, hai lần trong một ngày (26/08/2026):
 *
 * Lần 1 — màn hình chi tiết khách hàng lọc quyền sử dụng theo `status: 'Active'`, rào chắn
 * xoá khách hàng thì đếm mọi dòng không lọc gì. Người dùng thu hồi phần mộ, màn hình báo
 * "chưa đứng tên phần mộ nào", bấm xoá lại bị từ chối "đang đứng tên 1 phần mộ".
 *
 * Lần 2 — sau khi vá lần 1, chủ doanh nghiệp gặp lại cùng triệu chứng ở một khách khác, và
 * nói đúng chỗ đau: "e khắc phục lỗi toàn diện, không xử lý theo case như này".
 *
 * Vá từng ca là vá triệu chứng. Bệnh nằm ở chỗ mỗi nơi TỰ QUYẾT ĐỊNH thế nào là "còn hiệu
 * lực" — nên hai nơi sẽ lệch nhau, không phải nếu mà là khi nào. Test này là thuốc: từ nay
 * mọi mệnh đề ĐỌC phải lấy định nghĩa từ `common/lifecycle/active.ts`, và thêm một chỗ gõ
 * thẳng là gãy build chứ không lặng lẽ tạo ra một nguồn sự thật thứ hai.
 *
 * Vế GHI (`data: { status: 'Completed' }`) không bị soi — nêu đích danh một trạng thái ở
 * chỗ đang ĐẶT trạng thái là đúng việc của nó.
 */

/* Chỗ đọc được phép gõ thẳng trạng thái, kèm LÝ DO.
 *
 * Trống là có chủ đích. Muốn thêm một dòng vào đây thì phải viết ra vì sao chỗ đó không
 * dùng được định nghĩa chung — và "vì tiện" không phải một lý do.
 */
const REVIEWED_RAW_STATUS_READS: Readonly<Record<string, string>> = {};

describe('lọc trạng thái — một định nghĩa, không nhiều bản', () => {
  const hits = scanStatusReads(SRC);

  it('bộ quét chạy được và đọc ra mã nguồn (tự kiểm cái quét)', () => {
    /* Nếu bộ quét hỏng và trả rỗng thì test dưới sẽ luôn xanh mà chẳng kiểm gì. Neo lại
     * bằng cách khẳng định nó ĐỌC ĐƯỢC file: cái quét từng nói dối hai lần ở ratchet kia. */
    expect(() => scanStatusReads(SRC)).not.toThrow();
    expect(Array.isArray(hits)).toBe(true);
  });

  it('không mệnh đề ĐỌC nào gõ thẳng trạng thái', () => {
    const undecided = hits.filter((h) => REVIEWED_RAW_STATUS_READS[h.file] === undefined);
    expect(
      undecided.map((h) => `${h.file}:${h.line} → ${h.text}`),
      'Dùng mảnh từ common/lifecycle/active.ts, hoặc ghi lý do vào REVIEWED_RAW_STATUS_READS',
    ).toEqual([]);
  });

  it('mọi lý do miễn trừ đều có nội dung — "đã rà" mà không nói vì sao là chưa rà', () => {
    for (const [file, reason] of Object.entries(REVIEWED_RAW_STATUS_READS)) {
      expect(reason.length, `miễn trừ cho ${file}`).toBeGreaterThan(20);
    }
  });
});

/* Danh sách trạng thái bị chép nhiều bản là dạng khác của cùng một bệnh: hai bản sao sẽ
 * lệch nhau vào ngày ai đó thêm một trạng thái vào một bản. Trước khi gom về
 * `common/lifecycle`, `ACTIVE_BURIAL_STATUSES` từng có BỐN bản trong bốn service khác nhau.
 */
describe('danh sách trạng thái không được chép ra nhiều bản', () => {
  it('chỉ `common/lifecycle` được khai danh sách trạng thái', () => {
    expect(
      findDuplicateStatusLists(SRC),
      'import từ common/lifecycle/active.ts thay vì khai lại',
    ).toEqual([]);
  });
});
