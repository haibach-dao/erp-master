'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Hộp thoại nổi — dùng `<dialog>` của trình duyệt, không thêm dependency Radix.
 *
 * Vì sao là hộp thoại chứ không phải một Card mở ra giữa trang: form thêm mới nằm TRONG
 * luồng trang sẽ đẩy danh sách xuống dưới, nên người dùng mất chỗ mình đang đọc và phải
 * cuộn lại sau khi lưu. Hộp thoại giữ nguyên danh sách phía sau.
 *
 * `showModal()` của trình duyệt cho sẵn ba thứ mà bản tự chế hay quên: bẫy tiêu điểm
 * trong hộp thoại, đóng bằng Esc, và nền `::backdrop` chặn tương tác phía sau. Đổi lại
 * phải tự gọi `close()` khi prop `open` chuyển sang false — React không tự làm.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: React.ReactNode;
  footer?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  /* Esc kích hoạt sự kiện `cancel` chứ không phải `close` — chặn mặc định rồi báo lên
   * trên, để trạng thái `open` của cha luôn là nguồn duy nhất. Nếu để trình duyệt tự
   * đóng thì DOM đóng còn state cha vẫn `true`, và lần mở sau sẽ không có hiệu lực. */
  React.useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className={cn(
        'w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
        className,
      )}
      /* Bấm ra nền thì đóng. `<dialog>` coi cả vùng backdrop là chính nó, nên chỉ đóng
       * khi đích của cú bấm ĐÚNG là phần tử dialog — bấm vào nội dung bên trong thì đích
       * là phần tử con và không rơi vào nhánh này. */
      onClick={(e) => {
        if (e.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="space-y-1">
          <h2 id="dialog-title" className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          {description !== undefined ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

      {footer !== undefined ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
