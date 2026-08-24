'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createServiceCatalog,
  listGravePlots,
  listServiceCatalog,
  listSubscriptions,
  renewSubscription,
  searchCustomers,
  serviceRevenue,
  subscribeService,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CompanyPicker } from '@/components/company-picker';

const inputClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm';
const today = (): string => new Date().toISOString().slice(0, 10);

export default function ServicesPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [cat, setCat] = useState({ code: '', name: '', price: '', durationMonths: '12' });
  const [sub, setSub] = useState({
    plotId: '',
    catalogId: '',
    customerId: '',
    effectiveFrom: today(),
  });

  const catalog = useQuery({
    queryKey: ['catalog', companyId],
    queryFn: () => listServiceCatalog(companyId),
    enabled: companyId !== '',
  });
  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const customers = useQuery({ queryKey: ['customers', ''], queryFn: () => searchCustomers('') });
  const revenue = useQuery({
    queryKey: ['revenue', companyId],
    queryFn: () => serviceRevenue(companyId),
    enabled: companyId !== '',
  });

  const mCat = useMutation({
    mutationFn: () =>
      createServiceCatalog({
        companyId,
        code: cat.code,
        name: cat.name,
        price: Number(cat.price) || 0,
        durationMonths: Number(cat.durationMonths) || 12,
      }),
    onSuccess: () => {
      setCat({ code: '', name: '', price: '', durationMonths: '12' });
      void qc.invalidateQueries({ queryKey: ['catalog', companyId] });
    },
  });
  const subs = useQuery({
    queryKey: ['subscriptions', sub.plotId],
    queryFn: () => listSubscriptions(sub.plotId),
    enabled: sub.plotId !== '',
  });

  const refetchSubs = () => {
    void qc.invalidateQueries({ queryKey: ['subscriptions', sub.plotId] });
    void qc.invalidateQueries({ queryKey: ['revenue', companyId] });
  };

  const mSub = useMutation({
    mutationFn: () =>
      subscribeService({
        companyId,
        gravePlotId: sub.plotId,
        serviceCatalogId: sub.catalogId,
        customerId: sub.customerId,
        effectiveFrom: sub.effectiveFrom,
      }),
    onSuccess: () => {
      setSub((s) => ({ ...s, catalogId: '', customerId: '', effectiveFrom: today() }));
      refetchSubs();
    },
  });
  // Renew extends effectiveTo by the catalog duration and books another full payment (A5).
  const mRenew = useMutation({
    mutationFn: (id: string) => renewSubscription(id),
    onSuccess: refetchSubs,
  });

  const catName = (id: string): string =>
    catalog.data?.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const err = mCat.error ?? mSub.error ?? mRenew.error;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Dịch vụ &amp; Doanh thu</h1>
      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId !== '' && (
        <>
          {/* Revenue KPI */}
          <div className="flex gap-4">
            <div className="rounded-md border border-border p-4">
              <div className="text-xs text-muted-foreground">Doanh thu đã thu</div>
              <div className="text-2xl font-semibold">
                {Number(revenue.data?.totalCollected ?? 0).toLocaleString('vi-VN')} đ
              </div>
              <div className="text-xs text-muted-foreground">
                {revenue.data?.transactions ?? 0} giao dịch
              </div>
            </div>
          </div>

          {/* Catalog */}
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">Gói dịch vụ</span>
            <input
              className={inputClass}
              placeholder="Mã"
              value={cat.code}
              onChange={(e) => setCat({ ...cat, code: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Tên"
              value={cat.name}
              onChange={(e) => setCat({ ...cat, name: e.target.value })}
            />
            <input
              className={`${inputClass} w-32`}
              placeholder="Giá VND"
              value={cat.price}
              onChange={(e) => setCat({ ...cat, price: e.target.value })}
            />
            <input
              className={`${inputClass} w-24`}
              placeholder="Số tháng"
              value={cat.durationMonths}
              onChange={(e) => setCat({ ...cat, durationMonths: e.target.value })}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => mCat.mutate()}
              disabled={mCat.isPending}
            >
              Thêm gói
            </Button>
            <span className="text-xs text-muted-foreground">({catalog.data?.length ?? 0} gói)</span>
          </div>

          {/* Subscribe */}
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">Đăng ký dịch vụ (thu đủ ngay)</span>
            <select
              className={inputClass}
              value={sub.plotId}
              onChange={(e) => setSub({ ...sub, plotId: e.target.value })}
            >
              <option value="">Vị trí mộ</option>
              {plots.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.plotCode}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={sub.catalogId}
              onChange={(e) => setSub({ ...sub, catalogId: e.target.value })}
            >
              <option value="">Gói</option>
              {catalog.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {Number(c.price).toLocaleString('vi-VN')}đ
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={sub.customerId}
              onChange={(e) => setSub({ ...sub, customerId: e.target.value })}
            >
              <option value="">Khách</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerCode}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              type="date"
              value={sub.effectiveFrom}
              onChange={(e) => setSub({ ...sub, effectiveFrom: e.target.value })}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => mSub.mutate()}
              disabled={
                sub.plotId === '' || sub.catalogId === '' || sub.customerId === '' || mSub.isPending
              }
            >
              Đăng ký
            </Button>
          </div>

          {/* Subscriptions of the selected plot + renew */}
          {sub.plotId !== '' && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left font-medium">Gói</th>
                    <th className="p-2 text-left font-medium">Giá</th>
                    <th className="p-2 text-left font-medium">Hiệu lực đến</th>
                    <th className="p-2 text-left font-medium">Trạng thái</th>
                    <th className="p-2 text-left font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.data?.length === 0 && (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={5}>
                        Vị trí này chưa đăng ký dịch vụ nào.
                      </td>
                    </tr>
                  )}
                  {subs.data?.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-2">{catName(s.serviceCatalogId)}</td>
                      <td className="p-2">{Number(s.agreedPrice).toLocaleString('vi-VN')}đ</td>
                      <td className="p-2">{s.effectiveTo?.slice(0, 10) ?? '—'}</td>
                      <td className="p-2">{s.status}</td>
                      <td className="p-2">
                        {s.status === 'Active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => mRenew.mutate(s.id)}
                            disabled={mRenew.isPending}
                          >
                            Gia hạn
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {err !== null && <p className="text-sm text-red-600">{(err as Error).message}</p>}
        </>
      )}
    </section>
  );
}
