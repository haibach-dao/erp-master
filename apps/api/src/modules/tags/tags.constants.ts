/* RANH GIỚI ĐẠO ĐỨC — hai lớp, và lớp thứ nhất KHÔNG nằm trong file này.
 *
 * Anh Bách chốt 03/09/2026: HAI danh mục tách riêng (thẻ mộ, thẻ khách), cả hai TOÀN HỆ.
 *
 * Lớp một là CẤU TRÚC: hai bảng danh mục, hai khoá ngoại. Một thẻ khách không thể gắn lên
 * mộ vì `grave_plot_tags.tag_type_id` chỉ trỏ được vào `grave_plot_tag_types` — không phải
 * vì có một cột kiểm đúng hay một câu `if` ai đó có thể sửa. Đã đo bằng psql.
 *
 * Lớp hai là danh sách dưới đây, và nó CHỈ áp cho thẻ KHÁCH: mỗi thẻ phải khai nó nói về
 * HỒ SƠ hay GIAO DỊCH.
 *
 *   HO_SO     — một THIẾU SÓT CỦA BẢN GHI. "thiếu CCCD", "thiếu giấy chứng tử", "thiếu file
 *               hợp đồng". Sửa xong thì gỡ thẻ. Kiểm chứng được bằng dữ liệu trong hệ.
 *   GIAO_DICH — một SỰ KIỆN ĐÃ XẢY RA. "mua trước chưa an táng", "đứng tên 3 mộ". Cũng kiểm
 *               chứng được, cũng có thể thôi đúng.
 *
 * Một thẻ kiểu "khách khó tính", "khả năng chi trả thấp", "sức khoẻ yếu" KHÔNG CÓ GIÁ TRỊ
 * NÀO ĐỂ KHAI — nó gán một PHẨM CHẤT cho người: không ngày kết thúc, không ai xác minh,
 * không ai gỡ. Nó chết ở CHECK trong migration, không chết ở chỗ người ta nhắc nhau.
 *
 * Thêm nữa: tôn giáo, dân tộc, sức khoẻ là dữ liệu cá nhân NHẠY CẢM theo NĐ 13/2023, và hệ
 * đã che ba trường đó ở mức S3. Một bảng thẻ tự do sẽ là cửa sau vòng qua đúng lớp che ấy.
 *
 * THƯỚC ĐO cho mọi thẻ khách: phải chịu được việc ĐỌC TO TRƯỚC MẶT CHÍNH KHÁCH. Ai muốn
 * thêm giá trị thứ ba vào danh sách này phải trả lời được câu đó trước.
 *
 * Danh mục thẻ MỘ cố ý KHÔNG có cột tương ứng: thẻ mộ nói về một VẬT, và "bia nứt" không
 * thể trở thành một nhận định về ai.
 */
export const CUSTOMER_TAG_SUBJECTS = ['HO_SO', 'GIAO_DICH'] as const;
export type CustomerTagSubject = (typeof CUSTOMER_TAG_SUBJECTS)[number];

export const CUSTOMER_TAG_SUBJECT_LABEL: Record<CustomerTagSubject, string> = {
  HO_SO: 'Hồ sơ, giấy tờ',
  GIAO_DICH: 'Giao dịch đã xảy ra',
};

/* Vòng đời một dòng danh mục. `Retired` là NGỪNG DÙNG, không phải xoá: thẻ đã gắn vẫn phải
 * đọc được tên. Ngừng dùng nghĩa là không gắn MỚI được nữa. */
export const TAG_TYPE_STATUSES = ['Active', 'Retired'] as const;
export type TagTypeStatus = (typeof TAG_TYPE_STATUSES)[number];
