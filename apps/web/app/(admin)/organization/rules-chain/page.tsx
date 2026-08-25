'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Lock, ShieldCheck } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessage,
  TableRow,
} from '@/components/ui/table';

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
      <section className="space-y-6">
        <PageHeader title="Chuỗi luật truy cập" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền authz.rule.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const active = (rules.data ?? []).filter((r) => r.active);
  const ended = (rules.data ?? []).filter((r) => !r.active);
  const err = mCreate.error ?? mMove.error ?? mRevoke.error ?? rules.error;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Chuỗi luật truy cập"
        description="Duyệt từ trên xuống. Luật khớp đầu tiên quyết định và dừng. Không luật nào khớp thì ma trận vai quyết; ma trận không cấp gì thì từ chối."
      />

      {err !== null && err !== undefined ? (
        <Alert variant="destructive" title="Thao tác không thành công">
          {(err as Error).message}
        </Alert>
      ) : null}

      {/* Cảnh báo này không phải trang trí: một luật ALLOW cấp được thứ không vai nào cấp. */}
      <Alert variant="warning" title="Luật ALLOW nằm TRÊN ma trận vai">
        Nó cấp được thứ không vai nào cấp, kể cả dữ liệu nhạy cảm mà quyền wildcard không với tới.
        Mọi thay đổi ở đây đều vào nhật ký kiểm toán.
      </Alert>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Đang hiệu lực ({active.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Hiệu lực</TableHead>
              <TableHead>Áp cho</TableHead>
              <TableHead>Mã quyền</TableHead>
              <TableHead>Lý do</TableHead>
              <TableHead align="right">Thứ tự</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.isPending ? <TableSkeleton rows={3} cols={6} /> : null}

            {!rules.isPending && active.length === 0 ? (
              <TableMessage colSpan={6}>
                <EmptyState
                  icon={ShieldCheck}
                  title="Chưa có luật nào"
                  description="Mọi quyết định hiện do ma trận vai đưa ra."
                />
              </TableMessage>
            ) : null}

            {active.map((r, i) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell>
                  <Badge variant={r.effect === 'DENY' ? 'destructive' : 'success'}>
                    {r.effect}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.subjectUserId !== null ? (
                    <span className="font-mono text-xs">{r.subjectUserId}</span>
                  ) : r.roleCode !== null ? (
                    <Badge variant="outline">vai: {r.roleCode}</Badge>
                  ) : (
                    <Badge variant="warning">MỌI NGƯỜI</Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.permissionCode}</TableCell>
                <TableCell className="text-muted-foreground">{r.reason}</TableCell>
                <TableCell align="right">
                  {canEdit ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Đẩy luật lên trên"
                        disabled={i === 0 || mMove.isPending}
                        onClick={() => mMove.mutate({ id: r.id, dir: 'up' })}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Đẩy luật xuống dưới"
                        disabled={i === active.length - 1 || mMove.isPending}
                        onClick={() => mMove.mutate({ id: r.id, dir: 'down' })}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mRevoke.isPending}
                        loading={mRevoke.isPending && mRevoke.variables?.id === r.id}
                        onClick={() => mRevoke.mutate(r)}
                      >
                        Thu hồi
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}

            {/* Dòng này KHÔNG nằm trong bảng — nó là hành vi mặc-định-từ-chối của guard.
                Hiện nó ra vì một chuỗi luật đọc mà không thấy điểm kết là chuỗi dễ hiểu sai. */}
            {active.length > 0 ? (
              <TableRow className="bg-muted/40 text-muted-foreground even:bg-muted/40 hover:bg-muted/40">
                <TableCell>—</TableCell>
                <TableCell>
                  <Badge variant="neutral">DENY</Badge>
                </TableCell>
                <TableCell>MỌI NGƯỜI</TableCell>
                <TableCell className="font-mono text-xs">* (ngầm)</TableCell>
                <TableCell colSpan={2}>
                  Không luật nào khớp → ma trận vai quyết → không cấp thì từ chối
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Thêm luật (vào cuối chuỗi)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Luật mới vào <strong>cuối</strong>: chèn lên đầu sẽ lặng lẽ vượt qua mọi luật đang có.
              Muốn nó lên trên thì đẩy lên bằng nút ↑.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label="Hiệu lực" htmlFor="effect" className="w-32">
              <Select
                id="effect"
                value={effect}
                onChange={(e) => setEffect(e.target.value as 'ALLOW' | 'DENY')}
              >
                <option value="DENY">DENY</option>
                <option value="ALLOW">ALLOW</option>
              </Select>
            </Field>
            <Field label="Mã quyền" htmlFor="permissionCode" required className="w-80">
              <Select
                id="permissionCode"
                value={permissionCode}
                onChange={(e) => setPermissionCode(e.target.value)}
              >
                <option value="">— chọn mã —</option>
                {catalog.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    [{p.sensitivity}] {p.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vai" htmlFor="ruleRole" className="w-44" hint="Bỏ trống = mọi vai.">
              <Select id="ruleRole" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
                <option value="">mọi vai</option>
                {roles.data?.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Người dùng"
              htmlFor="subjectUserId"
              className="w-56"
              hint="Bỏ trống = mọi người."
            >
              <Input
                id="subjectUserId"
                className="font-mono text-xs"
                value={subjectUserId}
                onChange={(e) => setSubjectUserId(e.target.value)}
                placeholder="id người dùng"
              />
            </Field>
            <Field label="Lý do" htmlFor="ruleReason" required className="min-w-56 flex-1">
              <Input
                id="ruleReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Vì sao có luật này?"
              />
            </Field>
            <Button
              onClick={() => mCreate.mutate()}
              disabled={permissionCode === '' || reason.trim() === ''}
              loading={mCreate.isPending}
            >
              Thêm
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Một chuỗi luật có thứ tự mà không thử được là một chuỗi không ai dám sửa. */}
      <Card>
        <CardHeader>
          <CardTitle>Thử chuỗi luật</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Người dùng (id)" htmlFor="testUserId" className="w-72">
              <Input
                id="testUserId"
                className="font-mono text-xs"
                value={testUserId}
                onChange={(e) => setTestUserId(e.target.value)}
              />
            </Field>
            <Field label="Mã quyền" htmlFor="testCode" className="w-80">
              <Select id="testCode" value={testCode} onChange={(e) => setTestCode(e.target.value)}>
                <option value="">— chọn mã —</option>
                {catalog.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="outline"
              onClick={() => mExplain.mutate()}
              disabled={testUserId === '' || testCode === ''}
              loading={mExplain.isPending}
            >
              Thử
            </Button>
          </div>

          {mExplain.data !== undefined ? (
            <Alert variant={mExplain.data.ruling === 'DENY' ? 'destructive' : 'success'}>
              <p className="font-medium text-foreground">
                Kết quả: {mExplain.data.ruling}
                {mExplain.data.fallsBackToRoleMatrix
                  ? ' — không luật nào khớp, ma trận vai quyết'
                  : ` — do luật #${mExplain.data.matchedRule?.priority ?? '?'} (${
                      mExplain.data.matchedRule?.reason ?? ''
                    })`}
              </p>
              <p>Phạm vi bản ghi cho mã này: {mExplain.data.scopeLevel}</p>
            </Alert>
          ) : null}

          {mExplain.error !== null ? (
            <Alert variant="destructive" title="Không thử được">
              {(mExplain.error as Error).message}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {ended.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Đã thu hồi ({ended.length})
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hiệu lực</TableHead>
                <TableHead>Mã quyền</TableHead>
                <TableHead>Hết hiệu lực</TableHead>
                <TableHead>Lý do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ended.map((r) => (
                <TableRow key={r.id} className="text-muted-foreground">
                  <TableCell>{r.effect}</TableCell>
                  <TableCell className="font-mono text-xs">{r.permissionCode}</TableCell>
                  <TableCell className="tabular-nums">{r.validTo?.slice(0, 10)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
