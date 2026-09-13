/* MỘT nơi định nghĩa "còn hiệu lực", cho mọi mô hình có vòng đời.
 *
 * VÌ SAO FILE NÀY TỒN TẠI — một lỗi đã xảy ra thật (26/08/2026):
 *
 * Màn hình chi tiết khách hàng lọc quyền sử dụng theo `status: 'Active'`. Rào chắn xoá
 * khách hàng thì đếm mọi dòng, không lọc gì. Kết quả: người dùng thu hồi phần mộ, màn
 * hình báo "chưa đứng tên phần mộ nào", nhưng bấm xoá lại bị từ chối "đang đứng tên 1
 * phần mộ". Hai chỗ trả lời khác nhau cho cùng một câu hỏi nghiệp vụ.
 *
 * Vá riêng chỗ đó là vá một CA. Lỗi thật nằm ở chỗ mỗi nơi tự quyết định thế nào là "còn
 * hiệu lực", nên hai nơi sẽ lệch nhau — không phải nếu, mà là khi nào.
 *
 * Quy tắc từ nay: KHÔNG viết `status: 'Active'` thẳng vào một mệnh đề `where` của nghiệp
 * vụ. Dùng các mảnh dưới đây. Chúng là dữ liệu, không phải hàm sinh chuỗi, nên trộn được
 * vào `where` của Prisma và vẫn giữ nguyên kiểu.
 *
 * NGOẠI LỆ CÓ CHỦ ĐÍCH: màn hình lịch sử, nhật ký kiểm toán, và endpoint `*-history` PHẢI
 * lấy cả dòng đã kết thúc. Ở những chỗ đó, viết chú thích nói rõ là cố ý.
 */

/* ---- Danh sách trạng thái, khai đúng MỘT lần ---- */

/** Hồ sơ an táng còn hiệu lực. Trùng với partial unique index `burial_records_active_slot`
 *  ở migration — đổi ở đây thì phải đổi cả migration, và ngược lại. */
export const ACTIVE_BURIAL_STATUSES = ['Draft', 'Verified', 'Scheduled', 'Completed'] as const;

/* Mảnh `where` cho hồ sơ an táng còn hiệu lực.
 *
 * Là HÀM chứ không phải hằng, và trả mảng MỚI mỗi lần: Prisma đòi `string[]` khả biến, còn
 * hằng `as const` thì `readonly`. Trả thẳng hằng ra là mở đường cho một chỗ nào đó `push`
 * vào danh sách dùng chung — và một lần như thế là mọi nơi trong hệ đổi nghĩa cùng lúc. */
export function activeBurial() {
  return { status: { in: [...ACTIVE_BURIAL_STATUSES] } };
}

/* Hồ sơ an táng HUỶ ĐƯỢC.
 *
 * `Completed` cố ý KHÔNG có ở đây: hồ sơ hoàn tất nghĩa là người đã thực sự nằm trong mộ,
 * và huỷ nó là xoá dấu vết một việc đã xảy ra ngoài đời. Muốn đưa người ra khỏi mộ thì đó
 * là DI DỜI/CẢI TÁNG — một thủ tục khác, có hồ sơ riêng, chưa dựng trong hệ. Mở `Completed`
 * cho huỷ là cho phép sửa lịch sử bằng một nút bấm.
 *
 * `Cancelled` cũng không có ở đây: huỷ cái đã huỷ không phải một thao tác.
 *
 * Đây là danh sách cho vế GHI (được phép đổi sang `Cancelled`), không phải bộ lọc đọc —
 * nên nó KHÔNG phải tập con của `ACTIVE_BURIAL_STATUSES` theo nghĩa "còn tính", dù trùng
 * ba phần tử. Hai câu hỏi khác nhau, hai danh sách. */
export const CANCELLABLE_BURIAL_STATUSES = ['Draft', 'Verified', 'Scheduled'] as const;

/** Hợp đồng đang ràng buộc. `Draft` chưa ràng buộc ai; `Cancelled` thì hết. */
export const BINDING_CONTRACT_STATUSES = ['Verified', 'Active'] as const;

