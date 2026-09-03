'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IdCard, Printer } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CARD_FEE_WAIVE_REASONS,
  issueGraveCard,
  listCardIssuances,
  previewGraveCard,
  reprintGraveCard,
  searchCustomers,
  type CardFeeQuote,
  type GraveCard,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
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

const FEE_KIND_LABEL: Record<string, string> = {
  FIRST_ISSUE: 'Cấp giấy lần đầu',
  REPRINT: 'In lại',
};

/* BẢNG KÊ TIỀN — một dòng mỗi phần mộ, vì thẻ gom mọi mộ của khách và cùng một lần cấp có
 * thể vừa là lần đầu với mộ này vừa là in lại với mộ kia.
 *
 * In cả `đơn giá × số cốt` chứ không chỉ thành tiền: người ở quầy phải giải thích được con
 * số cho gia đình đang đứng trước mặt, và "150.000đ" thì không giải thích được còn
 * "50.000đ × 3 cốt" thì có. Mọi số đi qua `formatMoney` — nó trả '***' khi người xem không
 * được phép thấy tiền, thay vì 'NaNđ'. */
function FeeTable({ fee }: { fee: CardFeeQuote }) {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Phần mộ</TableHead>
            <TableHead>Bậc giá</TableHead>
            <TableHead align="right">Cách tính</TableHead>
            <TableHead align="right">Thành tiền</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fee.lines.map((line) => (
            <TableRow key={line.gravePlotId}>
              <TableCell>{line.plotCode}</TableCell>
              <TableCell>{FEE_KIND_LABEL[line.feeKind] ?? line.feeKind}</TableCell>
              <TableCell align="right" className="num">
                {line.feeKind === 'FIRST_ISSUE'
                  ? 'một suất, không nhân'
                  : `${formatMoney(line.unitPrice)} × ${line.remainsCount} cốt`}
              </TableCell>
              <TableCell align="right" className="num">
                {formatMoney(line.feeAmount)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={3} className="font-medium">
              Tổng thu
            </TableCell>
            <TableCell align="right" className="num font-semibold">
              {fee.waived === true ? (
                <span className="line-through opacity-60">{formatMoney(fee.totalAmount)}</span>
              ) : (
                formatMoney(fee.totalAmount)
              )}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export default function GraveCardsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  /* Chỉ mời sang trang biểu phí người thực sự ban hành được. Với người khác, một đường dẫn
   * tới màn hình họ chỉ xem được là mách một lối cụt — xem tiêu chí 3 ở
   * [[bach-engineering-standards]] mục 3. */
  const canSetPrice = can(user, 'cemetery.card_fee.set_price');
  const [customerId, setCustomerId] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedTitle, setApprovedTitle] = useState('PHÓ GIÁM ĐỐC');
  const [printReason, setPrintReason] = useState('');
  /* Thẻ đang hiện trên màn hình. Giữ ở state chứ không lấy thẳng từ query vì nó đến từ ba
   * nguồn khác nhau — xem trước, vừa cấp, in lại — và ba nguồn đó không cùng khoá cache. */
  const [card, setCard] = useState<GraveCard | null>(null);
  const [waive, setWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');

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
        ...(waive ? { waive: true, waiveReason } : {}),
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

  /* MỘT chỗ quyết định nút Cấp thẻ có bấm được không, và nó trả về CHÍNH câu giải thích.
   * Tách hai thứ đó ra là cách người ta có một nút xám mà không ai nói vì sao. */
  const issueBlocked: string | null =
    customerId === ''
      ? 'chưa chọn khách hàng.'
      : waive && waiveReason === ''
        ? 'đã chọn miễn phí nhưng chưa nêu lý do.'
        : null;

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
                    /* Reset TIỀN cùng lúc với thẻ. Không reset thì bảng kê của khách trước
                     * còn trên màn hình khi đã chọn khách sau — và nó trông y như tiền của
                     * khách đang chọn. */
                    setCard(null);
                    setWaive(false);
                    setWaiveReason('');
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

            {card !== null && card.fee !== null && (
              <div className="space-y-3">
                <FeeTable fee={card.fee} />
                {!card.issued && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={waive}
                        onChange={(e) => {
                          setWaive(e.target.checked);
                          if (!e.target.checked) setWaiveReason('');
                        }}
                      />
                      Miễn phí lần cấp này
                    </label>
                    {waive && (
                      <Field
                        label="Lý do miễn"
                        hint="Khách làm MẤT thẻ thì vẫn thu — không có trong danh sách này."
                      >
                        <Select
                          value={waiveReason}
                          onChange={(e) => setWaiveReason(e.target.value)}
                        >
                          <option value="">— Chọn lý do —</option>
                          {CARD_FEE_WAIVE_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Câu này do API nói, không phải màn hình tự chế — nó đã gọi TÊN công ty.
                Bản cũ in ra "khách chưa gắn công ty, HOẶC công ty chưa ban hành biểu phí":
                đúng cả hai vế, nhưng người đọc không biết mình dính vế nào nên không biết
                đi sửa ở đâu. 03/09/2026 nó dẫn tới ban hành biểu phí nhầm công ty hai lần. */}
            {card !== null && card.feeBlocked !== null && !card.issued && (
              <Alert variant="warning">
                <span className="block">Chưa tính được phí: {card.feeBlocked}</span>
                {canSetPrice && (
                  <Link
                    href="/cemetery/card-fees"
                    className="mt-1 inline-block font-medium underline underline-offset-4"
                  >
                    Mở trang Phí cấp thẻ mộ →
                  </Link>
                )}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={customerId === '' || busy}
                onClick={() => preview.mutate()}
              >
                Xem trước
              </Button>
              <Button
                disabled={issueBlocked !== null || busy}
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
            {/* Nút bị chặn phải NÓI lý do. Gom về một biểu thức thay vì nhét thêm điều kiện
                vào `disabled`: mỗi lần thêm một điều kiện mà không nói ra là một lần người
                dùng nhìn một cái nút xám không biết vì sao. */}
            {issueBlocked !== null && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Chưa cấp thẻ được: {issueBlocked}
              </p>
            )}

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
