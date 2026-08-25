/* Nhật ký kiểm toán — chuỗi hash toàn vẹn, DÙNG CHUNG giữa API và worker.
 *
 * Vì sao phải là package dùng chung chứ không phải mỗi bên một bản: chuỗi hash móc nối
 * theo (công ty, ngày UTC). Sửa một sự kiện là làm sai hash của MỌI sự kiện sau nó trong
 * cùng phân đoạn — đó là điểm mạnh của nó. Nhưng nó cũng có nghĩa là hai bên ghi vào
 * cùng một chuỗi mà tính hash lệch nhau một chi tiết thì chuỗi GÃY, và gãy theo cách
 * trông y như bị can thiệp. Một hàm, một chỗ, không có bản thứ hai để lệch.
 */
export { type HashableEvent, computeEventHash, stableStringify } from './integrity';
export { maskSensitive, maskValue } from './masking';
export {
  type AuditActorType,
  type AppendAuditInput,
  type AuditWriteClient,
  appendAuditEvent,
  utcDateOnly,
} from './append';