/** Thuê bao dịch vụ đang tính là đang dùng. `Renewed` = đã sinh kỳ mới, kỳ cũ hết vai. */
export const LIVE_SUBSCRIPTION_STATUSES = ['Active'] as const;

/* ---- Mảnh `where` dùng lại được ---- */

/** Quyền sử dụng phần mộ đang có hiệu lực — người này ĐANG đứng tên. */
export const activeUsageRight = { status: 'Active' } as const;

/** Quan hệ nhân thân đã xác nhận. `Pending`/`Disputed` KHÔNG đủ căn cứ cho việc không đảo
 *  ngược được như đặt cốt. */
export const confirmedRelationship = { status: 'Confirmed' } as const;

/* Phiếu giữ chỗ CÒN GIỮ THẬT.
 *
 * Hai điều kiện, không phải một: trạng thái `Active` VÀ chưa quá `expiresAt`. Chỉ xét
 * trạng thái là sai, vì `expiresAt` chỉ là một con số trong bảng — không có gì tự đổi
 * trạng thái khi nó trôi qua. Một phiếu hết hạn từ sáng vẫn mang `Active` cho tới khi có
 * ai đó quét (xem `HoldsService.expireStaleHolds`).
 */
export function holdStillHolding(now: Date = new Date()) {
  return { status: 'Active', expiresAt: { gt: now } } as const;
}

/* Phiếu giữ chỗ ĐÃ QUÁ HẠN mà chưa ai quét — nghịch đảo của `holdStillHolding`.
 *
 * Có tên riêng để phân biệt với "quên lọc": bộ quét bất biến sẽ thấy `status: 'Active'` ở
 * đây và tưởng là sót, trong khi đây là chỗ CỐ Ý tìm phiếu còn mang Active mà lẽ ra không
 * nên. Chỉ `expireStaleHolds` dùng nó. */
export function holdStale(now: Date = new Date()) {
  return { status: 'Active', expiresAt: { lt: now } } as const;
}

/* Hồ sơ an táng ĐÃ HOÀN TẤT — người đã thực sự nằm trong mộ.
 *
 * KHÁC `activeBurial()` một cách có chủ đích. Lúc TẠO hồ sơ, sức chứa phải tính cả hồ sơ
 * đang dở (Draft/Verified/Scheduled) để hai người không cùng nhận một chỗ. Lúc HOÀN TẤT,
 * câu hỏi đổi thành "thực tế đã có mấy người nằm đây" — và hồ sơ đang dở thì chưa ai nằm.
 *
 * Hai câu hỏi khác nhau nên hai bộ lọc khác nhau. Ghi ra đây để lần sau không ai "sửa cho
 * nhất quán" rồi làm hỏng một trong hai. */
export const completedBurial = { status: 'Completed' } as const;

/* THẺ NHÃN ĐANG GẮN — chưa bị gỡ.
 *
 * Gỡ thẻ là GHI `removedAt` chứ không xoá dòng (anh Bách chốt 03/09/2026 "lưu vết"), nên
 * mọi câu hỏi "mộ này đang mang thẻ gì" đều phải lọc `removedAt: null`. Quên lọc là đếm cả
 * thẻ đã gỡ — và với thẻ khách thì đó là hiện lại một cái nhãn mà ai đó đã cố ý bỏ đi.
 *
 * Khai ở đây thay vì gõ `{ removedAt: null }` tại chỗ: cùng lý do như mọi mảnh khác trong
 * file này, và lưới `status-filter-scan.ts` cũng đòi vậy.
 */
export const activeTag = { removedAt: null } as const;

/* Khoảng hiệu lực theo ngày: bắt đầu rồi và chưa kết thúc.
 *
 * `null` ở hai đầu nghĩa là "không giới hạn", nên phải cho qua — không cho qua thì mọi
 * bản ghi chưa điền ngày đều bị coi như hết hiệu lực.
 */
