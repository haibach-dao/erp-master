'use client';

import { useState } from 'react';
import { Lock, Waypoints } from 'lucide-react';
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
import { CompanyPicker } from '@/components/company-picker';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
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
      <section className="space-y-6">
        <PageHeader title="Gán phạm vi" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền authz.scope.assign. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const active = (assignments.data ?? []).filter((a) => a.validTo === null);
  const ended = (assignments.data ?? []).filter((a) => a.validTo !== null);
  const err = mAssign.error ?? mRevoke.error ?? assignments.error;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Gán phạm vi — ai phụ trách nghĩa trang nào"
        description="Trục “ở đâu”, tách rời khỏi vai. Người phụ trách nhiều nghĩa trang là bình thường; một nghĩa trang cũng có nhiều người."
      />

      {err !== null && err !== undefined ? (
        <Alert variant="destructive" title="Thao tác không thành công">
          {(err as Error).message}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Gán nghĩa trang cho người dùng</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Người dùng (id)" htmlFor="targetUserId" className="w-72">
            <Input
              id="targetUserId"
              className="font-mono text-xs"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="ULID của người dùng"
            />
          </Field>

          <CompanyPicker value={companyId} onChange={setCompanyId} />

          <Field label="Nghĩa trang" htmlFor="cemeteryId" className="w-64">
            <Select
              id="cemeteryId"
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
            </Select>
          </Field>

          <Button
            onClick={() => mAssign.mutate()}
            disabled={targetUserId === '' || cemeteryId === ''}
            loading={mAssign.isPending}
          >
            Gán
          </Button>
        </CardContent>
      </Card>

      {targetUserId === '' ? (
        <Card>
          <EmptyState
            icon={Waypoints}
            title="Chưa nhập người dùng"
            description="Nhập id người dùng ở trên để xem phạm vi họ đang được gán."
          />
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Đang phụ trách ({active.length})</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nghĩa trang</TableHead>
                  <TableHead>Gán bởi</TableHead>
                  <TableHead align="right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.isPending ? <TableSkeleton rows={3} cols={3} /> : null}

                {!assignments.isPending && active.length === 0 ? (
                  <TableMessage colSpan={3}>
                    <EmptyState
                      icon={Waypoints}
                      title="Chưa phụ trách nghĩa trang nào"
                      description="Vai có phạm vi theo nghĩa trang sẽ không thấy bản ghi nào cho tới khi được gán."
                    />
                  </TableMessage>
                ) : null}

                {active.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.cemetery === null
                        ? a.cemeteryId
                        : `${a.cemetery.code} · ${a.cemetery.name}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.grantedBy ?? '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mRevoke.isPending}
                        loading={mRevoke.isPending && mRevoke.variables?.id === a.id}
                        onClick={() => mRevoke.mutate(a)}
                      >
                        Thu hồi
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {ended.length > 0 ? (
            <div className="space-y-3">
              {/* Thu hồi = đóng hiệu lực, không xoá dòng. "Tháng trước ai xem được cái này"
                  là đúng câu mà kiểm toán sẽ hỏi. */}
              <h2 className="text-sm font-semibold text-muted-foreground">
                Đã thu hồi ({ended.length})
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nghĩa trang</TableHead>
                    <TableHead>Hết hiệu lực</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ended.map((a) => (
                    <TableRow key={a.id} className="text-muted-foreground">
                      <TableCell>{a.cemetery?.code ?? a.cemeteryId}</TableCell>
                      <TableCell className="tabular-nums">{a.validTo?.slice(0, 10)}</TableCell>
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
