import type { BadgeProps } from '@/components/ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

/* Nhật ký kiểm toán hiện ra màn hình.
 *
 * Server ghi mã máy đọc (`PERSON.PHONE_ADDED`) vì nhật ký là append-only: đổi cách gọi
 * một hành động KHÔNG được làm hỏng những dòng đã ghi năm trước. Bảng dưới đây chỉ đổi
 * CÁCH HIỆN; mọi lọc và so sánh vẫn dùng mã gốc.
 *
 * Mã lạ thì hiện nguyên mã — thà người dùng thấy `SMOKE.ONE` còn hơn thấy ô trống hoặc
 * một câu tiếng Việt đoán sai.
 */
const ACTION: Record<string, string> = {
  // Đăng nhập
  'AUTH.LOGIN_OK': 'Đăng nhập thành công',

  // Nhân thân & khách hàng
  'PERSON.CREATED': 'Tạo hồ sơ nhân thân',
  'PERSON.PHONE_ADDED': 'Thêm số điện thoại',
  'PERSON.PHONE_DEACTIVATED': 'Ngừng dùng số điện thoại',
  'PERSON.ADDRESS_ADDED': 'Thêm địa chỉ',
  'PERSON.ADDRESS_DEACTIVATED': 'Ngừng dùng địa chỉ',
  'PERSON.EDUCATION_ADDED': 'Thêm học vấn',
  'PERSON.EDUCATION_DEACTIVATED': 'Ngừng dùng mục học vấn',
  'PERSON.BANK_ACCOUNT_ADDED': 'Thêm tài khoản ngân hàng',
  'PERSON.BANK_ACCOUNT_DEACTIVATED': 'Ngừng dùng tài khoản ngân hàng',
  'CUSTOMER.CREATED': 'Tạo khách hàng',
  'FAMILY_RELATION.CREATED': 'Khai quan hệ nhân thân',
  'FAMILY_RELATION.ENDED': 'Chấm dứt quan hệ nhân thân',

  // Xem dữ liệu nhạy cảm — đây là loại dòng người rà soát tìm đến trước nhất
  'PII.NATIONAL_ID_VIEWED': 'Xem CCCD đầy đủ',
  'DOCUMENT.DOWNLOADED': 'Tải giấy tờ',

  // Mộ & hợp đồng
  'GRAVE.ALLOCATED': 'Phân bổ phần mộ',
  'GRAVE.HOLD_EXPIRED': 'Hết hạn giữ chỗ',
  'GRAVE_PLOT.POSITION_SET': 'Đặt toạ độ sơ đồ',
  'GRAVE_PLOT.CAPACITY_SET': 'Sửa số cốt phần mộ',
  'GRAVE_TYPE.CAPACITY_SET': 'Sửa số cốt loại mộ',

  // Thẻ nhãn — thẻ KHÁCH tách riêng khỏi thẻ MỘ ở đây cũng như ở mọi tầng khác, vì
  // "ai đã gắn nhãn này lên một con người" là câu người rà soát tìm tới, không phải
  // một dòng lẫn trong đống thao tác trên vật.
  'PLOT_TAG_TYPE.CREATED': 'Mở thẻ nhãn phần mộ',
  'PLOT_TAG_TYPE.UPDATED': 'Sửa thẻ nhãn phần mộ',
  'PLOT_TAG.ASSIGNED': 'Gắn thẻ cho phần mộ',
  'PLOT_TAG.REMOVED': 'Gỡ thẻ khỏi phần mộ',
  'CUSTOMER_TAG_TYPE.CREATED': 'Mở thẻ nhãn khách hàng',
  'CUSTOMER_TAG_TYPE.UPDATED': 'Sửa thẻ nhãn khách hàng',
  'CUSTOMER_TAG.ASSIGNED': 'Gắn thẻ cho khách hàng',
  'CUSTOMER_TAG.REMOVED': 'Gỡ thẻ khỏi khách hàng',
  'CONTRACT.CREATED': 'Soạn hợp đồng',
  'CONTRACT.VERIFIED': 'Thẩm định hợp đồng',
  'CONTRACT.ACTIVATED': 'Cho hợp đồng hiệu lực',

  // An táng
  'BURIAL.CREATED': 'Soạn hồ sơ an táng',
  'BURIAL.VERIFIED': 'Thẩm định hồ sơ an táng',
  'BURIAL.COMPLETED': 'Hoàn tất an táng',
  'BURIAL.CANCELLED': 'Huỷ hồ sơ an táng',

  // Thẻ mộ
  'GRAVE_CARD.ISSUED': 'Cấp thẻ quản lý mộ',
  'GRAVE_CARD.REPRINTED': 'In lại thẻ quản lý mộ',

  // Dịch vụ
  'SERVICE.SUBSCRIBED': 'Đăng ký dịch vụ',
  'SERVICE.RENEWED': 'Gia hạn dịch vụ',
  'SERVICE.CANCELLED': 'Huỷ dịch vụ',

  // Phân quyền
  'AUTHZ.ROLE_ASSIGNED': 'Gán vai cho người dùng',
  'AUTHZ.ROLE_REVOKED': 'Thu hồi vai',
  'AUTHZ.PERMISSION_GRANTED': 'Cấp quyền cho vai',
  'AUTHZ.PERMISSION_REVOKED': 'Thu hồi quyền của vai',
  'AUTHZ.SCOPE_ASSIGNED': 'Gán phạm vi nghĩa trang',
  'AUTHZ.SCOPE_REVOKED': 'Thu hồi phạm vi nghĩa trang',
  'AUTHZ.RULE_CREATED': 'Thêm luật truy cập',
  'AUTHZ.RULE_REORDERED': 'Đổi thứ tự luật truy cập',
  'AUTHZ.RULE_REVOKED': 'Thu hồi luật truy cập',

  // Bị từ chối
  'FILE.DOWNLOAD_DENIED': 'Bị từ chối tải tệp',
  'FILE.CONFIRM_DENIED': 'Bị từ chối xác nhận tệp',
};

