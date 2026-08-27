import type { Request } from 'express';

/* AI đang gọi, và BẰNG MÃ QUYỀN NÀO.
 *
 * Hai mảnh phải đi cùng nhau. Chỉ có `userId` là chỉ trả lời được "người này giữ mức phạm
 * vi rộng nhất bao nhiêu ở bất cứ đâu" — câu trả lời rộng hơn sự thật khi một người giữ
 * nhiều vai ở nhiều mức. Có thêm mã quyền thì hỏi được đúng câu cần hỏi: "riêng mã NÀY,
 * người này với tới đâu".
 *
 * `permission` KHÔNG gõ tay ở controller: nó đến từ `req.requiredPermission` mà
 * `PermissionGuard` vừa đặt, nên mã dùng để kiểm phạm vi CHẮC CHẮN là mã guard vừa thi
 * hành. Gõ tay là mở đường cho `@RequirePermission('burial.record.cancel')` ở decorator mà
 * service lại kiểm phạm vi theo `'burial.record.verify'` — hai chuỗi lệch nhau, không có
 * gì đỏ, và phạm vi bị tính theo một mã khác hẳn mã đang thực sự chạy.
 */
export interface Caller {
  /** `users.id`, hoặc `null` khi request chưa xác thực. */
  userId: string | null;
  /** Mã quyền route đang thi hành, hoặc `null` khi route không đi qua guard (`@Public`). */
  permission: string | null;
}

/** Dựng `Caller` từ request. Dùng ở controller, ngay chỗ trước đây chỉ lấy `userId`. */
export function callerOf(req: Request): Caller {
  return {
    userId: req.user?.userId ?? null,
    permission: req.requiredPermission ?? null,
  };
}
