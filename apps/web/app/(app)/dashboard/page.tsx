'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listGravePlots, serviceRevenue } from '@/lib/api';
import { CompanyPicker } from '@/components/company-picker';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {hint !== undefined && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
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

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId === '' ? (
        <p className="text-sm text-muted-foreground">Chọn công ty để xem số liệu.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Tổng vị trí mộ" value={String(plots.data?.length ?? 0)} />
            <Stat label="Còn trống" value={String(byStatus.Available ?? 0)} />
            <Stat label="Đã phân bổ" value={String(byStatus.Allocated ?? 0)} />
            <Stat label="Đã an táng" value={String(byStatus.Occupied ?? 0)} />
            <Stat label="Đang giữ chỗ" value={String(byStatus.Held ?? 0)} />
            <Stat
              label="Doanh thu đã thu"
              value={`${Number(revenue.data?.totalCollected ?? 0).toLocaleString('vi-VN')} đ`}
              hint={`${revenue.data?.transactions ?? 0} giao dịch`}
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">Trạng thái mộ</th>
                  <th className="p-2 text-left font-medium">Số lượng</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byStatus).map(([status, count]) => (
                  <tr key={status} className="border-t border-border">
                    <td className="p-2">{status}</td>
                    <td className="p-2">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
