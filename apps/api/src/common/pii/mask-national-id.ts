/* Che một số định danh: giữ 3 đầu, 3 cuối — `079123456789` -> `079***789`.
 *
 * Tách ra khỏi `PiiService` vì có HAI nơi cần đúng một cách che này, và hai nơi tự viết
 * thì sẽ có ngày lệch nhau:
 *  1. `PiiService.mask` — sinh cột `nationalIdMasked` lúc GHI vào database.
 *  2. `MaskingInterceptor` chiến lược `national_id` — che bản rõ trên đường RA API.
 *
 * Lệch nhau ở đây không gây lỗi mà gây nghi ngờ: cùng một người, màn hình danh sách hiện
 * `079***789` còn thẻ mộ hiện `079***123`, và không ai biết bản nào đúng.
 *
 * Chuỗi từ 6 ký tự trở xuống che HẲN: giữ 3 đầu 3 cuối của một chuỗi 6 ký tự là không
 * che gì cả.
 */
export function maskNationalId(value: string): string {
  if (value.length <= 6) {
    return '***';
  }
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
