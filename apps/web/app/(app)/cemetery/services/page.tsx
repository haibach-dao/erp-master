'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
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
import { formatMoney } from '@/lib/money';
import { statusOf } from '@/lib/status';
import { CompanyPicker } from '@/components/company-picker';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
    <section className="space-y-6">
      <PageHeader title="Dịch vụ &amp; Doanh thu" description="Gói dịch vụ, đăng ký và gia hạn." />

      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId === '' ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Chưa chọn công ty"
            description="Chọn công ty ở trên để xem gói dịch vụ và doanh thu."
          />
        </Card>
      ) : (
        <>
          <Card className="max-w-xs">
            <CardContent className="space-y-1 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Doanh thu đã thu
              </p>
              {revenue.isPending ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">
                    {Number(revenue.data?.totalCollected ?? 0).toLocaleString('vi-VN')} đ
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {revenue.data?.transactions ?? 0} giao dịch
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {err !== null ? (
            <Alert variant="destructive" title="Thao tác không thành công">
              {(err as Error).message}
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>
                Gói dịch vụ
                <span className="ml-2 font-normal text-muted-foreground">
                  ({catalog.data?.length ?? 0} gói)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Field label="Mã" htmlFor="catCode" className="w-28">
                <Input
                  id="catCode"
                  value={cat.code}
                  onChange={(e) => setCat({ ...cat, code: e.target.value })}
                />
              </Field>
              <Field label="Tên gói" htmlFor="catName" className="min-w-44 flex-1">
                <Input
                  id="catName"
                  value={cat.name}
                  onChange={(e) => setCat({ ...cat, name: e.target.value })}
                />
              </Field>
              <Field label="Giá (VND)" htmlFor="catPrice" className="w-36">
                <Input
                  id="catPrice"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  value={cat.price}
                  onChange={(e) => setCat({ ...cat, price: e.target.value })}
                />
              </Field>
              <Field label="Số tháng" htmlFor="catDuration" className="w-24">
                <Input
                  id="catDuration"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  value={cat.durationMonths}
                  onChange={(e) => setCat({ ...cat, durationMonths: e.target.value })}
                />
              </Field>
              <Button variant="outline" onClick={() => mCat.mutate()} loading={mCat.isPending}>
                Thêm gói
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Đăng ký dịch vụ</CardTitle>
              {/* Thu đủ ngay là quy tắc nghiệp vụ (A5), không phải chi tiết giao
                  diện — nói thẳng ra để người thu ngân không bị bất ngờ. */}
              <p className="text-sm text-muted-foreground">Đăng ký là ghi nhận thu đủ ngay.</p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Field label="Vị trí mộ" htmlFor="subPlot" className="w-44">
                <Select
                  id="subPlot"
                  value={sub.plotId}
                  onChange={(e) => setSub({ ...sub, plotId: e.target.value })}
                >
                  <option value="">— chọn —</option>
                  {plots.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.plotCode}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Gói" htmlFor="subCatalog" className="w-52">
                <Select
                  id="subCatalog"
                  value={sub.catalogId}
                  onChange={(e) => setSub({ ...sub, catalogId: e.target.value })}
                >
                  <option value="">— chọn —</option>
                  {catalog.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {Number(c.price).toLocaleString('vi-VN')}đ
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Khách" htmlFor="subCustomer" className="w-52">
                <Select
                  id="subCustomer"
                  value={sub.customerId}
                  onChange={(e) => setSub({ ...sub, customerId: e.target.value })}
                >
                  <option value="">— chọn —</option>
                  {customers.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.customerCode} · {c.person?.fullName ?? c.orgName ?? ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hiệu lực từ" htmlFor="subFrom" className="w-44">
                <Input
                  id="subFrom"
                  type="date"
                  value={sub.effectiveFrom}
                  onChange={(e) => setSub({ ...sub, effectiveFrom: e.target.value })}
                />
              </Field>
              <Button
                onClick={() => mSub.mutate()}
                disabled={sub.plotId === '' || sub.catalogId === '' || sub.customerId === ''}
                loading={mSub.isPending}
              >
                Đăng ký
              </Button>
            </CardContent>
          </Card>

          {sub.plotId === '' ? (
            <Card>
              <EmptyState
                icon={Sparkles}
                title="Chọn một vị trí mộ"
                description="Danh sách dịch vụ đã đăng ký hiện theo vị trí mộ đang chọn ở trên."
              />
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gói</TableHead>
                  <TableHead align="right">Giá</TableHead>
                  <TableHead>Hiệu lực đến</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead align="right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.isPending ? <TableSkeleton rows={4} cols={5} /> : null}

                {subs.data?.length === 0 ? (
                  <TableMessage colSpan={5}>
                    <EmptyState
                      icon={Sparkles}
                      title="Vị trí này chưa đăng ký dịch vụ nào"
                      description="Dùng biểu mẫu ở trên để đăng ký gói đầu tiên."
                    />
                  </TableMessage>
                ) : null}

                {subs.data?.map((s) => {
                  const st = statusOf(s.status);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{catName(s.serviceCatalogId)}</TableCell>
                      <TableCell align="right">{formatMoney(s.agreedPrice)}</TableCell>
                      <TableCell className="tabular-nums">
                        {s.effectiveTo?.slice(0, 10) ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        {s.status === 'Active' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={mRenew.isPending}
                            loading={mRenew.isPending && mRenew.variables === s.id}
                            onClick={() => mRenew.mutate(s.id)}
                          >
                            Gia hạn
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}