export function inEffect(now: Date = new Date()) {
  return [
    { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
    { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
  ];
}

/* GRANT/LUẬT CÒN HIỆU LỰC theo `validFrom`/`validTo` — cùng ý với `inEffect` nhưng khác
 * tên cột. Hai bộ cột khác nhau ở hai nhóm bảng, nên hai hàm; gộp làm một hàm nhận tên cột
 * thì mất kiểu và Prisma không kiểm được nữa.
 *
 * MỘT bản cho cả ba bảng grant: `RoleAssignment`, `ScopeAssignment`, `AccessRule`.
 *
 * BẢN NÀY THAY `stillValid()` (gộp 09/09/2026). Bản cũ tên mơ hồ và KHÔNG DÙNG ĐƯỢC: nó có
 * nhánh `{ validFrom: null }` trong khi `valid_from` là NOT NULL ở cả ba bảng — nhánh đó
 * còn không qua nổi kiểu Prisma. Hệ quả đo được: không một chỗ nào gọi nó, và mảnh này bị
 * CHÉP TAY ở sáu chỗ khác nhau. Một bản dùng chung mà không ai dùng được thì mọi nơi tự
 * chép lấy — đúng cái bệnh cả file này sinh ra để chữa.
 *
 * `gt` CHỨ KHÔNG `gte`, và đây là chỗ quyết định chứ không phải chuyện gu. `PermissionsService`
 * — tầng THỰC SỰ trả lời "người này vào được hay không" — dùng `gt` ở mọi chỗ. Lấy `gte` thì
 * đúng khoảnh khắc `validTo = now` sinh ra một lằn ranh: danh mục người ký nói "được ký",
 * còn `PermissionGuard` nói 403. Người dùng nhìn thấy nút bấm được, bấm vào thì bị từ chối —
 * và không có gì trên màn hình giải thích nổi. Mọi tầng phải trả lời GIỐNG NHAU.
 *
 * TRẢ OBJECT để trộn thẳng vào `where`: `where: { userId, ...grantInForce(now) }`.
 *
 * BẪY: mệnh đề này có khoá `OR`. Chỗ nào ĐÃ có `OR` của riêng nó (ví dụ
 * `accessRule` lọc `subjectUserId`) thì phải đặt vào `AND: [grantInForce(now)]`, KHÔNG trải
 * ra — trải ra là một khoá đè lên khoá kia và mất im lặng một nửa điều kiện.
 *
 * Là HÀM và dựng object MỚI mỗi lần, cùng lý do đã ghi ở `activeBurial()`: Prisma đòi mảng
 * khả biến, và trả về một hằng dùng chung là mở đường cho một chỗ nào đó sửa tại chỗ rồi
 * đổi nghĩa cho toàn hệ. */
export function grantInForce(now: Date = new Date()) {
  return { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
}

/* CÙNG MỘT LUẬT, dạng VỊ TỪ trên một dòng đã đọc về — cho chỗ đã cầm bản ghi trong tay và
 * chỉ cần dán nhãn "còn hiệu lực" lên nó (`AccessRulesService.list`).
 *
 * Nằm SÁT `grantInForce` là cố ý. Đây là hai dạng của MỘT luật, và biên `>` ở đây phải khớp
 * `gt` ở trên. Để nó ở service thì có ngày `gt` bên trên thành `>=` bên dưới, và màn hình
 * quản trị dán nhãn "còn hiệu lực" lên đúng cái luật mà chuỗi duyệt đã bỏ qua — một màn
 * hình nói dối về chính thứ nó quản. */
export function grantInForceAt(
  row: { validFrom: Date; validTo: Date | null },
  now: Date = new Date(),
): boolean {
  return row.validFrom <= now && (row.validTo === null || row.validTo > now);
}

/** Mục con của hồ sơ nhân thân còn dùng (số điện thoại, địa chỉ, học vấn, tài khoản). */
export const activeSubRecord = { status: 'active' } as const;

/* NGƯỜI KÝ THẺ MỘ đang dùng.
 *
 * `Retired` = ngừng dùng, KHÔNG xoá — thẻ đã cấp năm ngoái vẫn phải đọc ra được tên người
 * đã ký nó. Nên mọi câu hỏi "ai ký được cho nghĩa trang này hôm nay" đều phải lọc, còn màn
 * hình danh mục thì cố ý KHÔNG lọc (quản trị cần thấy cả người đã ngừng).
 */
export const activeCardSigner = { status: 'Active' } as const;
