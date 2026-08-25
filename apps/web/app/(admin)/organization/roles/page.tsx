'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  grantPermission,
  listPermissionCatalog,
  listRoles,
  revokePermission,
  type RoleRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

const SCOPES = ['GROUP', 'COMPANY', 'SITE', 'SELF'];

/* Ma trận vai × quyền — sửa được ngay trên màn hình.
 *
 * Danh mục mã quyền là ĐÓNG: ô chọn chỉ liệt kê mã đã có trong danh mục, và máy chủ từ
 * chối mã lạ. Nếu không, màn hình này thành nơi phát minh ra quyền mà chưa ai rà.
 *
 * Sửa ở đây có hiệu lực NGAY — không cache, không chờ tiến trình định kỳ. Đổi lại, mọi
 * thao tác đều vào nhật ký kiểm toán kèm giá trị trước/sau.
 */
export default function RoleMatrixPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('');
  const [newCode, setNewCode] = useState('');
  const [newScope, setNewScope] = useState('COMPANY');

  const canView = can(user, 'authz.role.view');
  const canGrant = can(user, 'authz.role_permission.grant');
  const canRevoke = can(user, 'authz.role_permission.revoke');

  const roles = useQuery({ queryKey: ['authz-roles'], queryFn: listRoles, enabled: canView });
  const catalog = useQuery({
    queryKey: ['authz-catalog'],
    queryFn: listPermissionCatalog,
    enabled: canView && can(user, 'authz.permission.view'),
  });

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['authz-roles'] });
  const mGrant = useMutation({
    mutationFn: () => grantPermission(selected, newCode, newScope),
    onSuccess: async () => {
      setNewCode('');
      await refresh();
    },
  });
  const mRevoke = useMutation({
    mutationFn: (code: string) => revokePermission(selected, code),
    onSuccess: refresh,
  });

  const role: RoleRow | undefined = roles.data?.find((r) => r.code === selected);
  const available = useMemo(() => {
    const held = new Set(role?.grants.map((g) => g.code) ?? []);
    return (catalog.data ?? []).filter((p) => !held.has(p.code));
  }, [catalog.data, role]);

  if (!canView) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Ma trận vai × quyền</h1>
        <p className="text-sm text-muted-foreground">
          Bạn không có quyền <code>authz.role.view</code>.
        </p>
      </section>
    );
  }

  const err = mGrant.error ?? mRevoke.error ?? roles.error;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Ma trận vai × quyền</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sửa ở đây có hiệu lực ngay và được ghi vào nhật ký kiểm toán kèm giá trị trước/sau.
        </p>
      </div>

      {err !== null && err !== undefined && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(err as Error).message}
        </p>
      )}

      <label className="text-sm">
        Vai{' '}
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— chọn vai —</option>
          {roles.data?.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} · {r.name} ({r.grants.length} mã)
            </option>
          ))}
        </select>
      </label>

      {role !== undefined && (
        <>
          {role.description !== null && (
            <p className="text-sm text-muted-foreground">{role.description}</p>
          )}

          {canGrant && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <label className="text-sm">
                Thêm mã quyền{' '}
                <select
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                >
                  <option value="">— chọn mã —</option>
                  {available.map((p) => (
                    <option key={p.code} value={p.code}>
                      [{p.sensitivity}] {p.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Phạm vi{' '}
                <select
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={() => mGrant.mutate()} disabled={newCode === '' || mGrant.isPending}>
                Cấp
              </Button>
            </div>
          )}

          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2">Mức</th>
                <th className="p-2">Mã quyền</th>
                <th className="p-2">Phạm vi</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {role.grants.map((g) => (
                <tr key={g.code} className="border-t border-border">
                  {/* S3 = dữ liệu cá nhân, hành vi bất khả hồi, bỏ mặt nạ. Hiện mức ra để
                      người rà thấy ngay mình đang cấp thứ gì. */}
                  <td className="p-2 font-mono text-xs">{g.sensitivity}</td>
                  <td className="p-2 font-mono text-xs">{g.code}</td>
                  <td className="p-2">{g.scope}</td>
                  <td className="p-2">
                    {canRevoke && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => mRevoke.mutate(g.code)}
                        disabled={mRevoke.isPending}
                      >
                        Thu
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
