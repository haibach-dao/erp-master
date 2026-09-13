import { grantInForce } from '../../src/common/lifecycle/active';

/* MỒI CỦA LƯỚI — file này CỐ Ý chép tay cửa sổ hiệu lực. Đừng "sửa cho đúng".
 *
 * VÌ SAO TỒN TẠI: phép tự kiểm của `grant-window-invariants.spec.ts` phải chứng minh bộ quét
 * còn ĐỌC ĐƯỢC mã và còn BẮT ĐƯỢC — nhưng nếu nó neo vào NỢ THẬT (`toBeGreaterThan(0)` trên
 * số bản chép tay còn sót) thì nó sẽ đỏ đúng vào ngày trả xong nợ, và câu chẩn đoán lại nói
 * sai hẳn ("nhiều khả năng bộ quét hỏng") giữa lúc mọi thứ vừa tốt lên. Một phép kiểm phạt
 * người dọn dẹp là một phép kiểm dạy người ta đừng dọn.
 *
 * Nên neo vào đây: mấy con mồi dưới KHÔNG BAO GIỜ được chữa, nên phép tự kiểm không bao giờ
 * phải sửa vì lý do nào khác ngoài chính bộ quét hỏng.
 *
 * AN TOÀN: `apps/api/test/` không nằm trong gốc quét thật (`apps/api/src`, `apps/api/scripts`,
 * `apps/worker/src`), và không mã chạy thật nào import file này.
 *
 * Mỗi con mồi là một hình dạng ĐÃ TỪNG LỌT hoặc đã từng đau, không phải mồi bịa cho đủ số.
 */

/* MỒI 1 — mảnh `where` chép tay, gõ trên MỘT dòng. Hình dạng gốc, sáu bản ở `apps/api` và
 * bản thứ bảy ở `apps/worker/src/agent-identity.ts` đều là nó. */
export function baitSingleLine(now: Date) {
  /* `prettier-ignore` là BẮT BUỘC ở đây, không phải tránh việc dọn định dạng: dòng dưới dài
   * quá hạn nên `pnpm format:check` ĐỎ, mà bản prettier tự sửa lại BẺ nó xuống nhiều dòng —
   * tức xoá đúng cái tính chất "gõ trên MỘT dòng" mà con mồi này sinh ra để giữ. Số mồi không
   * đổi nên test vẫn xanh: một cái neo hỏng mà không ai biết. Đây là chỗ duy nhất trong repo
   * mà hình dạng của mã CHÍNH LÀ nội dung phép kiểm, nên nó phải đứng ngoài prettier. */
  // prettier-ignore
  return { userId: 'u', validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
}

/* MỒI 2 — CÙNG mảnh đó, chỉ khác là XUỐNG DÒNG, và mang luôn biên SAI (`gte`).
 *
 * Đây là con mồi đắt nhất. Lưới bản đầu soi từng dòng một nên hình dạng này lọt SẠCH, kể cả
 * cái `gte` — mà `gte` chính là lỗi đã trả giá thật. Prettier sinh ra đúng hình này mỗi khi
 * dòng dài quá, nên nó không phải trường hợp hiếm mà là trường hợp THƯỜNG. */
export function baitMultiLine(now: Date) {
  return {
    validFrom: {
      lte: now,
    },
    OR: [
      { validTo: null },
      {
        validTo: {
          gte: now,
        },
      },
    ],
  };
}

/* MỒI 3 — vị từ trên bản ghi đã đọc về, dạng CÓ dấu chấm (`grantInForceAt` chép tay). */
export function baitPredicateDotted(row: { validFrom: Date; validTo: Date | null }, now: Date) {
  return row.validFrom <= now && (row.validTo === null || row.validTo > now);
}

/* MỒI 4 — cùng vị từ đó nhưng đã PHÁ CẤU TRÚC, nên không còn dấu chấm nào. Lưới bản đầu bắt
 * buộc có `\.` trước tên cột nên hình này lọt. */
export function baitPredicateDestructured(
  row: { validFrom: Date; validTo: Date | null },
  now: Date,
) {
  const { validFrom, validTo } = row;
  return validFrom <= now && (validTo === null || validTo > now);
}

/* MỒI 5 — dùng ĐÚNG hàm chung nhưng TRẢI vào object ĐÃ CÓ khoá `OR` riêng: khoá sau đè khoá
 * trước, mất im lặng một nửa điều kiện. */
export function baitSpreadCollision(now: Date, userId: string) {
  return {
    OR: [{ subjectUserId: userId }, { subjectUserId: null }],
    ...grantInForce(now),
  };
}

/* ĐỐI CHỨNG 1 — cách viết ĐÚNG khi đã có `OR` riêng. Lưới báo chỗ này là lưới phiền, và lưới
 * phiền thì người ta tắt. */
export function controlCorrectAnd(now: Date, userId: string) {
  return {
    OR: [{ subjectUserId: userId }, { subjectUserId: null }],
    AND: [grantInForce(now)],
  };
}

/* ĐỐI CHỨNG 2 — mảnh nằm trong CHÚ THÍCH: validFrom: { lte: now } và validTo: { gte: now },
 * kèm cả vị từ row.validTo > now. Không dòng nào ở đây được tính là mã. */

/** ĐỐI CHỨNG 3 — mảnh nằm trong CHUỖI. Cũng không được tính là mã. */
export const CONTROL_IN_STRING = 'validFrom: { lte: now } và validTo: { gte: now }';
