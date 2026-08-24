'use client';

import { useState } from 'react';
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
import { Button } from '@/components/ui/button';

const inputClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm';

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
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Sơ đồ / Danh sách mộ</h1>

      {/* Company picker + create */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <label className="text-sm">
          Công ty
          <select
            className={`${inputClass} block`}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">— chọn —</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">hoặc tạo mới:</span>
        <input
          className={inputClass}
          placeholder="Mã CT"
          value={company.code}
          onChange={(e) => setCompany({ ...company, code: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="Tên CT"
          value={company.name}
          onChange={(e) => setCompany({ ...company, name: e.target.value })}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => mCompany.mutate()}
          disabled={mCompany.isPending}
        >
          Tạo công ty
        </Button>
      </div>

      {companyId !== '' && (
        <>
          {/* Catalog setup */}
          <div className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-sm font-medium">Nghĩa trang</span>
              <input
                className={inputClass}
                placeholder="Mã"
                value={cem.code}
                onChange={(e) => setCem({ ...cem, code: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Tên"
                value={cem.name}
                onChange={(e) => setCem({ ...cem, name: e.target.value })}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => mCem.mutate()}
                disabled={mCem.isPending}
              >
                Thêm
              </Button>
              <span className="text-xs text-muted-foreground">
                ({cemeteries.data?.length ?? 0})
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-sm font-medium">Loại mộ</span>
              <input
                className={inputClass}
                placeholder="Mã"
                value={gt.code}
                onChange={(e) => setGt({ ...gt, code: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Tên"
                value={gt.name}
                onChange={(e) => setGt({ ...gt, name: e.target.value })}
              />
              <input
                className={`${inputClass} w-20`}
                placeholder="Sức chứa"
                value={gt.cap}
                onChange={(e) => setGt({ ...gt, cap: e.target.value })}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => mGt.mutate()}
                disabled={mGt.isPending}
              >
                Thêm
              </Button>
              <span className="text-xs text-muted-foreground">
                ({graveTypes.data?.length ?? 0})
              </span>
            </div>
          </div>

          {/* Create plot */}
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">Thêm vị trí mộ</span>
            <select
              className={inputClass}
              value={plot.cemeteryId}
              onChange={(e) => setPlot({ ...plot, cemeteryId: e.target.value })}
            >
              <option value="">Nghĩa trang</option>
              {cemeteries.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={plot.graveTypeId}
              onChange={(e) => setPlot({ ...plot, graveTypeId: e.target.value })}
            >
              <option value="">Loại mộ</option>
              {graveTypes.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Mã mộ"
              value={plot.plotCode}
              onChange={(e) => setPlot({ ...plot, plotCode: e.target.value })}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => mPlot.mutate()}
              disabled={mPlot.isPending}
            >
              Thêm mộ
            </Button>
            {mPlot.error !== null && (
              <span className="text-sm text-red-600">{(mPlot.error as Error).message}</span>
            )}
          </div>

          {/* Hold customer picker */}
          <div className="flex items-center gap-2">
            <span className="text-sm">Khách giữ chỗ:</span>
            <select
              className={inputClass}
              value={holdCustomerId}
              onChange={(e) => setHoldCustomerId(e.target.value)}
            >
              <option value="">— chọn khách —</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerCode} · {c.person?.fullName ?? c.orgName ?? ''}
                </option>
              ))}
            </select>
          </div>

          {/* Plots table */}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">Mã mộ</th>
                  <th className="p-2 text-left font-medium">Trạng thái</th>
                  <th className="p-2 text-left font-medium">Sức chứa</th>
                  <th className="p-2 text-left font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {plots.data?.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={4}>
                      Chưa có vị trí mộ.
                    </td>
                  </tr>
                )}
                {plots.data?.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{p.plotCode}</td>
                    <td className="p-2">{p.status}</td>
                    <td className="p-2">{p.effectiveCapacity}</td>
                    <td className="p-2">
                      {p.status === 'Available' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={holdCustomerId === '' || mHold.isPending}
                          onClick={() => mHold.mutate(p.id)}
                        >
                          Giữ chỗ
                        </Button>
                      )}
                      {p.status === 'Held' && (
                        <Button variant="ghost" size="sm" onClick={() => mRelease.mutate(p.id)}>
                          Trả chỗ
                        </Button>
                      )}
                    </td>
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
