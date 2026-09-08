/* MỘT SỔ LUẬT CHE TIỀN PHÍ THẺ MỘ, dùng chung cho mọi controller trả số tiền đó.
 *
 * VÌ SAO TÁCH RA (bắt được 07/09/2026 bằng một lượt soi độc lập trước khi mở PR):
 *
 * `CardsController` khai ba luật che tại chỗ. Lát 1 thêm `CardApprovalsController`, và route
 * `GET /cemetery/card-approvals` trả `quoteTotal` cùng `quoteSnapshot` — CÙNG những con số ấy,
 * qua một cửa khác, KHÔNG che gì. Vai `KD_KINH_DOANH` cầm `cemetery.card.submit` nhưng KHÔNG
 * cầm `cemetery.card_fee.view` (hai vai tác nghiệp liệt kê mã bằng tay, không dùng gói
 * `CEMETERY_READ_ALL` — chỗ DUY NHẤT cấp mã đó). Họ xem trước thẻ thì thấy `***`, mở hồ sơ
 * trình duyệt thì thấy `200000`. Một quyết định về "ai được xem tiền" bị vô hiệu bằng đúng
 * route mới của lát này.
 *
 * Khai ở một chỗ thì controller thứ ba sau này chỉ có một dòng để chép, và `masking-invariants`
 * có một hằng số để soi — thay vì ba chuỗi rải rác mà chú thích ở `cards.controller.ts` đã tự
 * cảnh báo là "không test nào kiểm".
 *
 * `quoteTotal` là tên trường MỚI của lát 1 và không trùng luật che nào đang có trong hệ, nên
 * thiếu nó ở đây là nó KHÔNG BAO GIỜ bị che ở bất kỳ đâu. Bốn tên, không phải ba.
 *
 * `maskTree` đi vào cả mảng lẫn object lồng nhau, nên bốn tên này bắt được cả `fee.totalAmount`,
 * từng `fee.lines[].feeAmount`, lẫn `quoteSnapshot.lines[].unitPrice`.
 */
export const CARD_FEE_MASK_RULES = [
  { field: 'totalAmount', permission: 'cemetery.card_fee.view' },
  { field: 'feeAmount', permission: 'cemetery.card_fee.view' },
  { field: 'unitPrice', permission: 'cemetery.card_fee.view' },
  { field: 'quoteTotal', permission: 'cemetery.card_fee.view' },
] as const;
