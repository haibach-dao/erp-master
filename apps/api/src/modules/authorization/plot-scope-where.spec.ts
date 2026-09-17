import { describe, expect, it } from 'vitest';
import { plotScopeWhere } from './plot-scope-where';

/* HÀM NÀY GÁNH SÁU ĐƯỜNG DANH SÁCH, VÀ TỚI 17/09/2026 KHÔNG CÓ MỘT CA TEST NÀO.
 *
 * Một lượt soi độc lập đo bằng ĐỘT BIẾN: đổi nhánh "không công ty nào" thành `{}` (tức KHÔNG
 * bó gì, fail-open hoàn toàn) rồi chạy cả bộ — 1008/1008 VẪN XANH. Nhánh mà chú thích trong
 * chính file đó cãi kỹ nhất là nhánh không ai canh.
 *
 * Đó là lý do nhóm test này tồn tại và tại sao nó kiểm THẲNG hàm thuần, không đi vòng qua
 * service: một phép kiểm gián tiếp chỉ canh được tới đâu mock của nó trung thực tới đó.
 */
describe('plotScopeWhere — dịch phạm vi theo-từng-công-ty thành mệnh đề where', () => {
  it('null vào thì null ra — KHÔNG bó gì, và chỉ mức GROUP mới nhận được', () => {
    expect(plotScopeWhere(null)).toBeNull();
  });

  /* Nhánh fail-closed. `{}` ở đây nghĩa là "không lọc", tức mở toang — nên nó phải là một
   * mệnh đề KHÔNG BAO GIỜ đúng, và phải tường minh chứ không dựa vào quy ước ngầm của Prisma
   * về `OR: []`. */
  it('danh sách RỖNG ra một mệnh đề không bao giờ đúng, KHÔNG phải "không lọc"', () => {
    const w = plotScopeWhere([]);
    expect(w).toEqual({ companyId: { in: [] } });
    expect(w).not.toEqual({});
    expect(w).not.toBeNull();
  });

  it('một công ty "cả công ty" ra mệnh đề chỉ có công ty', () => {
    expect(plotScopeWhere([{ companyId: 'co-a', cemeteryIds: null }])).toEqual({
      OR: [{ companyId: 'co-a' }],
    });
  });

  it('một công ty bó theo nghĩa trang ra mệnh đề mang CẢ HAI cột', () => {
    expect(plotScopeWhere([{ companyId: 'co-b', cemeteryIds: ['nt-1', 'nt-2'] }])).toEqual({
      OR: [{ companyId: 'co-b', cemeteryId: { in: ['nt-1', 'nt-2'] } }],
    });
  });

  /* Đây là hình dạng mà hai danh sách phẳng không diễn đạt nổi, và là toàn bộ lý do hàm này
   * tồn tại: công ty A cả công ty, công ty B chỉ nghĩa trang được giao. */
  it('HAI CÔNG TY LỆCH MỨC ra hai mục riêng, không gộp phẳng', () => {
    expect(
      plotScopeWhere([
        { companyId: 'co-a', cemeteryIds: null },
        { companyId: 'co-b', cemeteryIds: ['nt-b1'] },
      ]),
    ).toEqual({
      OR: [{ companyId: 'co-a' }, { companyId: 'co-b', cemeteryId: { in: ['nt-b1'] } }],
    });
  });

  /* Được giao không nghĩa trang nào TRONG một công ty: vẫn phải sinh mệnh đề `in: []` cho
   * công ty đó, chứ không được bỏ cột nghĩa trang đi — bỏ đi là cho họ trọn công ty. */
  it('công ty bó theo nghĩa trang mà danh sách rỗng thì vẫn giữ cột nghĩa trang', () => {
    expect(plotScopeWhere([{ companyId: 'co-b', cemeteryIds: [] }])).toEqual({
      OR: [{ companyId: 'co-b', cemeteryId: { in: [] } }],
    });
  });

  /* `Cemetery` CHÍNH NÓ là nghĩa trang nên cột nghĩa trang của nó là `id`. Tham số `cols` là
   * thứ duy nhất giữ hai nơi gọi đó khỏi hỏi sai cột. */
  it('đổi tên cột theo bảng — Cemetery dùng `id` làm trục nghĩa trang', () => {
    expect(
      plotScopeWhere([{ companyId: 'co-b', cemeteryIds: ['nt-1'] }], {
        company: 'companyId',
        cemetery: 'id',
      }),
    ).toEqual({ OR: [{ companyId: 'co-b', id: { in: ['nt-1'] } }] });
  });

  it('đổi tên cột cũng áp cho nhánh RỖNG', () => {
    expect(plotScopeWhere([], { company: 'cty', cemetery: 'id' })).toEqual({ cty: { in: [] } });
  });
});
