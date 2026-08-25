'use client';

import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCemetery,
  createCompany,
  createGravePlot,
  createGraveType,
  createHold,
  listCemeteries,
  listCompanies,
  listGravePlots,
  listGraveTypes,
  listHolds,
  releaseHold,
  searchCustomers,
} from '@/lib/api';
import { statusOf } from '@/lib/status';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

export default function GravesPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [holdCustomerId, setHoldCustomerId] = useState('');

  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  const cemeteries = useQuery({
    queryKey: ['cemeteries', companyId],
    queryFn: () => listCemeteries(companyId),
    enabled: companyId !== '',
  });
  const graveTypes = useQuery({
    queryKey: ['graveTypes', companyId],
    queryFn: () => listGraveTypes(companyId),
    enabled: companyId !== '',
  });
  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const customers = useQuery({ queryKey: ['customers', ''], queryFn: () => searchCustomers('') });

  const refetchPlots = () => void qc.invalidateQueries({ queryKey: ['gravePlots', companyId] });

  // inline form states
  const [company, setCompany] = useState({ code: '', name: '' });
  const [cem, setCem] = useState({ code: '', name: '' });
  const [gt, setGt] = useState({ code: '', name: '', cap: '1' });
  const [plot, setPlot] = useState({ cemeteryId: '', graveTypeId: '', plotCode: '' });

  const mCompany = useMutation({
    mutationFn: () => createCompany(company.code, company.name),
    onSuccess: (c) => {
      setCompany({ code: '', name: '' });
      setCompanyId(c.id);
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
  });
  const mCem = useMutation({
    mutationFn: () => createCemetery(companyId, cem.code, cem.name),
    onSuccess: () => {
      setCem({ code: '', name: '' });
      void qc.invalidateQueries({ queryKey: ['cemeteries', companyId] });
    },
  });
  const mGt = useMutation({
    mutationFn: () => createGraveType(companyId, gt.code, gt.name, Number(gt.cap) || 1),
    onSuccess: () => {
      setGt({ code: '', name: '', cap: '1' });
      void qc.invalidateQueries({ queryKey: ['graveTypes', companyId] });
    },
  });
  const mPlot = useMutation({
    mutationFn: () => createGravePlot({ companyId, ...plot }),
    onSuccess: () => {
      setPlot({ cemeteryId: '', graveTypeId: '', plotCode: '' });
      refetchPlots();
    },
  });
  const mHold = useMutation({
    mutationFn: (gravePlotId: string) => createHold(gravePlotId, holdCustomerId),
    onSuccess: refetchPlots,
  });
  const mRelease = useMutation({
    mutationFn: async (gravePlotId: string) => {
      const active = await listHolds(gravePlotId, 'Active');
      const hold = active[0];
      if (hold !== undefined) await releaseHold(hold.id);
    },
    onSuccess: refetchPlots,
  });

  return (
    <section className="space-y-6">
      <PageHeader title="Sơ đồ / Danh sách mộ" description="Danh mục nghĩa trang và vị trí mộ." />

      <Card>
        <CardHeader>
          <CardTitle>Công ty</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Đang làm việc với" htmlFor="companyId" className="w-64">
            <Select id="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— chọn công ty —</option>
              {companies.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-wrap items-end gap-2 border-l border-border pl-3">
            <Field label="Mã CT" htmlFor="newCompanyCode" className="w-28">
              <Input
                id="newCompanyCode"
                value={company.code}
                onChange={(e) => setCompany({ ...company, code: e.target.value })}
              />
            </Field>
            <Field label="Tên công ty mới" htmlFor="newCompanyName" className="w-56">
              <Input
                id="newCompanyName"
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: e.target.value })}
              />
            </Field>
            <Button
              variant="outline"
              onClick={() => mCompany.mutate()}
              loading={mCompany.isPending}
            >
              Tạo công ty
            </Button>
          </div>
        </CardContent>
      </Card>

      {companyId === '' ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="Chưa chọn công ty"
            description="Chọn công ty ở trên để xem danh mục và danh sách mộ."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  Nghĩa trang
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({cemeteries.data?.length ?? 0})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-2">
                <Field label="Mã" htmlFor="cemCode" className="w-24">
                  <Input
                    id="cemCode"
                    value={cem.code}
                    onChange={(e) => setCem({ ...cem, code: e.target.value })}
                  />
                </Field>
                <Field label="Tên" htmlFor="cemName" className="min-w-40 flex-1">
                  <Input
                    id="cemName"
                    value={cem.name}
                    onChange={(e) => setCem({ ...cem, name: e.target.value })}
                  />
                </Field>
                <Button variant="outline" onClick={() => mCem.mutate()} loading={mCem.isPending}>
                  Thêm
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  Loại mộ
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({graveTypes.data?.length ?? 0})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-2">
                <Field label="Mã" htmlFor="gtCode" className="w-24">
                  <Input
                    id="gtCode"
                    value={gt.code}
                    onChange={(e) => setGt({ ...gt, code: e.target.value })}
                  />
                </Field>
                <Field label="Tên" htmlFor="gtName" className="min-w-32 flex-1">
                  <Input
                    id="gtName"
                    value={gt.name}
                    onChange={(e) => setGt({ ...gt, name: e.target.value })}
                  />
                </Field>
                <Field label="Sức chứa" htmlFor="gtCap" className="w-24">
                  <Input
                    id="gtCap"
                    inputMode="numeric"
                    value={gt.cap}
                    onChange={(e) => setGt({ ...gt, cap: e.target.value })}
                  />
                </Field>
                <Button variant="outline" onClick={() => mGt.mutate()} loading={mGt.isPending}>
                  Thêm
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Thêm vị trí mộ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Nghĩa trang" htmlFor="plotCem" className="w-44">
                  <Select
                    id="plotCem"
                    value={plot.cemeteryId}
                    onChange={(e) => setPlot({ ...plot, cemeteryId: e.target.value })}
                  >
                    <option value="">— chọn —</option>
                    {cemeteries.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Loại mộ" htmlFor="plotType" className="w-44">
                  <Select
                    id="plotType"
                    value={plot.graveTypeId}
                    onChange={(e) => setPlot({ ...plot, graveTypeId: e.target.value })}
                  >
                    <option value="">— chọn —</option>
                    {graveTypes.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Mã mộ" htmlFor="plotCode" className="w-44">
                  <Input
                    id="plotCode"
                    value={plot.plotCode}
                    onChange={(e) => setPlot({ ...plot, plotCode: e.target.value })}
                  />
                </Field>
                <Button variant="outline" onClick={() => mPlot.mutate()} loading={mPlot.isPending}>
                  Thêm mộ
                </Button>
              </div>
              {mPlot.error !== null ? (
                <Alert variant="destructive" title="Không thêm được vị trí mộ">
                  {(mPlot.error as Error).message}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danh sách mộ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-0 pb-0">
              <div className="px-5">
                <Field
                  label="Khách giữ chỗ"
                  htmlFor="holdCustomer"
                  className="w-80"
                  hint="Chọn khách trước, rồi bấm “Giữ chỗ” ở dòng mộ còn trống."
                >
                  <Select
                    id="holdCustomer"
                    value={holdCustomerId}
                    onChange={(e) => setHoldCustomerId(e.target.value)}
                  >
                    <option value="">— chọn khách —</option>
                    {customers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.customerCode} · {c.person?.fullName ?? c.orgName ?? ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Table containerClassName="rounded-none border-0 border-t shadow-none">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã mộ</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead align="right">Sức chứa</TableHead>
                    <TableHead align="right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plots.isPending ? <TableSkeleton rows={5} cols={4} /> : null}

                  {plots.data?.length === 0 ? (
                    <TableMessage colSpan={4}>
                      <EmptyState
                        icon={Landmark}
                        title="Chưa có vị trí mộ"
                        description="Thêm nghĩa trang và loại mộ ở trên, rồi tạo vị trí mộ đầu tiên."
                      />
                    </TableMessage>
                  ) : null}

                  {plots.data?.map((p) => {
                    const s = statusOf(p.status);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.plotCode}</TableCell>
                        <TableCell>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </TableCell>
                        <TableCell align="right">{p.effectiveCapacity}</TableCell>
                        <TableCell align="right">
                          {p.status === 'Available' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={holdCustomerId === '' || mHold.isPending}
                              // Chỉ dòng đang chạy mới quay vòng. `loading` theo
                              // `isPending` trần sẽ làm MỌI dòng cùng quay.
                              loading={mHold.isPending && mHold.variables === p.id}
                              onClick={() => mHold.mutate(p.id)}
                            >
                              Giữ chỗ
                            </Button>
                          ) : null}
                          {p.status === 'Held' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={mRelease.isPending}
                              loading={mRelease.isPending && mRelease.variables === p.id}
                              onClick={() => mRelease.mutate(p.id)}
                            >
                              Trả chỗ
                            </Button>
                          ) : null}
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
