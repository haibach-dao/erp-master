'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomer, listCustomers, type CustomerFilters, type DedupWarning } from '@/lib/api';
import { customerType } from '@/lib/status';
import {
  CustomerFormTabs,
  EMPTY_CUSTOMER_FORM,
  pickFilled as pick,
  type CustomerFormValue,
} from '@/components/customer-form';
import {
  CustomerFiltersBar,
  EMPTY_CUSTOMER_FILTERS,
  activeFilterCount,
} from '@/components/customer-filters';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
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
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_CUSTOMER_FILTERS);
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<DedupWarning[]>([]);
  const [form, setForm] = useState(EMPTY_CUSTOMER_FORM);
  const [formTab, setFormTab] = useState('chung');

  /* `queryKey` mang TRỌN bộ lọc. Chỉ đặt `['customers', q]` thì react-query coi hai bộ lọc
   * khác nhau là cùng một truy vấn và phục vụ lại kết quả cũ — người dùng đổi tiêu chí, bảng
   * không đổi, và không có gì báo lỗi. */
  const list = useQuery({
    queryKey: ['customers', filters],
    queryFn: () => listCustomers(filters),
  });

  const q = filters.q ?? '';
  const filtering = activeFilterCount(filters) > 0;

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

      <CustomerFiltersBar value={filters} onChange={setFilters} />

      {/* NÓI RA khi danh sách bị cắt. Im lặng ở đây là chỗ người dùng đếm 50 dòng rồi kết
          luận công ty có 50 khách. `total` đến từ server và đếm trên TOÀN BỘ tập đã lọc. */}
      {list.data !== undefined ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {list.data.truncated
            ? `Hiện ${list.data.items.length} / ${list.data.total} khách hàng — thu hẹp bộ lọc để thấy phần còn lại.`
            : `${list.data.total} khách hàng`}
        </p>
      ) : null}

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

          {list.data?.items.length === 0 ? (
            <TableMessage colSpan={8}>
              {/* Ba câu khác nhau cho ba tình huống khác nhau. Gộp thành "không có dữ liệu"
                  là bắt người dùng tự đoán họ đang gặp cái nào — và việc phải làm để thoát
                  ra thì mỗi cái một khác: tạo mới / sửa từ khoá / nới bộ lọc. */}
              <EmptyState
                icon={Users}
                title={
                  filtering
                    ? 'Không có khách hàng nào khớp bộ lọc'
                    : q === ''
                      ? 'Chưa có khách hàng nào'
                      : `Không tìm thấy khách khớp “${q}”`
                }
                description={
                  filtering
                    ? 'Nới một tiêu chí, hoặc bấm "Xoá lọc" để xem lại toàn bộ.'
                    : q === ''
                      ? 'Bấm "Thêm khách hàng" để tạo hồ sơ đầu tiên.'
                      : undefined
                }
              />
            </TableMessage>
          ) : null}

          {list.data?.items.map((c) => (
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
