'use client';

import { useState } from 'react';
import { IdCard, Printer } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  issueGraveCard,
  listCardIssuances,
  previewGraveCard,
  reprintGraveCard,
  searchCustomers,
  type GraveCard,
} from '@/lib/api';
import { GraveCardSheets } from '@/components/grave-card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessage,
  TableRow,
} from '@/components/ui/table';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

export default function GraveCardsPage() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedTitle, setApprovedTitle] = useState('PHÓ GIÁM ĐỐC');
  const [printReason, setPrintReason] = useState('');
  /* Thẻ đang hiện trên màn hình. Giữ ở state chứ không lấy thẳng từ query vì nó đến từ ba
   * nguồn khác nhau — xem trước, vừa cấp, in lại — và ba nguồn đó không cùng khoá cache. */
  const [card, setCard] = useState<GraveCard | null>(null);

  const customers = useQuery({ queryKey: ['customers', ''], queryFn: () => searchCustomers('') });
  const issuances = useQuery({
    queryKey: ['cardIssuances', customerId],
    queryFn: () => listCardIssuances(customerId),
    enabled: customerId !== '',
  });

  const preview = useMutation({
    mutationFn: () => previewGraveCard(customerId),
    onSuccess: setCard,
  });

  const issue = useMutation({
    mutationFn: () =>
      issueGraveCard(customerId, {
        ...(printReason !== '' ? { printReason } : {}),
        ...(approvedBy !== '' ? { approvedBy } : {}),
        ...(approvedTitle !== '' ? { approvedTitle } : {}),
      }),
    onSuccess: (issued) => {
      setCard(issued);
      void qc.invalidateQueries({ queryKey: ['cardIssuances', customerId] });
    },
  });

  const reprint = useMutation({
    mutationFn: (logId: string) => reprintGraveCard(logId),
    onSuccess: setCard,
  });

  const busy = preview.isPending || issue.isPending || reprint.isPending;
  const error = preview.error ?? issue.error ?? reprint.error;

  return (
    <div className="space-y-6">
      <div className="print-hide space-y-6">
        <PageHeader
          title="Thẻ quản lý mộ"
          description="Xem trước không cấp số. Chỉ nút Cấp thẻ mới tăng lần cấp và ghi nhật ký."
        />

        {error !== null && <Alert variant="destructive">{errText(error)}</Alert>}

        <Card>
          <CardHeader>
            <CardTitle>Chọn chủ mộ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Khách hàng">
                <Select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setCard(null);
                  }}
                >
                  <option value="">— Chọn khách hàng —</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.customerCode} — {c.person?.fullName ?? c.orgName ?? '(chưa có tên)'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lý do cấp">
                <Input
                  value={printReason}
                  onChange={(e) => setPrintReason(e.target.value)}
                  placeholder="Cấp lần đầu / Đổi thông tin / Mất thẻ"
                />
              </Field>
              <Field label="Người ký">
                <Input
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  placeholder="Họ tên người ký trên thẻ"
                />
              </Field>
              <Field label="Chức danh người ký">
                <Input value={approvedTitle} onChange={(e) => setApprovedTitle(e.target.value)} />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={customerId === '' || busy}
                onClick={() => preview.mutate()}
              >
                Xem trước
              </Button>
              <Button
                disabled={customerId === '' || busy}
                onClick={() => issue.mutate()}
                title="Sinh số lần cấp mới và ghi nhật ký"
              >
                Cấp thẻ
              </Button>
              <Button variant="secondary" disabled={card === null} onClick={() => window.print()}>
                <Printer className="mr-1.5 size-4" aria-hidden />
                In
              </Button>
            </div>

            {card !== null && card.issued && (
              <Alert variant="success">
                {card.reprint === true
                  ? `Đang in lại lần cấp ${card.printNumber} — không sinh số mới.`
                  : `Đã cấp thẻ lần ${card.printNumber}. Bấm In để đưa ra máy in.`}
              </Alert>
            )}
            {card !== null && !card.issued && (
              <Alert variant="info">
                Đây là bản xem trước — chưa cấp số. Nếu cấp, thẻ sẽ mang số {card.nextPrintNumber}.
              </Alert>
            )}
          </CardContent>
        </Card>

        {customerId !== '' && (
          <Card>
            <CardHeader>
              <CardTitle>Lịch sử cấp thẻ</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lần cấp</TableHead>
                    <TableHead>Ngày cấp</TableHead>
                    <TableHead>Lý do</TableHead>
                    <TableHead>Người ký</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(issuances.data ?? []).length === 0 ? (
                    <TableMessage colSpan={5}>
                      <EmptyState
                        icon={IdCard}
                        title="Chưa cấp thẻ lần nào"
                        description="Khách hàng này chưa có lần cấp thẻ nào được ghi nhận."
                      />
                    </TableMessage>
                  ) : (
                    (issuances.data ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="num">
                          {String(row.printNumber).padStart(2, '0')}
                        </TableCell>
                        <TableCell>{new Date(row.issuedAt).toLocaleString('vi-VN')}</TableCell>
                        <TableCell>{row.printReason ?? '—'}</TableCell>
                        <TableCell>{row.approvedBy ?? '—'}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => reprint.mutate(row.id)}
                          >
                            In lại
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {card === null && (
          <EmptyState
            icon={IdCard}
            title="Chưa có thẻ nào để hiện"
            description="Chọn một khách hàng rồi bấm Xem trước."
          />
        )}
      </div>

      {card !== null && (
        <div className="overflow-x-auto">
          <GraveCardSheets card={card} />
        </div>
      )}
    </div>
  );
}
