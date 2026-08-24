'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateContract,
  addContractParty,
  createContract,
  listContracts,
  listGravePlots,
  searchCustomers,
  uploadFile,
  verifyContract,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CompanyPicker } from '@/components/company-picker';

const inputClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm';

export default function ContractsPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    plotId: '',
    contractNo: '',
    fileId: '',
    validTo: '',
    totalAmount: '',
  });
  const [party, setParty] = useState({ customerId: '', role: 'OWNER' });

  const contracts = useQuery({
    queryKey: ['contracts', companyId],
    queryFn: () => listContracts(companyId),
    enabled: companyId !== '',
  });
  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const customers = useQuery({ queryKey: ['customers', ''], queryFn: () => searchCustomers('') });

  const refetch = () => void qc.invalidateQueries({ queryKey: ['contracts', companyId] });

  const mCreate = useMutation({
    mutationFn: () =>
      createContract({
        companyId,
        contractNo: form.contractNo,
        gravePlotId: form.plotId,
        ...(form.fileId !== '' ? { contractFileId: form.fileId } : {}),
        ...(form.validTo !== '' ? { validTo: form.validTo } : {}),
        ...(form.totalAmount !== '' ? { totalAmount: Number(form.totalAmount) } : {}),
      }),
    onSuccess: (c) => {
      setSelectedId(c.id);
      setForm({ plotId: '', contractNo: '', fileId: '', validTo: '', totalAmount: '' });
      refetch();
    },
  });
  const mParty = useMutation({
    mutationFn: () => addContractParty(selectedId, party.customerId, party.role),
    onSuccess: refetch,
  });
  const mVerify = useMutation({
    mutationFn: (id: string) => verifyContract(id),
    onSuccess: refetch,
  });
  const mActivate = useMutation({
    mutationFn: (id: string) => activateContract(id),
    onSuccess: () => {
      refetch();
      void qc.invalidateQueries({ queryKey: ['gravePlots', companyId] });
    },
  });

  const onFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setUploading(true);
    try {
      const id = await uploadFile(file);
      setForm((f) => ({ ...f, fileId: id }));
    } finally {
      setUploading(false);
    }
  };

  const err = mCreate.error ?? mParty.error ?? mVerify.error ?? mActivate.error;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Hợp đồng</h1>
      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId !== '' && (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">Tạo hợp đồng</span>
            <select
              className={inputClass}
              value={form.plotId}
              onChange={(e) => setForm({ ...form, plotId: e.target.value })}
            >
              <option value="">Vị trí mộ</option>
              {plots.data
                ?.filter((p) => p.status === 'Available' || p.status === 'Held')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.plotCode} ({p.status})
                  </option>
                ))}
            </select>
            <input
              className={inputClass}
              placeholder="Số HĐ"
              value={form.contractNo}
              onChange={(e) => setForm({ ...form, contractNo: e.target.value })}
            />
            <input
              className={inputClass}
              type="date"
              value={form.validTo}
              onChange={(e) => setForm({ ...form, validTo: e.target.value })}
            />
            <input
              className={`${inputClass} w-32`}
              placeholder="Giá trị VND"
              value={form.totalAmount}
              onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
            />
            <input
              type="file"
              className="text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <span className="text-xs text-muted-foreground">
              {uploading ? 'Đang tải file…' : form.fileId !== '' ? '✓ file đã tải' : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mCreate.mutate()}
              disabled={mCreate.isPending}
            >
              Tạo
            </Button>
          </div>

          {err !== null && <p className="text-sm text-red-600">{(err as Error).message}</p>}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">Số HĐ</th>
                  <th className="p-2 text-left font-medium">Trạng thái</th>
                  <th className="p-2 text-left font-medium">File</th>
                  <th className="p-2 text-left font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {contracts.data?.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={4}>
                      Chưa có hợp đồng.
                    </td>
                  </tr>
                )}
                {contracts.data?.map((c) => (
                  <tr
                    key={c.id}
                    className={`cursor-pointer border-t border-border ${selectedId === c.id ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <td className="p-2 font-mono text-xs">{c.contractNo}</td>
                    <td className="p-2">{c.status}</td>
                    <td className="p-2">{c.contractFileId !== null ? '✓' : '—'}</td>
                    <td className="p-2 space-x-2">
                      {(c.status === 'Uploaded' || c.status === 'PendingVerification') && (
                        <Button variant="outline" size="sm" onClick={() => mVerify.mutate(c.id)}>
                          Xác minh
                        </Button>
                      )}
                      {c.status === 'Verified' && (
                        <Button variant="outline" size="sm" onClick={() => mActivate.mutate(c.id)}>
                          Kích hoạt
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedId !== '' && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <span className="text-sm font-medium">Thêm bên ký (HĐ đã chọn)</span>
              <select
                className={inputClass}
                value={party.customerId}
                onChange={(e) => setParty({ ...party, customerId: e.target.value })}
              >
                <option value="">Khách hàng</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerCode} · {c.person?.fullName ?? c.orgName ?? ''}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={party.role}
                onChange={(e) => setParty({ ...party, role: e.target.value })}
              >
                <option value="OWNER">Chủ mộ</option>
                <option value="SIGNER">Người ký</option>
                <option value="CONTACT">Liên hệ</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => mParty.mutate()}
                disabled={party.customerId === '' || mParty.isPending}
              >
                Thêm bên ký
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
