'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Search, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomer, searchCustomers, type DedupWarning } from '@/lib/api';
import { customerType } from '@/lib/status';
import {
  CustomerFormTabs,
  EMPTY_CUSTOMER_FORM,
  pickFilled as pick,
  type CustomerFormValue,
} from '@/components/customer-form';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
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

export default function CustomersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<DedupWarning[]>([]);
  const [form, setForm] = useState(EMPTY_CUSTOMER_FORM);
  const [formTab, setFormTab] = useState('chung');

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
      setForm(EMPTY_CUSTOMER_FORM);
      setFormTab('chung');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const set = (patch: Partial<CustomerFormValue>) => setForm((f) => ({ ...f, ...patch }));

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
            <TableHead>Nơi sinh</TableHead>
            <TableHead>Phần mộ đứng tên</TableHead>
            <TableHead>Tình trạng</TableHead>
            <TableHead>Điện thoại</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.isPending ? <TableSkeleton rows={6} cols={8} /> : null}

          {list.data?.length === 0 ? (
            <TableMessage colSpan={8}>
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
              <TableCell>{c.person?.placeOfBirth ?? '—'}</TableCell>
              <TableCell>
                {/* Mã mộ, không phải số đếm: người dùng tra theo mã chứ không hỏi
                    "khách này có mấy mộ". Nhiều mộ thì rút gọn để không phá cột. */}
                {c.gravePlotCodes.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-xs" title={c.gravePlotCodes.join(', ')}>
                    {c.gravePlotCodes.slice(0, 2).join(', ')}
                    {c.gravePlotCodes.length > 2 ? ` +${c.gravePlotCodes.length - 2}` : ''}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {/* Tổ chức không có "sống/mất" — để trống thay vì gán bừa "còn sống". */}
                {c.person === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Badge variant={c.isDeceased ? 'neutral' : 'success'}>
                    {c.isDeceased ? 'Đã mất' : 'Còn sống'}
                  </Badge>
                )}
              </TableCell>
              <TableCell>{c.phone ?? '—'}</TableCell>
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
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {create.error !== null ? (
            <Alert variant="destructive" title="Không lưu được" className="mb-4">
              {(create.error as Error).message}
            </Alert>
          ) : null}

          <CustomerFormTabs value={form} onChange={set} tab={formTab} onTabChange={setFormTab} />
        </form>
      </Dialog>
    </section>
  );
}