export function actionLabel(code: string): string {
  return ACTION[code] ?? code;
}

/* Ba nhóm hành động cần NHÌN là thấy, không phải đọc mới thấy:
 *  - bị từ chối: dấu hiệu ai đó chạm vào thứ không thuộc phần mình
 *  - xem dữ liệu nhạy cảm: NĐ13 đòi biết ai đã xem CCCD, lúc nào
 *  - cho hiệu lực / cấp quyền: hành vi sinh hệ quả thật, khó đảo ngược
 */
export function actionVariant(code: string): Variant {
  if (/_DENIED$/.test(code)) return 'destructive';
  if (code.startsWith('PII.') || code === 'DOCUMENT.DOWNLOADED') return 'warning';
  if (/\.(ACTIVATED|COMPLETED|ISSUED)$/.test(code) || code.startsWith('AUTHZ.')) return 'info';
  return 'neutral';
}

const RESULT: Record<string, { label: string; variant: Variant }> = {
  SUCCESS: { label: 'Thành công', variant: 'success' },
  DENIED: { label: 'Bị từ chối', variant: 'destructive' },
};

export function resultLabel(code: string): { label: string; variant: Variant } {
  return RESULT[code] ?? { label: code, variant: 'neutral' };
}

const ACTOR_TYPE: Record<string, string> = {
  USER: 'Người dùng',
  SYSTEM: 'Hệ thống',
  WORKER: 'Tiến trình nền',
};

export function actorTypeLabel(code: string): string {
  return ACTOR_TYPE[code] ?? code;
}

/* Thời điểm hiện theo MÚI GIỜ MÁY đang xem, định dạng dd/MM/yyyy HH:mm:ss.
 *
 * Trước đây trang in thẳng chuỗi ISO theo UTC, nên một việc làm lúc 13h chiều hiện thành
 * 06h sáng — người đọc phải tự cộng 7 tiếng, và sẽ có lần cộng sai. Server vẫn lưu
 * `timestamptz` (mốc thời gian tuyệt đối); chỉ CÁCH HIỆN đổi.
 *
 * Vẫn trả kèm chuỗi ISO đầy đủ để gắn vào `title`: khi đối chiếu với log máy chủ thì cần
 * đúng mốc tuyệt đối, không cần giờ địa phương.
 */
export function formatAuditTime(iso: string): { display: string; iso: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { display: iso, iso };
  }
  const two = (n: number) => String(n).padStart(2, '0');
  const display =
    `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return { display, iso: d.toISOString() };
}

/* Ô chọn ngày trả về `yyyy-MM-dd` — KHÔNG có giờ, KHÔNG có múi giờ.
 *
 * Gửi thẳng chuỗi đó lên server là sai một cách âm thầm: `new Date('2026-08-26')` được
 * hiểu là nửa đêm UTC, tức 07:00 sáng giờ Việt Nam. Nên "từ ngày 26/08" sẽ bỏ mất mọi
 * việc làm từ 0h đến 7h sáng hôm đó, và "đến ngày 26/08" sẽ cắt mất gần cả ngày.
 *
 * Hai hàm dưới đây quy ngày người dùng chọn về đúng đầu/cuối ngày THEO GIỜ MÁY, rồi đổi
 * sang ISO. Trình duyệt là chỗ duy nhất biết múi giờ của người đang xem, nên phép quy đổi
 * này phải làm ở đây chứ không ở server.
 */
export function startOfDayIso(date: string): string | undefined {
  if (date === '') return undefined;
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return undefined;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function endOfDayIso(date: string): string | undefined {
  if (date === '') return undefined;
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return undefined;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
