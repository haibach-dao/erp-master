'use client';

import { useMemo, useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAuthzCatalogHealth,
  grantPermission,
  listPermissionCatalog,
  listRoles,
  revokePermission,
  type RoleRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { sensitivityOf } from '@/lib/status';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
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

  /* Lệch giữa danh mục trong MÃ NGUỒN và bảng `authz.permissions` của CSDL đang chạy.
   *
   * Đặt banner ở ĐÂY chứ không ở trang chủ: đây là màn hình mà người có thẩm quyền sửa đang mở
   * sẵn, và là màn hình mà lệch làm hỏng ý nghĩa của mọi thứ hiển thị trên đó — ô chọn mã đọc
   * từ CSDL, nên một mã thừa sẽ nằm trong danh sách cấp được mà đọc mã nguồn không thấy, còn
   * một mã thiếu thì cấp cho ai cũng vô hiệu. Một dòng log lúc boot đã trôi qua một lần rồi
   * (03/09/2026); chỗ này thì không trôi được.
   *
   * KHÔNG chặn `enabled` theo quyền: `/health` là công khai và chỉ trả số đếm, còn người đọc
   * được trang này thì đằng nào cũng đã cầm `authz.role.view`. */
  const drift = useQuery({ queryKey: ['authz-catalog-health'], queryFn: getAuthzCatalogHealth });
  const d = drift.data;
  const driftCount = (d?.missing ?? 0) + (d?.orphan ?? 0) + (d?.meta ?? 0);

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
      <section className="space-y-6">
        <PageHeader title="Ma trận vai × quyền" />
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

  const err = mGrant.error ?? mRevoke.error ?? roles.error;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Ma trận vai × quyền"
        description="Sửa ở đây có hiệu lực ngay và được ghi vào nhật ký kiểm toán kèm giá trị trước/sau."
      />

      {err !== null && err !== undefined ? (
        <Alert variant="destructive" title="Thao tác không thành công">
          {(err as Error).message}
        </Alert>
      ) : null}

      {/* Chỉ hiện khi CÓ lệch. Không hiện một dải xanh "mọi thứ ổn" ở trạng thái thường: một
          banner lúc nào cũng có mặt là một banner không ai còn đọc. */}
      {driftCount > 0 && (
        <Alert variant="destructive" title="Danh mục quyền trong mã nguồn KHÁC với CSDL đang chạy">
          Thiếu <strong>{d?.missing ?? 0}</strong> mã · thừa <strong>{d?.orphan ?? 0}</strong> mã ·
          lệch siêu dữ liệu <strong>{d?.meta ?? 0}</strong> mã.
          <br />
          Mã <strong>thiếu</strong> thì cấp cho ai cũng vô hiệu — máy chủ chặn tất cả, kể cả ADMIN.
          Mã <strong>thừa</strong> thì vẫn nằm trong ô chọn bên dưới và vẫn cấp được, trong khi đọc
          mã nguồn không thấy nó ở đâu.
          <br />
          <span className="text-muted-foreground">
            Xem mã nào và cách sửa: chạy <code>pnpm --filter @erp/api check:permissions</code>. Số
            đếm ở đây lấy từ <code>/health</code> — endpoint công khai nên cố ý không trả tên mã.
          </span>
        </Alert>
      )}

      <Card>
        <CardContent className="px-5 py-4">
          <Field label="Vai" htmlFor="role" className="w-96">
            <Select id="role" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">— chọn vai —</option>
              {roles.data?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} · {r.name} ({r.grants.length} mã)
                </option>
              ))}
            </Select>
          </Field>
          {role?.description != null ? (
            <p className="mt-3 text-sm text-muted-foreground">{role.description}</p>
          ) : null}
        </CardContent>
      </Card>

      {role === undefined ? (
        <Card>
          <EmptyState
            icon={KeyRound}
            title="Chưa chọn vai"
            description="Chọn một vai ở trên để xem và sửa danh sách mã quyền của nó."
          />
        </Card>
      ) : (
        <>
          {canGrant ? (
            <Card>
              <CardHeader>
                <CardTitle>Cấp thêm mã quyền</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <Field
                  label="Mã quyền"
                  htmlFor="newCode"
                  className="w-96"
                  hint="Danh mục đóng — chỉ chọn được mã đã có, máy chủ từ chối mã lạ."
                >
                  <Select id="newCode" value={newCode} onChange={(e) => setNewCode(e.target.value)}>
                    <option value="">— chọn mã —</option>
                    {available.map((p) => (
                      <option key={p.code} value={p.code}>
                        [{p.sensitivity}] {p.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Phạm vi" htmlFor="newScope" className="w-40">
                  <Select
                    id="newScope"
                    value={newScope}
                    onChange={(e) => setNewScope(e.target.value)}
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  onClick={() => mGrant.mutate()}
                  disabled={newCode === ''}
                  loading={mGrant.isPending}
                >
                  Cấp
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mức</TableHead>
                <TableHead>Mã quyền</TableHead>
                <TableHead>Phạm vi</TableHead>
                <TableHead align="right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.isPending ? <TableSkeleton rows={6} cols={4} /> : null}

              {role.grants.length === 0 ? (
                <TableMessage colSpan={4}>
                  <EmptyState
                    icon={KeyRound}
                    title="Vai này chưa có mã quyền nào"
                    description="Một vai không mã quyền thì không mở được gì — cấp mã ở trên."
                  />
                </TableMessage>
              ) : null}

              {role.grants.map((g) => {
                const s = sensitivityOf(g.sensitivity);
                return (
                  <TableRow key={g.code}>
                    {/* S3 = dữ liệu cá nhân, hành vi bất khả hồi, bỏ mặt nạ. Hiện mức ra để
                        người rà thấy ngay mình đang cấp thứ gì. */}
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{g.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{g.scope}</Badge>
                    </TableCell>
                    <TableCell align="right">
                      {canRevoke ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mRevoke.isPending}
                          loading={mRevoke.isPending && mRevoke.variables === g.code}
                          onClick={() => mRevoke.mutate(g.code)}
                        >
                          Thu
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
