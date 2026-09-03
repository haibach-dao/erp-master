/* Hai bậc giá của biểu phí cấp thẻ mộ.
 *
 * FIRST_ISSUE là tiền CẤP GIẤY, phẳng — không nhân với số cốt. REPRINT nhân với số cốt của
 * phần mộ. Hai bậc khác nhau về CÁCH TÍNH, không chỉ khác con số, nên chúng phải là hai
 * giá trị đọc được chứ không phải một cờ boolean "có phải lần đầu không".
 */
export const CARD_FEE_KINDS = ['FIRST_ISSUE', 'REPRINT'] as const;
export type CardFeeKind = (typeof CARD_FEE_KINDS)[number];

/* Lý do được MIỄN phí — danh sách ĐÓNG, anh Bách chốt 02/09/2026.
 *
 * Đóng, không phải chuỗi tự do như `printReason`: lý do miễn là thứ quyết định có mất tiền
 * hay không, và một ô cho người ở quầy tự gõ là một ô để gõ chữ cho khỏi mất tiền. Đóng thì
 * còn đếm được — "tháng này miễn bao nhiêu ca vì lỗi công ty" là câu trả lời được.
 *
 * CỐ Ý KHÔNG có "khách làm mất thẻ": anh Bách chốt mất thẻ thì VẪN THU. Ai muốn thêm ca
 * miễn mới thì thêm vào đây, và phải thêm cả vào CHECK ở migration — hai chỗ, có chủ đích,
 * để một lần thêm là một quyết định chứ không phải một dòng gõ vội.
 */
export const CARD_FEE_WAIVE_REASONS = ['COMPANY_FAULT', 'OLD_CARD_RETURNED'] as const;
export type CardFeeWaiveReason = (typeof CARD_FEE_WAIVE_REASONS)[number];

export const CARD_FEE_WAIVE_REASON_LABEL: Record<CardFeeWaiveReason, string> = {
  COMPANY_FAULT: 'Lỗi thuộc về công ty',
  OLD_CARD_RETURNED: 'Khách nộp lại thẻ cũ',
};
