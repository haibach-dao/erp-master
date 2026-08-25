'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listGravePlots, serviceRevenue } from '@/lib/api';
import { CompanyPicker } from '@/components/company-picker';
import { statusOf } from '@/lib/status';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessage,
  TableRow,
} from '@/components/ui/table';

/* Ô số liệu. Con số là thứ người ta nhìn trước, nên nó đứng riêng một dòng và
 * dùng tabular-nums để các ô cạnh nhau không so le. */
function Stat({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        )}
        {hint !== undefined && !loading ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [companyId, setCompanyId] = useState('');

  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const revenue = useQuery({
    queryKey: ['revenue', companyId],
    queryFn: () => serviceRevenue(companyId),
    enabled: companyId !== '',
  });

  const byStatus = (plots.data ?? []).reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const total = plots.data?.length ?? 0;
  const loading = plots.isPending || revenue.isPending;

  return (
    <section className="space-y-6">
      <PageHeader title="Dashboard" description="Số liệu theo công ty đang chọn." />

      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId === '' ? (
        <Card>
          <EmptyState
            title="Chưa chọn công ty"
            description="Chọn một công ty ở trên để xem số vị trí mộ và doanh thu."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Tổng vị trí mộ" value={String(total)} loading={loading} />
            <Stat label="Còn trống" value={String(byStatus.Available ?? 0)} loading={loading} />
            <Stat label="Đã phân bổ" value={String(byStatus.Allocated ?? 0)} loading={loading} />
            <Stat label="Đã an táng" value={String(byStatus.Occupied ?? 0)} loading={loading} />
            <Stat label="Đang giữ chỗ" value={String(byStatus.Held ?? 0)} loading={loading} />
            <Stat
              label="Doanh thu đã thu"
              value={`${Number(revenue.data?.totalCollected ?? 0).toLocaleString('vi-VN')} đ`}
              hint={`${revenue.data?.transactions ?? 0} giao dịch`}
              loading={loading}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Mộ theo trạng thái</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table containerClassName="rounded-none border-0 shadow-none">
                <TableHeader>
                  <TableRow>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead align="right">Số lượng</TableHead>
                    <TableHead align="right">Tỷ trọng</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plots.isPending ? <TableSkeleton rows={3} cols={3} /> : null}
                  {!plots.isPending && Object.keys(byStatus).length === 0 ? (
                    <TableMessage colSpan={3}>
                      <EmptyState
                        title="Công ty này chưa có vị trí mộ nào"
                        description="Thêm ở trang Mộ."
                      />
                    </TableMessage>
                  ) : null}
                  {Object.entries(byStatus).map(([status, count]) => {
                    const s = statusOf(status);
                    return (
                      <TableRow key={status}>
                        <TableCell>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </TableCell>
                        <TableCell align="right">{count}</TableCell>
                        <TableCell align="right">
                          {total === 0 ? '—' : `${Math.round((count / total) * 100)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
