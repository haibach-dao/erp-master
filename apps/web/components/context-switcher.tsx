// Placeholder cho context-switcher (user + vai trò/chức danh + phòng ban + scope).
// Logic chọn ngữ cảnh sẽ làm khi có IAM/RBAC/Context (giai đoạn P1 sau khi chốt Gate 0).
export function ContextSwitcher() {
  return (
    <div className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground">
      Ngữ cảnh: <span className="font-medium text-foreground">Chưa chọn</span>
    </div>
  );
}
