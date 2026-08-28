'use client';

import { useState } from 'react';
import { Lock, UserCog } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignRole,
  listRoleAssignments,
  listRoleHolders,
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
 *
 * Tra được HAI CHIỀU (thêm 28/08/2026). Chiều xuôi trả lời "người này làm được gì"; chiều
 * ngược trả lời "vai này đang ở tay ai" — câu phải hỏi mỗi lần rà quyền, và trước đây chỉ
 * trả lời được bằng cách gõ từng id người một, tức là trên thực tế không trả lời được.
 */
export default function RoleAssignmentPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'user' | 'role'>('user');
  const [targetUserId, setTargetUserId] = useState('');
  const [filterRole, setFilterRole] = useState('');
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
    enabled: canView && mode === 'user' && targetUserId !== '',
  });
  const holders = useQuery({
    queryKey: ['authz-role-holders', filterRole],
    queryFn: () => listRoleHolders(filterRole),
    enabled: canView && mode === 'role' && filterRole !== '',
  });

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: ['authz-assignments', targetUserId] });
    await qc.invalidateQueries({ queryKey: ['authz-role-holders', filterRole] });
  };

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
  const err = mAssign.error ?? mRevoke.error ?? assignments.error ?? holders.error;

  const holderRows = holders.data ?? [];
  /* Chỉ đếm dòng CÒN hiệu lực. Đếm cả dòng đã hết hạn thì con số trả lời câu "đã từng có
   * bao nhiêu người" chứ không phải "hiện có bao nhiêu người" — và người rà quyền hỏi câu
   * thứ hai. */
  const holdersActive = holderRows.filter(
    (r) => r.validTo === null || new Date(r.validTo) > new Date(),
  );

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
        <CardContent className="flex flex-wrap items-end gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Tra theo</span>
            <div className="flex gap-2">
              <Button
                variant={mode === 'user' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('user')}
              >
                Người dùng
              </Button>
              <Button
                variant={mode === 'role' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('role')}
              >
                Vai
              </Button>
            </div>
          </div>

          {mode === 'user' ? (
            <Field
              label="Người dùng (id)"
              htmlFor="targetUserId"
              className="w-72"
              hint="Người này đang giữ những vai nào."
            >
              <Input
                id="targetUserId"
                className="font-mono text-xs"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="ULID của người dùng"
              />
            </Field>
          ) : (
            <Field
              label="Vai"
              htmlFor="filterRole"
              className="w-72"
              hint="Vai này đang ở tay những ai."
            >
              <Select
                id="filterRole"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
              >
                <option value="">— chọn vai —</option>
                {roles.data?.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      {mode === 'user' && canAssign && targetUserId !== '' ? (
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

      {mode === 'role' ? (
        filterRole === '' ? (
          <Card>
            <EmptyState
              icon={UserCog}
              title="Chưa chọn vai"
              description="Chọn một vai ở trên để xem những ai đang giữ nó."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">
              Đang giữ vai {filterRole} ({holdersActive.length})
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Người dùng</TableHead>
                  <TableHead>Công ty</TableHead>
                  <TableHead>Hết hạn</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead align="right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holders.isPending ? <TableSkeleton rows={3} cols={5} /> : null}

                {!holders.isPending && holdersActive.length === 0 ? (
                  <TableMessage colSpan={5}>
                    <EmptyState
                      icon={UserCog}
                      title="Chưa ai giữ vai này"
                      description="Vai đã khai trong hệ nhưng chưa gán cho ai — nên hiện chưa mở thêm quyền cho người nào."
                    />
                  </TableMessage>
                ) : null}

                {holdersActive.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{r.userEmail ?? '—'}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {r.userId}
                      </span>
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
        )
      ) : targetUserId === '' ? (
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
