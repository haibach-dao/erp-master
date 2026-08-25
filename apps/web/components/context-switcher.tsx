import { Building2 } from 'lucide-react';

// Placeholder cho context-switcher (user + vai trò/chức danh + phòng ban + scope).
// Logic chọn ngữ cảnh sẽ làm khi có IAM/RBAC/Context (giai đoạn P1 sau khi chốt Gate 0).
// Cho tới lúc đó nó chỉ là một ô chờ, nên để viền đứt và chữ mờ — đừng trông như
// một nút bấm được mà bấm không ra gì.
export function ContextSwitcher() {
  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
      <Building2 className="size-3.5" aria-hidden />
      Ngữ cảnh: chưa chọn
    </div>
  );
}
