'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignRole,
  listRoleAssignments,
  listRoles,
  revokeRoleAssignment,
  type RoleAssignmentRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { CompanyPicker } from '@/components/company-picker';

/* Gán vai cho người — trục "được làm gì".
 *
 * Ba điều màn hình này cố ý làm khó hơn mức tối thiểu:
 *  - LÝ DO là bắt buộc. "Vì sao người này giữ vai này" là đúng câu mà nhật ký phải trả
 *    lời được, và không ai nhớ ra sau sáu tháng.
 *  - HẠN dùng được. Quyền tự rụng thì không phụ thuộc vào việc có ai nhớ đi thu hồi.
 *  - Thu hồi là ĐÓNG HIỆU LỰC, không xoá dòng — việc từng giữ vai cũng là một sự thật
 *    cần giữ lại.
 */
export default function RoleAssignmentPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [targetUserId, setTargetUserId] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [validTo, setValidTo] = useState('');
  const [reason, setReason] = useState('');

  const canView = can(user, 'authz.role.view');
  const canAssign = can(user, 'authz.role_assignment.assign');
  const canRevoke = can(user, 'authz.role_assignment.revoke');

  const roles = useQuery({ queryKey: ['authz-roles'], queryFn: listRoles, enabled: canView });
  const assignments = useQuery({
    queryKey: ['authz-assignments', targetUserId],
    queryFn: () => listRoleAssignments(targetUserId),
    enabled: canView && targetUserId !== '',
  });

  const refresh = (): Promise<void> =>
    qc.invalidateQueries({ queryKey: ['authz-assignments', targetUserId] });

  const mAssign = useMutation({
    mutationFn: () =>
      assignRole({
        userId: targetUserId,
        roleCode,
        ...(companyId === '' ? {} : { companyId }),
        ...(validTo === '' ? {} : { validTo: new Date(validTo).toISOString() }),
        reason,
      }),
    onSuccess: async () => {
      setReason('');
      setValidTo('');
      await refresh();
    },
  });

  const mRevoke = useMutation({
    mutationFn: (row: RoleAssignmentRow) => revokeRoleAssignment(row.id),
    onSuccess: refresh,
  });

  if (!canView) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Gán vai</h1>
        <p className="text-sm text-muted-foreground">
          Bạn không có quyền <code>authz.role.view</code>.
        </p>
      </section>
    );
  }

  const rows = assignments.data ?? [];
  const active = rows.filter((r) => r.validTo === null || new Date(r.validTo) > new Date());
  const ended = rows.filter((r) => !active.includes(r));
  const err = mAssign.error ?? mRevoke.error ?? assignments.error;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Gán vai cho người dùng</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nhiều vai thì quyền CỘNG DỒN. Phạm vi dữ liệu là trục riêng — gán ở màn hình &ldquo;Gán
          phạm vi&rdquo;.
        </p>
      </div>

      {err !== null && err !== undefined && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(err as Error).message}
        </p>
      )}

      <label className="text-sm">
        Người dùng (id){' '}
        <input
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          placeholder="ULID của người dùng"
        />
      </label>

      {canAssign && targetUserId !== '' && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="text-sm">
            Vai{' '}
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
            >
              <option value="">— chọn vai —</option>
              {roles.data?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} · {r.name}
                </option>
              ))}
            </select>
          </label>
          <CompanyPicker value={companyId} onChange={setCompanyId} />
          <label className="text-sm">
            Hết hạn (tuỳ chọn){' '}
            <input
              type="date"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Lý do{' '}
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="bắt buộc"
            />
          </label>
          <Button
            onClick={() => mAssign.mutate()}
            disabled={roleCode === '' || reason.trim() === '' || mAssign.isPending}
          >
            Gán vai
          </Button>
        </div>
      )}

      {targetUserId === '' ? (
        <p className="text-sm text-muted-foreground">Nhập id người dùng để xem vai hiện tại.</p>
      ) : (
        <>
          <h2 className="text-sm font-medium">Đang giữ ({active.length})</h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa giữ vai nào — người dùng này không làm được gì trong hệ.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-2">Vai</th>
                  <th className="p-2">Công ty</th>
                  <th className="p-2">Hết hạn</th>
                  <th className="p-2">Lý do</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2">
                      {r.roleCode} · {r.roleName}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.companyId ?? 'mọi công ty'}</td>
                    <td className="p-2">{r.validTo?.slice(0, 10) ?? 'vô thời hạn'}</td>
                    <td className="p-2 text-muted-foreground">{r.grantReason ?? '—'}</td>
                    <td className="p-2">
                      {canRevoke && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => mRevoke.mutate(r)}
                          disabled={mRevoke.isPending}
                        >
                          Thu hồi
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {ended.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                Đã hết hiệu lực ({ended.length})
              </h2>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {ended.map((r) => (
                  <li key={r.id}>
                    {r.roleCode} — hết hiệu lực {r.validTo?.slice(0, 10)}
                    {r.grantReason === null ? '' : ` · ${r.grantReason}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
