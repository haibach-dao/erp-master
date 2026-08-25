import type { MaskRule } from './mask.decorator';

/* Sổ trường nhạy cảm — áp cho MỌI response, không cần route nhớ khai.
 *
 * Đây là chỗ sửa khiếm khuyết lớn nhất của cách mask cũ: trước đây chỉ những trường được
 * khai tường minh bằng `@MaskUnless` mới bị che, nên mỗi trường nhạy cảm THÊM VÀO SAU
 * mặc định LỌT RA. Người thêm cột `phone` vào một model mới không có lý do gì để biết
 * rằng mình vừa phải đi sửa một interceptor ở chỗ khác.
 *
 * Đảo mặc định: tên trường nằm trong sổ này thì bị che ở khắp nơi, trừ khi người gọi cầm
 * mã mở khoá. Route nào trả trường đó một cách chính đáng thì phải nói ra bằng
 * `@RevealFields` — và nói ra là một quyết định đọc được trong code review.
 *
 * GIỚI HẠN PHẢI BIẾT: sổ này khớp theo TÊN TRƯỜNG. `email` của một Person là dữ liệu cá
 * nhân; `email` của chính người đang đăng nhập là dữ liệu của họ. Cùng một tên, hai nghĩa
 * — nên `@RevealFields` tồn tại, và `/auth/me` là ví dụ đầu tiên dùng nó. Đây là điểm yếu
 * cố hữu của việc khớp theo tên, không phải một lỗi bỏ sót.
 */
export const SENSITIVE_FIELDS: readonly MaskRule[] = [
  // NĐ13 rộng hơn G0-A6: A6 là mức tối thiểu, không phải giới hạn.
  { field: 'phone', permission: 'crm.person.view_sensitive' },
  { field: 'email', permission: 'crm.person.view_sensitive' },
  // Ngày sinh/ngày mất che thành NĂM: đủ để đối chiếu hồ sơ, không đủ để định danh.
  { field: 'dateOfBirth', permission: 'crm.person.view_sensitive', strategy: 'year' },
  { field: 'dateOfDeath', permission: 'crm.person.view_sensitive', strategy: 'year' },
  { field: 'address', permission: 'crm.person.view_sensitive' },
  /* Địa chỉ IP là dữ liệu cá nhân theo NĐ13, và audit event nào cũng có một cái. Mở khoá
   * bằng cùng mã mở khoá ảnh chụp before/after — người đọc được nội dung thay đổi thì cũng
   * là người cần biết nó đến từ đâu; người chỉ xem nhật ký ở mức thường thì không cần
   * theo dấu ai ngồi ở IP nào.
   *
   * Cột này do TEST QUÉT SCHEMA tìm ra, không phải do tôi nghĩ tới — đúng lý do cái
   * ratchet đó tồn tại. */
  { field: 'ipAddress', permission: 'audit.event.view_sensitive' },
];

/* Tên trường mà một cột MỚI có thể mang mà vẫn không phải dữ liệu cá nhân.
 *
 * Dùng bởi test bất biến quét `schema.prisma`: cột nào có tên nghi vấn mà KHÔNG nằm trong
 * sổ trên và KHÔNG nằm ở đây thì test đỏ. Đó là cái ratchet — thêm một cột nhạy cảm mà
 * không quyết định gì về nó thì gãy build, chứ không lặng lẽ lọt ra API.
 */
export const REVIEWED_NON_SENSITIVE: Readonly<Record<string, string>> = {
  // Tên người: cần cho MỌI màn hình nghiệp vụ; che nó thì hệ không dùng được. Bảo vệ
  // bằng quyền ở tầng route (`crm.person.view`) chứ không bằng mask.
  fullName: 'Tên là dữ liệu tác nghiệp cốt lõi — gate bằng quyền route, không mask',
  orgName: 'Tên tổ chức, không phải dữ liệu cá nhân',
  // Đã là giá trị đã che sẵn (079***123). Che lần nữa là xoá luôn công dụng của nó.
  nationalIdMasked: 'Vốn đã là bản đã che — dùng để đối chiếu trên màn hình',
  gender: 'Không đủ để định danh; cần cho nghiệp vụ an táng',
  notes: 'Ghi chú nghiệp vụ. RỦI RO ĐÃ BIẾT: người dùng có thể gõ dữ liệu cá nhân vào đây',
  genderSpecific:
    'Cờ boolean trên loại quan hệ nhân thân (Cha/Mẹ có phân biệt giới). Không phải dữ liệu của ai',
};

/** Tên trường nghi vấn — dùng cho test quét schema. Thà cảnh báo thừa hơn bỏ sót. */
export const SUSPICIOUS_FIELD_PATTERN =
  /(phone|email|address|dateOfBirth|dateOfDeath|nationalId|fullName|orgName|gender|notes|cccd|cmnd|ngaySinh|soCccd)/i;
