'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignScope,
  listCemeteries,
  listScopeAssignments,
  revokeScope,
  type ScopeAssignment,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { CompanyPicker } from '@/components/company-picker';

/* Gán phạm vi: ai phụ trách nghĩa trang nào.
 *
 * Đây là trục "ở đâu", tách rời khỏi trục "được làm gì". Giữ vai không tự cho ai phạm vi
 * nào; hai trục phải GIAO nhau thì mới với tới được bản ghi. Một người phụ trách được
 * nhiều nghĩa trang, và một nghĩa trang có nhiều người — nên đây là danh sách, không
 * phải một ô chọn.
 *
 * Màn hình ẩn với người không có quyền chỉ là phép lịch sự; API kiểm lại từng request.
 */
export default function ScopeAssignmentPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [cemeteryId, setCemeteryId] = useState('');

  const allowed = can(user, 'authz.scope.assign');

  const cemeteries = useQuery({
    queryKey: ['cemeteries', companyId],
    queryFn: () => listCemeteries(companyId),
    enabled: companyId !== '',
  });

  const assignments = useQuery({
    queryKey: ['scope-assignments', targetUserId],
    queryFn: () => listScopeAssignments(targetUserId),
    enabled: allowed && targetUserId !== '',
  });

  const invalidate = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: ['scope-assignments', targetUserId] });
  };

  const mAssign = useMutation({
    mutationFn: () => assignScope(targetUserId, cemeteryId),
    onSuccess: async () => {
      setCemeteryId('');
      await invalidate();
    },
  });

  const mRevoke = useMutation({
    mutationFn: (row: ScopeAssignment) => revokeScope(targetUserId, row.cemeteryId),
    onSuccess: invalidate,
  });

  if (!allowed) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Gán phạm vi</h1>
        <p className="text-sm text-muted-foreground">
          Bạn không có quyền <code>authz.scope.assign</code>.
        </p>
      </section>
    );
  }

  const active = (assignments.data ?? []).filter((a) => a.validTo === null);
  const ended = (assignments.data ?? []).filter((a) => a.validTo !== null);
  const err = mAssign.error ?? mRevoke.error ?? assignments.error;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Gán phạm vi — ai phụ trách nghĩa trang nào</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trục &ldquo;ở đâu&rdquo;, tách rời khỏi vai. Người phụ trách nhiều nghĩa trang là bình
          thường; một nghĩa trang cũng có nhiều người.
        </p>
      </div>

      {err !== null && err !== undefined && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(err as Error).message}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <label className="text-sm">
          Người dùng (id){' '}
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            placeholder="ULID của người dùng"
          />
        </label>
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <label className="text-sm">
          Nghĩa trang{' '}
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={cemeteryId}
            onChange={(e) => setCemeteryId(e.target.value)}
            disabled={companyId === ''}
          >
            <option value="">— chọn nghĩa trang —</option>
            {cemeteries.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() => mAssign.mutate()}
          disabled={targetUserId === '' || cemeteryId === '' || mAssign.isPending}
        >
          Gán
        </Button>
      </div>

      {targetUserId === '' ? (
        <p className="text-sm text-muted-foreground">Nhập id người dùng để xem phạm vi hiện tại.</p>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium">Đang phụ trách ({active.length})</h2>
            {active.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Chưa phụ trách nghĩa trang nào. Vai có phạm vi theo nghĩa trang sẽ không thấy bản
                ghi nào.
              </p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-2">Nghĩa trang</th>
                    <th className="p-2">Gán bởi</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {active.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="p-2">
                        {a.cemetery === null
                          ? a.cemeteryId
                          : `${a.cemetery.code} · ${a.cemetery.name}`}
                      </td>
                      <td className="p-2 text-muted-foreground">{a.grantedBy ?? '—'}</td>
                      <td className="p-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => mRevoke.mutate(a)}
                          disabled={mRevoke.isPending}
                        >
                          Thu hồi
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {ended.length > 0 && (
            <div>
              {/* Thu hồi = đóng hiệu lực, không xoá dòng. "Tháng trước ai xem được cái này"
                  là đúng câu mà kiểm toán sẽ hỏi. */}
              <h2 className="text-sm font-medium text-muted-foreground">
                Đã thu hồi ({ended.length})
              </h2>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {ended.map((a) => (
                  <li key={a.id}>
                    {a.cemetery?.code ?? a.cemeteryId} — hết hiệu lực {a.validTo?.slice(0, 10)}
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
