'use client';

import { useState } from 'react';
import { Lock, UserCog } from 'lucide-react';
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
import { CompanyPicker } from '@/components/company-picker';
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
      <section className="space-y-6">
        <PageHeader title="Gán vai" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền authz.role.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = assignments.data ?? [];
  const active = rows.filter((r) => r.validTo === null || new Date(r.validTo) > new Date());
  const ended = rows.filter((r) => !active.includes(r));
  const err = mAssign.error ?? mRevoke.error ?? assignments.error;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Gán vai cho người dùng"
        description="Nhiều vai thì quyền CỘNG DỒN. Phạm vi dữ liệu là trục riêng — gán ở màn hình “Gán phạm vi”."
      />

      {err !== null && err !== undefined ? (
        <Alert variant="destructive" title="Thao tác không thành công">
          {(err as Error).message}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="px-5 py-4">
          <Field label="Người dùng (id)" htmlFor="targetUserId" className="w-72">
            <Input
              id="targetUserId"
              className="font-mono text-xs"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="ULID của người dùng"
            />
          </Field>
        </CardContent>
      </Card>

      {canAssign && targetUserId !== '' ? (
        <Card>
          <CardHeader>
            <CardTitle>Gán vai mới</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label="Vai" htmlFor="roleCode" className="w-64">
              <Select id="roleCode" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
                <option value="">— chọn vai —</option>
                {roles.data?.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </Select>
            </Field>

            <CompanyPicker value={companyId} onChange={setCompanyId} />

            <Field
              label="Hết hạn"
              htmlFor="validTo"
              className="w-44"
              hint="Tuỳ chọn. Có hạn thì quyền tự rụng."
            >
              <Input
                id="validTo"
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </Field>

            <Field
              label="Lý do"
              htmlFor="reason"
              required
              className="min-w-56 flex-1"
              hint="Nhật ký kiểm toán sẽ giữ lại nguyên văn."
            >
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Vì sao người này giữ vai này?"
              />
            </Field>

            <Button
              onClick={() => mAssign.mutate()}
              disabled={roleCode === '' || reason.trim() === ''}
              loading={mAssign.isPending}
            >
              Gán vai
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {targetUserId === '' ? (
        <Card>
          <EmptyState
            icon={UserCog}
            title="Chưa nhập người dùng"
            description="Nhập id người dùng ở trên để xem những vai họ đang giữ."
          />
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Đang giữ ({active.length})</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vai</TableHead>
                  <TableHead>Công ty</TableHead>
                  <TableHead>Hết hạn</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead align="right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.isPending ? <TableSkeleton rows={3} cols={5} /> : null}

                {!assignments.isPending && active.length === 0 ? (
                  <TableMessage colSpan={5}>
                    <EmptyState
                      icon={UserCog}
                      title="Chưa giữ vai nào"
                      description="Người dùng này chưa làm được gì trong hệ cho tới khi được gán vai."
                    />
                  </TableMessage>
                ) : null}

                {active.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.roleCode}
                      <span className="text-muted-foreground"> · {r.roleName}</span>
                    </TableCell>
                    <TableCell>
                      {r.companyId === null ? (
                        <Badge variant="warning">mọi công ty</Badge>
                      ) : (
                        <span className="font-mono text-xs">{r.companyId}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.validTo?.slice(0, 10) ?? (
                        <span className="text-muted-foreground">vô thời hạn</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.grantReason ?? '—'}</TableCell>
                    <TableCell align="right">
                      {canRevoke ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mRevoke.isPending}
                          loading={mRevoke.isPending && mRevoke.variables?.id === r.id}
                          onClick={() => mRevoke.mutate(r)}
                        >
                          Thu hồi
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {ended.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Đã hết hiệu lực ({ended.length})
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vai</TableHead>
                    <TableHead>Hết hiệu lực</TableHead>
                    <TableHead>Lý do</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ended.map((r) => (
                    <TableRow key={r.id} className="text-muted-foreground">
                      <TableCell>{r.roleCode}</TableCell>
                      <TableCell className="tabular-nums">{r.validTo?.slice(0, 10)}</TableCell>
                      <TableCell>{r.grantReason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
