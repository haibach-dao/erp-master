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

/* Grant/luật còn hiệu lực theo `validFrom`/`validTo` — cùng ý với `inEffect` nhưng khác
 * tên cột. Hai bộ cột khác nhau ở hai nhóm bảng, nên hai hàm; gộp làm một hàm nhận tên
 * cột thì mất kiểu và Prisma không kiểm được nữa. */
export function stillValid(now: Date = new Date()) {
  return [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validTo: null }, { validTo: { gte: now } }] },
  ];
}

/** Mục con của hồ sơ nhân thân còn dùng (số điện thoại, địa chỉ, học vấn, tài khoản). */
export const activeSubRecord = { status: 'active' } as const;
