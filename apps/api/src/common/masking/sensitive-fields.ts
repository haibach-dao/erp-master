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
  /* Mở bằng `view_contact` (S2), KHÔNG phải `view_sensitive` (S3).
   *
   * Hai mã tách nhau vì hai rủi ro khác nhau: người bán cần gọi được cho khách hàng, còn
   * CCCD thì họ không cần. Gộp lại thì "cho xem số điện thoại" đồng nghĩa "cho xem CCCD
   * đầy đủ" — leo thang do thiết kế mã, không do ai quyết định. */
  { field: 'phone', permission: 'crm.person.view_contact' },
  { field: 'email', permission: 'crm.person.view_contact' },
  // Ngày sinh/ngày mất che thành NĂM: đủ để đối chiếu hồ sơ, không đủ để định danh.
  { field: 'dateOfBirth', permission: 'crm.person.view_contact', strategy: 'year' },
  { field: 'dateOfDeath', permission: 'crm.person.view_contact', strategy: 'year' },
  { field: 'address', permission: 'crm.person.view_contact' },
  { field: 'permanentAddress', permission: 'crm.person.view_contact' },
  { field: 'contactAddress', permission: 'crm.person.view_contact' },
  /* Dân tộc và tôn giáo: NĐ 13/2023 Điều 2.4 xếp vào dữ liệu cá nhân NHẠY CẢM, cùng nhóm
   * với CCCD chứ không phải nhóm liên lạc — nên mở bằng `view_sensitive` (S3), KHÔNG phải
   * `view_contact` (S2). Người bán cần gọi được cho khách; họ không cần biết khách theo
   * đạo gì. */
  { field: 'ethnicity', permission: 'crm.person.view_sensitive' },
  { field: 'religion', permission: 'crm.person.view_sensitive' },
  /* Nơi/ngày cấp CCCD đi liền với số CCCD nên cùng mức S3. Ngày cấp che thành NĂM: đủ để
   * đối chiếu giấy tờ còn hạn hay không, không đủ để dò ra số. */
  { field: 'nationalIdIssuedOn', permission: 'crm.person.view_sensitive', strategy: 'year' },
  { field: 'nationalIdIssuedPlace', permission: 'crm.person.view_sensitive' },
  /* Số tài khoản: mã RIÊNG, không dùng chung `view_sensitive`. CCCD lộ ra là rủi ro định
   * danh; số tài khoản lộ ra là rủi ro tài chính. Ai cần cái thứ nhất để làm thủ tục tang
   * lễ thì không vì thế mà cần cái thứ hai. */
  { field: 'accountNumber', permission: 'crm.person.view_financial' },
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
  // Mã ngân hàng (VCB, BIDV...) là danh mục công khai. Che nó không giấu được gì, mà số
  // tài khoản — thứ thật sự nhạy cảm — đã có luật che riêng bằng `view_financial`.
  bankCode: 'Mã ngân hàng là danh mục công khai; số tài khoản mới là thứ được che',
  /* Ba tên dưới đây là TÊN QUAN HỆ (mảng con của Person), không phải cột dữ liệu. Che
   * chúng là xoá trắng cả mảng — sai chỗ: thứ nhạy cảm nằm ở LÁ bên trong (`phone`,
   * `address`, `accountNumber`), và mỗi lá đã có luật che riêng, áp đệ quy qua maskTree.
   * Ratchet bắt được chúng vì nó khớp theo tên chứ không phân biệt cột với quan hệ — đó
   * là cảnh báo thừa đúng như thiết kế, thà thừa hơn sót. */
  phones: 'Tên quan hệ PersonPhone[]; lá `phone` bên trong mới là thứ được che',
  addresses: 'Tên quan hệ PersonAddress[]; lá `address` bên trong mới là thứ được che',
  bankAccounts: 'Tên quan hệ PersonBankAccount[]; lá `accountNumber` bên trong mới là thứ được che',
  accountHolder: 'Tên chủ tài khoản — là TÊN NGƯỜI, cùng lý do với fullName: gate bằng quyền route',
};

/* Tên trường nghi vấn — dùng cho test quét schema. Thà cảnh báo thừa hơn bỏ sót.
 *
 * Nhóm thứ hai (dân tộc/tôn giáo/ngân hàng/sức khoẻ/sinh trắc…) được thêm 2026-08-26.
 * Trước đó ratchet KHÔNG bắt chúng: NĐ 13/2023 Điều 2.4 liệt kê chúng là dữ liệu nhạy
 * cảm, nhưng vì hệ chưa có cột nào tên như vậy nên không ai để ý là tấm lưới có lỗ. Nếu
 * sau này nhập dữ liệu nhân sự từ hệ cũ (`dan_toc`, `ton_giao`, `ProfileBankAccounts`),
 * cột mới sẽ lọt thẳng ra API mà build vẫn xanh. Vá trước khi cần, không vá sau khi lộ.
 */
export const SUSPICIOUS_FIELD_PATTERN =
  /(phone|email|address|dateOfBirth|dateOfDeath|nationalId|fullName|orgName|gender|notes|cccd|cmnd|ngaySinh|soCccd|religion|ethnic|race|bank|account(?:Number|No)|health|medical|disability|blood|biometric|fingerprint|marital|placeOfBirth|criminal|politic|union|sexual|danToc|tonGiao|soTaiKhoan)/i;
