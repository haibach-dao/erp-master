'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Search, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomer, searchCustomers, type DedupWarning } from '@/lib/api';
import { customerType } from '@/lib/status';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
  gender: '',
  dateOfBirth: '',
  nationalId: '',
  nationalIdIssuedOn: '',
  nationalIdIssuedPlace: '',
  permanentAddress: '',
  contactAddress: '',
  ethnicity: '',
  religion: '',
  orgName: '',
  phone: '',
  email: '',
};

/* Bỏ hẳn ô để trống khỏi payload. Gửi chuỗi rỗng lên là GHI chuỗi rỗng vào CSDL — khác
 * hẳn `null`, và về sau "chưa nhập" với "nhập rỗng" không phân biệt được nữa. */
function pick<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  const v = value.trim();
  return v === '' ? {} : ({ [key]: v } as Partial<Record<K, string>>);
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<DedupWarning[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  const list = useQuery({ queryKey: ['customers', q], queryFn: () => searchCustomers(q) });

  const individual = form.type === 'INDIVIDUAL';

  const create = useMutation({
    mutationFn: () =>
      createCustomer({
        type: form.type,
        ...(individual
          ? {
              person: {
                fullName: form.fullName,
                ...pick('gender', form.gender),
                ...pick('dateOfBirth', form.dateOfBirth),
                ...pick('nationalId', form.nationalId),
                ...pick('nationalIdIssuedOn', form.nationalIdIssuedOn),
                ...pick('nationalIdIssuedPlace', form.nationalIdIssuedPlace),
                ...pick('permanentAddress', form.permanentAddress),
                ...pick('contactAddress', form.contactAddress),
                ...pick('ethnicity', form.ethnicity),
                ...pick('religion', form.religion),
                ...pick('phone', form.phone),
                ...pick('email', form.email),
              },
            }
          : { orgName: form.orgName }),
        ...pick('phone', form.phone),
        ...pick('email', form.email),
      }),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      setForm(EMPTY_FORM);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <section className="space-y-6">
      <PageHeader
        title="Khách hàng"
        description="Hồ sơ khách cá nhân và tổ chức. Bấm một dòng để xem hồ sơ đầy đủ."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            Thêm khách hàng
          </Button>
        }
      />

      {warnings.length > 0 ? (
        <Alert variant="warning" title="Cảnh báo trùng — hệ thống KHÔNG tự gộp">
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
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.isPending ? <TableSkeleton rows={6} cols={7} /> : null}

          {list.data?.length === 0 ? (
            <TableMessage colSpan={7}>
              <EmptyState
                icon={Users}
                title={q === '' ? 'Chưa có khách hàng nào' : `Không tìm thấy khách khớp “${q}”`}
                description={q === '' ? 'Bấm "Thêm khách hàng" để tạo hồ sơ đầu tiên.' : undefined}
              />
            </TableMessage>
          ) : null}

          {list.data?.map((c) => (
            /* Cả dòng bấm được. Dùng `<tr>` có onClick kèm onKeyDown thay vì bọc mỗi ô
             * trong thẻ <a> — bọc <a> trong <td> làm hỏng cấu trúc bảng và trình đọc màn
             * hình đọc lại tên khách bảy lần cho bảy cột. */
            <TableRow
              key={c.id}
              tabIndex={0}
              role="link"
              aria-label={`Xem hồ sơ ${c.person?.fullName ?? c.orgName ?? c.customerCode}`}
              className="cursor-pointer transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
              onClick={() => router.push(`/cemetery/customers/${c.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/cemetery/customers/${c.id}`);
                }
              }}
            >
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
              <TableCell className="w-8 text-muted-foreground">
                <ChevronRight className="size-4" aria-hidden />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Khách hàng mới"
        description="Chỉ họ tên là bắt buộc. Các trường còn lại bổ sung sau ở màn hình hồ sơ."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button form="customer-form" type="submit" loading={create.isPending}>
              {create.isPending ? 'Đang lưu…' : 'Lưu khách hàng'}
            </Button>
          </>
        }
      >
        <form
          id="customer-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {create.error !== null ? (
            <Alert variant="destructive" title="Không lưu được" className="sm:col-span-2">
              {(create.error as Error).message}
            </Alert>
          ) : null}

          <Field label="Loại" htmlFor="type">
            <Select id="type" value={form.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="INDIVIDUAL">Cá nhân</option>
              <option value="ORGANIZATION">Tổ chức</option>
              <option value="AGENT">Đại lý</option>
              <option value="PROSPECT">Tiềm năng</option>
            </Select>
          </Field>

          {individual ? (
            <>
              <Field label="Họ tên" htmlFor="fullName" required>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => set({ fullName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Giới tính" htmlFor="gender">
                <Select
                  id="gender"
                  value={form.gender}
                  onChange={(e) => set({ gender: e.target.value })}
                >
                  <option value="">— Chưa rõ —</option>
                  <option value="MALE">Nam</option>
                  <option value="FEMALE">Nữ</option>
                  <option value="UNKNOWN">Không xác định</option>
                </Select>
              </Field>
              <Field label="Ngày sinh" htmlFor="dateOfBirth">
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => set({ dateOfBirth: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field label="Tên tổ chức" htmlFor="orgName" required>
              <Input
                id="orgName"
                value={form.orgName}
                onChange={(e) => set({ orgName: e.target.value })}
                required
              />
            </Field>
          )}

          <Field label="Điện thoại" htmlFor="phone">
            <Input id="phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>

          {individual ? (
            <>
              <div className="sm:col-span-2">
                <Separator />
                <p className="pt-3 text-xs text-muted-foreground">
                  Giấy tờ tuỳ thân — hiện ra màn hình ở dạng che bớt. Xem bản đầy đủ cần quyền riêng
                  và mỗi lần xem đều ghi nhật ký.
                </p>
              </div>

              <Field label="CCCD" htmlFor="nationalId" hint="Lưu mã hoá, hiện dạng 079***123.">
                <Input
                  id="nationalId"
                  value={form.nationalId}
                  onChange={(e) => set({ nationalId: e.target.value })}
                />
              </Field>
              <Field label="Ngày cấp" htmlFor="nationalIdIssuedOn">
                <Input
                  id="nationalIdIssuedOn"
                  type="date"
                  value={form.nationalIdIssuedOn}
                  onChange={(e) => set({ nationalIdIssuedOn: e.target.value })}
                />
              </Field>
              <Field label="Nơi cấp" htmlFor="nationalIdIssuedPlace" className="sm:col-span-2">
                <Input
                  id="nationalIdIssuedPlace"
                  value={form.nationalIdIssuedPlace}
                  onChange={(e) => set({ nationalIdIssuedPlace: e.target.value })}
                />
              </Field>

              <Field
                label="Địa chỉ thường trú"
                htmlFor="permanentAddress"
                className="sm:col-span-2"
              >
                <Input
                  id="permanentAddress"
                  value={form.permanentAddress}
                  onChange={(e) => set({ permanentAddress: e.target.value })}
                />
              </Field>
              <Field label="Địa chỉ liên hệ" htmlFor="contactAddress" className="sm:col-span-2">
                <Input
                  id="contactAddress"
                  value={form.contactAddress}
                  onChange={(e) => set({ contactAddress: e.target.value })}
                />
              </Field>

              <Field
                label="Dân tộc"
                htmlFor="ethnicity"
                hint="Dữ liệu nhạy cảm theo NĐ13 Điều 2.4."
              >
                <Input
                  id="ethnicity"
                  value={form.ethnicity}
                  onChange={(e) => set({ ethnicity: e.target.value })}
                />
              </Field>
              <Field
                label="Tôn giáo"
                htmlFor="religion"
                hint="Cần cho nghi thức tang lễ; che ở mức cao nhất."
              >
                <Input
                  id="religion"
                  value={form.religion}
                  onChange={(e) => set({ religion: e.target.value })}
                />
              </Field>
            </>
          ) : null}
        </form>
      </Dialog>
    </section>
  );
}
