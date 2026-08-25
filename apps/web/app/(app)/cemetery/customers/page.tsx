'use client';

import { useState } from 'react';
import { Plus, Search, Users, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomer, searchCustomers, type DedupWarning } from '@/lib/api';
import { customerType } from '@/lib/status';
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

const EMPTY_FORM = {
  type: 'INDIVIDUAL',
  fullName: '',
  nationalId: '',
  orgName: '',
  phone: '',
  email: '',
};

export default function CustomersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<DedupWarning[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: () => searchCustomers(q),
  });

  const create = useMutation({
    mutationFn: () =>
      createCustomer({
        type: form.type,
        ...(form.type === 'INDIVIDUAL'
          ? {
              person: {
                fullName: form.fullName,
                ...(form.nationalId !== '' ? { nationalId: form.nationalId } : {}),
              },
            }
          : { orgName: form.orgName }),
        ...(form.phone !== '' ? { phone: form.phone } : {}),
        ...(form.email !== '' ? { email: form.email } : {}),
      }),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  return (
    <section className="space-y-6">
      <PageHeader
        title="Khách hàng"
        description="Hồ sơ khách cá nhân và tổ chức."
        actions={
          <Button variant={open ? 'ghost' : 'default'} onClick={() => setOpen((v) => !v)}>
            {open ? <X aria-hidden /> : <Plus aria-hidden />}
            {open ? 'Đóng' : 'Thêm khách hàng'}
          </Button>
        }
      />

      {open ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Khách hàng mới</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Loại" htmlFor="type">
                <Select
                  id="type"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="INDIVIDUAL">Cá nhân</option>
                  <option value="ORGANIZATION">Tổ chức</option>
                  <option value="AGENT">Đại lý</option>
                  <option value="PROSPECT">Tiềm năng</option>
                </Select>
              </Field>

              {form.type === 'INDIVIDUAL' ? (
                <>
                  <Field label="Họ tên" htmlFor="fullName" required>
                    <Input
                      id="fullName"
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      required
                    />
                  </Field>
                  <Field
                    label="CCCD"
                    htmlFor="nationalId"
                    hint="Tùy chọn. Hiện ra bảng ở dạng che bớt."
                  >
                    <Input
                      id="nationalId"
                      value={form.nationalId}
                      onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <Field label="Tên tổ chức" htmlFor="orgName" required>
                  <Input
                    id="orgName"
                    value={form.orgName}
                    onChange={(e) => setForm({ ...form, orgName: e.target.value })}
                    required
                  />
                </Field>
              )}

              <Field label="Điện thoại" htmlFor="phone">
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>

              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>

              <div className="sm:col-span-2">
                {create.error !== null ? (
                  <Alert variant="destructive" title="Không lưu được" className="mb-3">
                    {(create.error as Error).message}
                  </Alert>
                ) : null}
                <Button type="submit" loading={create.isPending}>
                  {create.isPending ? 'Đang lưu…' : 'Lưu khách hàng'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {warnings.length > 0 ? (
        <Alert
          variant="warning"
          title="Cảnh báo trùng — hệ thống KHÔNG tự gộp"
          className="max-w-3xl"
        >
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w) => (
              <li key={w.reason}>
                {w.reason} — {w.matches.length} bản ghi giống
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Tìm theo tên, mã KH, điện thoại, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Tìm khách hàng"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mã KH</TableHead>
            <TableHead>Loại</TableHead>
            <TableHead>Tên</TableHead>
            <TableHead>CCCD</TableHead>
            <TableHead>Điện thoại</TableHead>
            <TableHead>Email</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.isPending ? <TableSkeleton rows={6} cols={6} /> : null}

          {list.data?.length === 0 ? (
            <TableMessage colSpan={6}>
              <EmptyState
                icon={Users}
                title={q === '' ? 'Chưa có khách hàng nào' : `Không tìm thấy khách khớp “${q}”`}
                description={q === '' ? 'Bấm "Thêm khách hàng" để tạo hồ sơ đầu tiên.' : undefined}
              />
            </TableMessage>
          ) : null}

          {list.data?.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">{c.customerCode}</TableCell>
              <TableCell className="whitespace-nowrap">{customerType(c.type)}</TableCell>
              <TableCell className="font-medium">
                {c.person?.fullName ?? c.orgName ?? '—'}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {c.person?.nationalIdMasked ?? '—'}
              </TableCell>
              <TableCell>{c.phone ?? '—'}</TableCell>
              <TableCell>{c.email ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
