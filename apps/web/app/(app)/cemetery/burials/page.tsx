'use client';

import { useState } from 'react';
import { Check, Download, Loader2, ScrollText } from 'lucide-react';
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
    <section className="space-y-6">
      <PageHeader title="An táng" description="Hồ sơ an táng theo từng vị trí mộ." />

      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId === '' ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="Chưa chọn công ty"
            description="Chọn công ty ở trên để lập hồ sơ an táng."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Hồ sơ an táng mới</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="Vị trí mộ"
                  htmlFor="plotId"
                  className="w-52"
                  hint="Chỉ mộ đã phân bổ hoặc đã an táng."
                >
                  <Select
                    id="plotId"
                    value={form.plotId}
                    onChange={(e) => setForm({ ...form, plotId: e.target.value })}
                  >
                    <option value="">— chọn —</option>
                    {plots.data
                      ?.filter((p) => BURIABLE.includes(p.status))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.plotCode} ({statusOf(p.status).label})
                        </option>
                      ))}
                  </Select>
                </Field>

                <Field label="Người mất" htmlFor="personId" className="w-64">
                  <Select
                    id="personId"
                    value={form.personId}
                    onChange={(e) => setForm({ ...form, personId: e.target.value })}
                  >
                    <option value="">— chọn —</option>
                    {customers.data
                      ?.filter((c) => c.person !== null)
                      .map((c) => (
                        <option key={c.id} value={c.person?.id ?? ''}>
                          {c.person?.fullName} · {c.customerCode}
                        </option>
                      ))}
                  </Select>
                </Field>

                <Field label="Ngày an táng" htmlFor="burialDate" className="w-44">
                  <Input
                    id="burialDate"
                    type="date"
                    value={form.burialDate}
                    onChange={(e) => setForm({ ...form, burialDate: e.target.value })}
                  />
                </Field>

                <Field label="Ghi chú" htmlFor="notes" className="min-w-48 flex-1">
                  <Input
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Field label="Giấy tờ pháp lý" htmlFor="legalDoc" className="max-w-sm">
                  <Input
                    id="legalDoc"
                    type="file"
                    className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                </Field>
                {uploading ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Đang tải file…
                  </span>
                ) : form.legalDocFileId !== '' ? (
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <Check className="size-3.5" aria-hidden />
                    Giấy tờ đã tải lên
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={() => mCreate.mutate()}
                  disabled={form.plotId === '' || form.personId === ''}
                  loading={mCreate.isPending}
                >
                  Tạo hồ sơ
                </Button>
              </div>
            </CardContent>
          </Card>

          {err !== null ? (
            <Alert variant="destructive" title="Thao tác không thành công">
              {(err as Error).message}
            </Alert>
          ) : null}

          {form.plotId === '' ? (
            <Card>
              <EmptyState
                icon={ScrollText}
                title="Chọn một vị trí mộ"
                description="Danh sách hồ sơ an táng hiện theo vị trí mộ đang chọn ở trên."
              />
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Người mất</TableHead>
                  <TableHead>Ngày an táng</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Giấy tờ</TableHead>
                  <TableHead align="right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {burials.isPending ? <TableSkeleton rows={4} cols={5} /> : null}

                {burials.data?.length === 0 ? (
                  <TableMessage colSpan={5}>
                    <EmptyState
                      icon={ScrollText}
                      title="Chưa có hồ sơ an táng cho vị trí này"
                      description="Lập hồ sơ bằng biểu mẫu ở trên."
                    />
                  </TableMessage>
                ) : null}

                {burials.data?.map((b) => {
                  const s = statusOf(b.status);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {personLabel(b.deceasedPersonId)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {b.burialDate?.slice(0, 10) ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {b.legalDocFileId !== null ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => void onDownload(b.legalDocFileId as string)}
                          >
                            <Download aria-hidden />
                            Tải
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          {b.status === 'Draft' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={mVerify.isPending}
                              loading={mVerify.isPending && mVerify.variables === b.id}
                              onClick={() => mVerify.mutate(b.id)}
                            >
                              Xác minh
                            </Button>
                          ) : null}
                          {b.status === 'Verified' || b.status === 'Scheduled' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={mComplete.isPending}
                              loading={mComplete.isPending && mComplete.variables === b.id}
                              onClick={() => mComplete.mutate(b.id)}
                            >
                              Hoàn tất
                            </Button>
                          ) : null}
                        </div>
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
