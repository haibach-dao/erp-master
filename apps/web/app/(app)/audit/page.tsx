'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, FilterX, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  getAuditFacets,
  listAuditEvents,
  type AuditFilters,
  type AuditEventPage,
} from '@/lib/api';
import {
  actionLabel,
  actionVariant,
  actorTypeLabel,
  endOfDayIso,
  formatAuditTime,
  resultLabel,
  startOfDayIso,
} from '@/lib/audit';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

const EMPTY = { fromDate: '', toDate: '', actorId: '', action: '', entityType: '', result: '' };
const PAGE_SIZES = [25, 50, 100, 200];

export default function AuditPage() {
  const [form, setForm] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  /* Ngày người dùng chọn được quy về đầu/cuối ngày THEO GIỜ MÁY trước khi gửi. Gửi thẳng
   * `yyyy-MM-dd` là để server hiểu thành nửa đêm UTC — lệch 7 tiếng, và bộ lọc sẽ cắt mất
   * dữ liệu một cách âm thầm. */
  const from = startOfDayIso(form.fromDate);
  const to = endOfDayIso(form.toDate);
  const filters: AuditFilters = {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(form.actorId !== '' ? { actorId: form.actorId } : {}),
    ...(form.action !== '' ? { action: form.action } : {}),
    ...(form.entityType !== '' ? { entityType: form.entityType } : {}),
    ...(form.result !== '' ? { result: form.result } : {}),
    page,
    pageSize,
  };

  const { data, error, isPending, isFetching } = useQuery<AuditEventPage>({
    queryKey: ['audit-events', filters],
    queryFn: () => listAuditEvents(filters),
    retry: false,
    /* Giữ trang cũ trên màn hình trong lúc trang mới đang tải. Không giữ thì bảng nháy
     * sang rỗng mỗi lần đổi bộ lọc, trông như "không có kết quả". */
    placeholderData: (prev) => prev,
  });

  const unauthenticated = error instanceof ApiError && error.status === 401;

  const facets = useQuery({
    queryKey: ['audit-facets'],
    queryFn: getAuditFacets,
    retry: false,
    enabled: !unauthenticated,
  });

  const activeCount = Object.values(form).filter((v) => v !== '').length;
  const set = (patch: Partial<typeof EMPTY>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPage(1); // đổi bộ lọc thì về trang 1 — ở lại trang 7 của kết quả cũ là trang rỗng
  };

  const totalPages = data === undefined ? 1 : Math.max(Math.ceil(data.total / data.pageSize), 1);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Audit &amp; Check Log"
        description="Nhật ký bất biến: ai làm gì, lên đối tượng nào, kết quả ra sao."
        actions={
          activeCount > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setForm(EMPTY);
                setPage(1);
              }}
            >
              <FilterX className="size-4" aria-hidden />
              Xoá lọc ({activeCount})
            </Button>
          ) : undefined
        }
      />

      {error !== null && !unauthenticated ? (
        <Alert variant="destructive" title="Không tải được nhật ký">
          {(error as Error).message}
        </Alert>
      ) : null}

      {!unauthenticated ? (
        <Card>
          <CardContent className="pt-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Từ ngày" htmlFor="fromDate">
                <Input
                  id="fromDate"
                  type="date"
                  value={form.fromDate}
                  max={form.toDate === '' ? undefined : form.toDate}
                  onChange={(e) => set({ fromDate: e.target.value })}
                />
              </Field>
              <Field label="Đến ngày" htmlFor="toDate">
                <Input
                  id="toDate"
                  type="date"
                  value={form.toDate}
                  min={form.fromDate === '' ? undefined : form.fromDate}
                  onChange={(e) => set({ toDate: e.target.value })}
                />
              </Field>

              {/* Ô chọn chỉ liệt kê giá trị CÓ THẬT trong nhật ký, kèm số lượng. Liệt kê
                  cả danh mục thì phần lớn dòng lọc ra rỗng, và người dùng phải thử từng
                  cái mới biết cái nào có dữ liệu. */}
              <Field label="Người thao tác" htmlFor="actorId">
                <Select
                  id="actorId"
                  value={form.actorId}
                  onChange={(e) => set({ actorId: e.target.value })}
                >
                  <option value="">— Tất cả —</option>
                  {(facets.data?.actors ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({a.count})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Hành động" htmlFor="action">
                <Select
                  id="action"
                  value={form.action}
                  onChange={(e) => set({ action: e.target.value })}
                >
                  <option value="">— Tất cả —</option>
                  {(facets.data?.actions ?? [])
                    /* Sắp theo NHÃN tiếng Việt, không theo mã: người dùng đọc nhãn nên
                       thứ tự phải theo cái họ đọc. */
                    .slice()
                    .sort((a, b) => actionLabel(a.code).localeCompare(actionLabel(b.code), 'vi'))
                    .map((a) => (
                      <option key={a.code} value={a.code}>
                        {actionLabel(a.code)} ({a.count})
                      </option>
                    ))}
                </Select>
              </Field>

              <Field label="Loại đối tượng" htmlFor="entityType">
                <Select
                  id="entityType"
                  value={form.entityType}
                  onChange={(e) => set({ entityType: e.target.value })}
                >
                  <option value="">— Tất cả —</option>
                  {(facets.data?.entityTypes ?? []).map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label} ({t.count})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Kết quả" htmlFor="result">
                <Select
                  id="result"
                  value={form.result}
                  onChange={(e) => set({ result: e.target.value })}
                >
                  <option value="">— Tất cả —</option>
                  {(facets.data?.results ?? []).map((r) => (
                    <option key={r.code} value={r.code}>
                      {resultLabel(r.code).label} ({r.count})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời điểm</TableHead>
            <TableHead>Ai</TableHead>
            <TableHead>Hành động</TableHead>
            <TableHead>Đối tượng</TableHead>
            <TableHead>Kết quả</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending && error === null ? <TableSkeleton rows={6} cols={5} /> : null}

          {unauthenticated ? (
            <TableMessage colSpan={5}>
              <EmptyState
                icon={ShieldCheck}
                title="Cần đăng nhập để xem nhật ký audit"
                action={
                  <Link
                    href="/login"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Đăng nhập
                  </Link>
                }
              />
            </TableMessage>
          ) : null}

          {data !== undefined && data.data.length === 0 ? (
            <TableMessage colSpan={5}>
              {/* Phân biệt "nhật ký rỗng" với "bộ lọc không khớp" — hai chuyện khác nhau,
                  và gộp lại thì người dùng tưởng hệ chưa ghi gì. */}
              <EmptyState
                icon={ShieldCheck}
                title={activeCount > 0 ? 'Không có sự kiện khớp bộ lọc' : 'Chưa có sự kiện audit'}
                description={
                  activeCount > 0
                    ? 'Nới bộ lọc hoặc bấm "Xoá lọc" để xem lại toàn bộ.'
                    : 'Nhật ký sẽ tự đầy lên khi có người thao tác trên hệ thống.'
                }
              />
            </TableMessage>
          ) : null}

          {data?.data.map((e) => {
            const time = formatAuditTime(e.occurredAt);
            const result = resultLabel(e.result);
            return (
              <TableRow key={e.id}>
                {/* Giờ địa phương để đọc; mốc ISO tuyệt đối trong `title` để đối chiếu
                    với log máy chủ. */}
                <TableCell
                  className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                  title={time.iso}
                >
                  {time.display}
                </TableCell>
                <TableCell>
                  {/* Email người thao tác. Tra không ra (tài khoản đã xoá, hoặc ghế máy)
                      thì hiện loại chủ thể — đừng để trống, dòng nào cũng phải quy được
                      trách nhiệm về một chỗ. */}
                  {e.actorLabel !== null ? (
                    <span className="font-medium">{e.actorLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">{actorTypeLabel(e.actorType)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={actionVariant(e.action)}>{actionLabel(e.action)}</Badge>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{e.entityLabel}</span>
                  <span className="block text-xs text-muted-foreground">{e.entityTypeLabel}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={result.variant}>{result.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {data !== undefined && data.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {data.total.toLocaleString('vi-VN')} sự kiện
            {activeCount > 0 ? ' khớp bộ lọc' : ''} · trang {data.page}/{totalPages}
            {isFetching ? ' · đang tải…' : ''}
          </p>

          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              aria-label="Số dòng mỗi trang"
              className="w-auto"
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} dòng/trang
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Trước
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
