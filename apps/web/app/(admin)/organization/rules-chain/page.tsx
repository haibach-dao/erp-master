'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccessRule,
  explainAccessRule,
  listAccessRules,
  listPermissionCatalog,
  listRoles,
  moveAccessRule,
  revokeAccessRule,
  type AccessRuleRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

/* Chuỗi luật truy cập — mô hình tường lửa.
 *
 * THỨ TỰ LÀ Ý NGHĨA của bảng này: duyệt từ trên xuống, luật khớp đầu tiên quyết và dừng.
 * Cùng hai luật đặt ngược thứ tự cho ra kết quả ngược nhau. Vì thế màn hình này hiện
 * chuỗi theo đúng thứ tự duyệt, và "đổi thứ tự" là nút riêng chứ không phải sửa tay con
 * số ưu tiên — sửa tay là cách tạo ra hai luật cùng ưu tiên mà không ai đọc ra được.
 *
 * Dùng nút lên/xuống thay vì kéo-thả: kéo-thả không dùng được bằng bàn phím, và với một
 * chuỗi luật thì "đưa luật này lên trên luật kia" là thao tác cần chính xác tuyệt đối,
 * không phải cần mượt.
 */
export default function RulesChainPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('DENY');
  const [permissionCode, setPermissionCode] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [reason, setReason] = useState('');
  const [testUserId, setTestUserId] = useState('');
  const [testCode, setTestCode] = useState('');

  const canView = can(user, 'authz.rule.view');
  const canEdit = can(user, 'authz.rule.update');

  const rules = useQuery({
    queryKey: ['access-rules'],
    queryFn: listAccessRules,
    enabled: canView,
  });
  const catalog = useQuery({
    queryKey: ['authz-catalog'],
    queryFn: listPermissionCatalog,
    enabled: canView && can(user, 'authz.permission.view'),
  });
  const roles = useQuery({
    queryKey: ['authz-roles'],
    queryFn: listRoles,
    enabled: canView && can(user, 'authz.role.view'),
  });

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['access-rules'] });
  const mCreate = useMutation({
    mutationFn: () =>
      createAccessRule({
        effect,
        permissionCode,
        ...(roleCode === '' ? {} : { roleCode }),
        ...(subjectUserId === '' ? {} : { subjectUserId }),
        reason,
      }),
    onSuccess: async () => {
      setReason('');
      setPermissionCode('');
      await refresh();
    },
  });
  const mMove = useMutation({
    mutationFn: (v: { id: string; dir: 'up' | 'down' }) => moveAccessRule(v.id, v.dir),
    onSuccess: refresh,
  });
  const mRevoke = useMutation({
    mutationFn: (r: AccessRuleRow) => revokeAccessRule(r.id),
    onSuccess: refresh,
  });
  const mExplain = useMutation({
    mutationFn: () => explainAccessRule(testUserId, testCode),
  });

  if (!canView) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Chuỗi luật truy cập</h1>
        <p className="text-sm text-muted-foreground">
          Bạn không có quyền <code>authz.rule.view</code>.
        </p>
      </section>
    );
  }

  const active = (rules.data ?? []).filter((r) => r.active);
  const ended = (rules.data ?? []).filter((r) => !r.active);
  const err = mCreate.error ?? mMove.error ?? mRevoke.error ?? rules.error;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Chuỗi luật truy cập</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Duyệt từ trên xuống. <strong>Luật khớp đầu tiên quyết định và dừng.</strong> Không luật
          nào khớp thì ma trận vai quyết; ma trận không cấp gì thì từ chối.
        </p>
      </div>

      {err !== null && err !== undefined && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(err as Error).message}
        </p>
      )}

      {/* Cảnh báo này không phải trang trí: một luật ALLOW cấp được thứ không vai nào cấp. */}
      <p className="rounded-md border border-border bg-muted/50 p-3 text-sm">
        Luật <strong>ALLOW</strong> nằm <strong>trên</strong> ma trận vai — nó cấp được thứ không
        vai nào cấp, kể cả dữ liệu nhạy cảm mà quyền wildcard không với tới. Mọi thay đổi ở đây đều
        vào nhật ký kiểm toán.
      </p>

      <div>
        <h2 className="text-sm font-medium">Đang hiệu lực ({active.length})</h2>
        {active.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Chưa có luật nào. Mọi quyết định do ma trận vai đưa ra.
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Hiệu lực</th>
                <th className="p-2">Áp cho</th>
                <th className="p-2">Mã quyền</th>
                <th className="p-2">Lý do</th>
                <th className="p-2">Thứ tự</th>
              </tr>
            </thead>
            <tbody>
              {active.map((r, i) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 text-muted-foreground">{i + 1}</td>
                  <td className="p-2">
                    <span
                      className={
                        r.effect === 'DENY' ? 'font-medium text-destructive' : 'font-medium'
                      }
                    >
                      {r.effect}
                    </span>
                  </td>
                  <td className="p-2">
                    {r.subjectUserId ?? (r.roleCode !== null ? `vai:${r.roleCode}` : 'MỌI NGƯỜI')}
                  </td>
                  <td className="p-2 font-mono text-xs">{r.permissionCode}</td>
                  <td className="p-2 text-muted-foreground">{r.reason}</td>
                  <td className="p-2">
                    {canEdit && (
                      <span className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={i === 0 || mMove.isPending}
                          onClick={() => mMove.mutate({ id: r.id, dir: 'up' })}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={i === active.length - 1 || mMove.isPending}
                          onClick={() => mMove.mutate({ id: r.id, dir: 'down' })}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mRevoke.isPending}
                          onClick={() => mRevoke.mutate(r)}
                        >
                          Thu hồi
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Dòng này KHÔNG nằm trong bảng — nó là hành vi mặc-định-từ-chối của guard.
                  Hiện nó ra vì một chuỗi luật đọc mà không thấy điểm kết là chuỗi dễ hiểu sai. */}
              <tr className="border-t border-border bg-muted/30 text-muted-foreground">
                <td className="p-2">—</td>
                <td className="p-2 font-medium">DENY</td>
                <td className="p-2">MỌI NGƯỜI</td>
                <td className="p-2 font-mono text-xs">* (ngầm)</td>
                <td className="p-2" colSpan={2}>
                  Không luật nào khớp → ma trận vai quyết → không cấp thì từ chối
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Thêm luật (vào cuối chuỗi)</p>
          <p className="text-xs text-muted-foreground">
            Luật mới vào <strong>cuối</strong>: chèn lên đầu sẽ lặng lẽ vượt qua mọi luật đang có.
            Muốn nó lên trên thì đẩy lên bằng nút ↑.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Hiệu lực{' '}
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={effect}
                onChange={(e) => setEffect(e.target.value as 'ALLOW' | 'DENY')}
              >
                <option value="DENY">DENY</option>
                <option value="ALLOW">ALLOW</option>
              </select>
            </label>
            <label className="text-sm">
              Mã quyền{' '}
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={permissionCode}
                onChange={(e) => setPermissionCode(e.target.value)}
              >
                <option value="">— chọn mã —</option>
                {catalog.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    [{p.sensitivity}] {p.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Vai (tuỳ chọn){' '}
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={roleCode}
                onChange={(e) => setRoleCode(e.target.value)}
              >
                <option value="">mọi vai</option>
                {roles.data?.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Người dùng (tuỳ chọn){' '}
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={subjectUserId}
                onChange={(e) => setSubjectUserId(e.target.value)}
                placeholder="id, bỏ trống = mọi người"
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
              onClick={() => mCreate.mutate()}
              disabled={permissionCode === '' || reason.trim() === '' || mCreate.isPending}
            >
              Thêm
            </Button>
          </div>
        </div>
      )}

      {/* Một chuỗi luật có thứ tự mà không thử được là một chuỗi không ai dám sửa. */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm font-medium">Thử chuỗi luật</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Người dùng (id){' '}
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={testUserId}
              onChange={(e) => setTestUserId(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Mã quyền{' '}
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
            >
              <option value="">— chọn mã —</option>
              {catalog.data?.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => mExplain.mutate()}
            disabled={testUserId === '' || testCode === '' || mExplain.isPending}
          >
            Thử
          </Button>
        </div>
        {mExplain.data !== undefined && (
          <div className="text-sm">
            <p>
              Kết quả: <strong>{mExplain.data.ruling}</strong>
              {mExplain.data.fallsBackToRoleMatrix
                ? ' — không luật nào khớp, ma trận vai quyết'
                : ` — do luật #${mExplain.data.matchedRule?.priority ?? '?'} (${mExplain.data.matchedRule?.reason ?? ''})`}
            </p>
            <p className="text-muted-foreground">
              Phạm vi bản ghi cho mã này: {mExplain.data.scopeLevel}
            </p>
          </div>
        )}
        {mExplain.error !== null && (
          <p className="text-sm text-destructive">{(mExplain.error as Error).message}</p>
        )}
      </div>

      {ended.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Đã thu hồi ({ended.length})</h2>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {ended.map((r) => (
              <li key={r.id}>
                {r.effect} {r.permissionCode} — hết hiệu lực {r.validTo?.slice(0, 10)} · {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
