// Augment Express Request with per-request correlation id and authenticated user.
import 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: { userId: string; email: string; sid: string };
      /* Mã quyền mà PermissionGuard vừa thi hành cho route này.
       *
       * Guard đặt vào, tầng dưới ĐỌC RA — không ai gõ lại chuỗi mã lần thứ hai. Kiểm phạm
       * vi phải chạy trên ĐÚNG mã mà guard đã kiểm; gõ lại ở service là mở đường cho hai
       * chuỗi lệch nhau, và khi lệch thì phạm vi được tính theo một mã KHÁC với mã đang
       * thực sự được thi hành — sai lặng lẽ, không có gì đỏ.
       *
       * `undefined` khi route là `@Public()` (guard không chạy tới đoạn đặt). Nơi nào cần
       * mã này thì phải TỪ CHỐI khi thiếu, không được đoán. */
      requiredPermission?: string;
    }
  }
}

export {};
