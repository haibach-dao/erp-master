'use client';

import { useState } from 'react';
import { Check, Download, FileText, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateContract,
  cancelContract,
  addContractParty,
  createContract,
  fileDownloadUrl,
  listContracts,
  listGravePlots,
  searchCustomers,
  uploadFile,
  verifyContract,
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
  /* Huỷ hợp đồng: hỏi lý do rồi mới gọi. Lý do là bắt buộc ở server, nên hỏi ở đây thay
   * vì để người dùng bấm rồi nhận lỗi 400. */
  const mCancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelContract(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['gravePlots'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
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

  // Controlled download: the API issues a short-lived presigned URL only for a
  // clean-scanned file the caller may read (permission enforced server-side).
  const onDownload = async (fileId: string): Promise<void> => {
    const { url } = await fileDownloadUrl(fileId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const err = mCreate.error ?? mParty.error ?? mVerify.error ?? mActivate.error;
  const selected = contracts.data?.find((c) => c.id === selectedId);

  return (
    <section className="space-y-6">
      <PageHeader title="Hợp đồng" description="Hồ sơ hợp đồng gắn với vị trí mộ." />

      <CompanyPicker value={companyId} onChange={setCompanyId} />

      {companyId === '' ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Chưa chọn công ty"
            description="Chọn công ty ở trên để xem danh sách hợp đồng."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Tạo hợp đồng</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="Vị trí mộ"
                  htmlFor="plotId"
                  className="w-52"
                  hint="Chỉ mộ còn trống hoặc đang giữ chỗ."
                >
                  <Select
                    id="plotId"
                    value={form.plotId}
                    onChange={(e) => setForm({ ...form, plotId: e.target.value })}
                  >
                    <option value="">— chọn —</option>
                    {plots.data
                      ?.filter((p) => p.status === 'Available' || p.status === 'Held')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.plotCode} ({statusOf(p.status).label})
                        </option>
                      ))}
                  </Select>
                </Field>

                <Field label="Số HĐ" htmlFor="contractNo" className="w-44">
                  <Input
                    id="contractNo"
                    value={form.contractNo}
                    onChange={(e) => setForm({ ...form, contractNo: e.target.value })}
                  />
                </Field>

                <Field label="Hiệu lực đến" htmlFor="validTo" className="w-44">
                  <Input
                    id="validTo"
                    type="date"
                    value={form.validTo}
                    onChange={(e) => setForm({ ...form, validTo: e.target.value })}
                  />
                </Field>

                <Field label="Giá trị (VND)" htmlFor="totalAmount" className="w-40">
                  <Input
                    id="totalAmount"
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={form.totalAmount}
                    onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Field label="File hợp đồng" htmlFor="contractFile" className="max-w-sm">
                  <Input
                    id="contractFile"
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
                ) : form.fileId !== '' ? (
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <Check className="size-3.5" aria-hidden />
                    File đã tải lên
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={() => mCreate.mutate()}
                  loading={mCreate.isPending}
                >
                  Tạo hợp đồng
                </Button>
              </div>
            </CardContent>
          </Card>

          {err !== null ? (
            <Alert variant="destructive" title="Thao tác không thành công">
              {(err as Error).message}
            </Alert>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Số HĐ</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>File</TableHead>
                <TableHead align="right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.isPending ? <TableSkeleton rows={5} cols={4} /> : null}

              {contracts.data?.length === 0 ? (
                <TableMessage colSpan={4}>
                  <EmptyState
                    icon={FileText}
                    title="Chưa có hợp đồng"
                    description="Tạo hợp đồng đầu tiên bằng biểu mẫu ở trên."
                  />
                </TableMessage>
              ) : null}

              {contracts.data?.map((c) => {
                const s = statusOf(c.status);
                const isSelected = selectedId === c.id;
                return (
                  <TableRow
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    aria-selected={isSelected}
                    className={`cursor-pointer ${
                      isSelected ? 'bg-primary-soft even:bg-primary-soft hover:bg-primary-soft' : ''
                    }`}
                  >
                    <TableCell className="font-mono text-xs">{c.contractNo}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.contractFileId !== null ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDownload(c.contractFileId as string);
                          }}
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
                        {c.status === 'Uploaded' || c.status === 'PendingVerification' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={mVerify.isPending}
                            loading={mVerify.isPending && mVerify.variables === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              mVerify.mutate(c.id);
                            }}
                          >
                            Xác minh
                          </Button>
                        ) : null}
                        {/* Huỷ được ở MỌI trạng thái trừ đã huỷ. Server mới là chỗ chặn
                            thật (mộ đã có người an táng thì từ chối) — ẩn nút theo trạng
                            thái ở đây chỉ làm người dùng không hiểu vì sao không có nút. */}
                        {c.status !== 'Cancelled' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={mCancel.isPending}
                            loading={mCancel.isPending && mCancel.variables?.id === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              const reason = window.prompt(
                                `Huỷ hợp đồng ${c.contractNo}? Nhập lý do (ít nhất 3 ký tự):`,
                              );
                              if (reason !== null && reason.trim().length >= 3) {
                                mCancel.mutate({ id: c.id, reason: reason.trim() });
                              }
                            }}
                          >
                            Huỷ
                          </Button>
                        ) : null}
                        {c.status === 'Verified' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={mActivate.isPending}
                            loading={mActivate.isPending && mActivate.variables === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              mActivate.mutate(c.id);
                            }}
                          >
                            Kích hoạt
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {selectedId !== '' ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Thêm bên ký
                  {selected !== undefined ? (
                    <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                      {selected.contractNo}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <Field label="Khách hàng" htmlFor="partyCustomer" className="w-72">
                  <Select
                    id="partyCustomer"
                    value={party.customerId}
                    onChange={(e) => setParty({ ...party, customerId: e.target.value })}
                  >
                    <option value="">— chọn khách —</option>
                    {customers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.customerCode} · {c.person?.fullName ?? c.orgName ?? ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vai trò" htmlFor="partyRole" className="w-44">
                  <Select
                    id="partyRole"
                    value={party.role}
                    onChange={(e) => setParty({ ...party, role: e.target.value })}
                  >
                    <option value="OWNER">Chủ mộ</option>
                    <option value="SIGNER">Người ký</option>
                    <option value="CONTACT">Liên hệ</option>
                  </Select>
                </Field>
                <Button
                  variant="outline"
                  onClick={() => mParty.mutate()}
                  disabled={party.customerId === ''}
                  loading={mParty.isPending}
                >
                  Thêm bên ký
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </section>
  );
}
