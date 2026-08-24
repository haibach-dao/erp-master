'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  completeBurial,
  createBurial,
  createDeceased,
  fileDownloadUrl,
  listBurials,
  listGravePlots,
  searchCustomers,
  uploadFile,
  verifyBurial,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CompanyPicker } from '@/components/company-picker';

const inputClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm';

// Only Allocated/Occupied plots may receive a burial (M4 rule enforced server-side too).
const BURIABLE = ['Allocated', 'Occupied'];

export default function BurialsPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    plotId: '',
    personId: '',
    burialDate: '',
    legalDocFileId: '',
    notes: '',
  });

  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const customers = useQuery({ queryKey: ['customers', ''], queryFn: () => searchCustomers('') });
  const burials = useQuery({
    queryKey: ['burials', form.plotId],
    queryFn: () => listBurials(form.plotId),
    enabled: form.plotId !== '',
  });

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ['burials', form.plotId] });
    void qc.invalidateQueries({ queryKey: ['gravePlots', companyId] });
  };

  // A burial links a DeceasedPerson, which wraps an existing Person. We create the
  // deceased record on submit from the chosen customer's person, then the burial.
  const mCreate = useMutation({
    mutationFn: async () => {
      const deceased = await createDeceased({ personId: form.personId });
      return createBurial({
        gravePlotId: form.plotId,
        deceasedPersonId: deceased.id,
        ...(form.burialDate !== '' ? { burialDate: form.burialDate } : {}),
        ...(form.legalDocFileId !== '' ? { legalDocFileId: form.legalDocFileId } : {}),
        ...(form.notes !== '' ? { notes: form.notes } : {}),
      });
    },
    onSuccess: () => {
      setForm((f) => ({ ...f, personId: '', burialDate: '', legalDocFileId: '', notes: '' }));
      refetch();
    },
  });
  const mVerify = useMutation({ mutationFn: (id: string) => verifyBurial(id), onSuccess: refetch });
  const mComplete = useMutation({
    mutationFn: (id: string) => completeBurial(id),
    onSuccess: refetch,
  });

  const onFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setUploading(true);
    try {
      const id = await uploadFile(file);
      setForm((f) => ({ ...f, legalDocFileId: id }));
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (fileId: string): Promise<void> => {
    const { url } = await fileDownloadUrl(fileId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const personLabel = (personId: string): string => {
    const c = customers.data?.find((x) => x.person?.id === personId);
    return c?.person?.fullName ?? personId;
  };

  const err = mCreate.error ?? mVerify.error ?? mComplete.error;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">An táng</h1>
      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId !== '' && (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <span className="text-sm font-medium">Hồ sơ an táng</span>
            <select
              className={inputClass}
              value={form.plotId}
              onChange={(e) => setForm({ ...form, plotId: e.target.value })}
            >
              <option value="">Vị trí mộ (đã phân bổ)</option>
              {plots.data
                ?.filter((p) => BURIABLE.includes(p.status))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.plotCode} ({p.status})
                  </option>
                ))}
            </select>
            <select
              className={inputClass}
              value={form.personId}
              onChange={(e) => setForm({ ...form, personId: e.target.value })}
            >
              <option value="">Người mất</option>
              {customers.data
                ?.filter((c) => c.person !== null)
                .map((c) => (
                  <option key={c.id} value={c.person?.id ?? ''}>
                    {c.person?.fullName} · {c.customerCode}
                  </option>
                ))}
            </select>
            <input
              className={inputClass}
              type="date"
              value={form.burialDate}
              onChange={(e) => setForm({ ...form, burialDate: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Ghi chú"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <input
              type="file"
              className="text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <span className="text-xs text-muted-foreground">
              {uploading ? 'Đang tải file…' : form.legalDocFileId !== '' ? '✓ giấy tờ đã tải' : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mCreate.mutate()}
              disabled={form.plotId === '' || form.personId === '' || mCreate.isPending}
            >
              Tạo hồ sơ
            </Button>
          </div>

          {err !== null && <p className="text-sm text-red-600">{(err as Error).message}</p>}

          {form.plotId !== '' && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left font-medium">Người mất</th>
                    <th className="p-2 text-left font-medium">Ngày an táng</th>
                    <th className="p-2 text-left font-medium">Trạng thái</th>
                    <th className="p-2 text-left font-medium">Giấy tờ</th>
                    <th className="p-2 text-left font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {burials.data?.length === 0 && (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={5}>
                        Chưa có hồ sơ an táng cho vị trí này.
                      </td>
                    </tr>
                  )}
                  {burials.data?.map((b) => (
                    <tr key={b.id} className="border-t border-border">
                      <td className="p-2">{personLabel(b.deceasedPersonId)}</td>
                      <td className="p-2">{b.burialDate?.slice(0, 10) ?? '—'}</td>
                      <td className="p-2">{b.status}</td>
                      <td className="p-2">
                        {b.legalDocFileId !== null ? (
                          <button
                            className="text-primary underline"
                            onClick={() => void onDownload(b.legalDocFileId as string)}
                          >
                            Tải
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2 space-x-2">
                        {b.status === 'Draft' && (
                          <Button variant="outline" size="sm" onClick={() => mVerify.mutate(b.id)}>
                            Xác minh
                          </Button>
                        )}
                        {(b.status === 'Verified' || b.status === 'Scheduled') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => mComplete.mutate(b.id)}
                          >
                            Hoàn tất
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
