'use client';

import { useState } from 'react';
import { Lock, Receipt } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCardFeeSchedule,
  listCardFeeCoverage,
  listCardFeeSchedules,
  type CardFeeSchedule,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* Dòng nào đang có hiệu lực: dòng có `effectiveFrom <= hôm nay` MỚI NHẤT.
 *
 * Bảng không có cột `effectiveTo` — nó append-only, đóng hiệu lực bằng UPDATE thì trigger ở
 * CSDL chặn. Luật này phải khớp đúng `CardFeesService.effectiveSchedule` ở API; lệch nhau là
 * màn hình nói một giá còn hoá đơn thu một giá.
 */
function activeIndex(rows: readonly CardFeeSchedule[]): number {
  const now = today();
  return rows.findIndex((r) => r.effectiveFrom.slice(0, 10) <= now);
}

export default function CardFeesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const allowed = can(user, 'cemetery.card_fee.view');
  const canSetPrice = can(user, 'cemetery.card_fee.set_price');

  const [companyId, setCompanyId] = useState('');
  const [firstIssueFee, setFirstIssueFee] = useState('200000');
  const [reprintFee, setReprintFee] = useState('50000');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [decisionRef, setDecisionRef] = useState('');

  /* Lấy ĐỘ PHỦ chứ không lấy danh sách công ty trơn: ô chọn phải nói ra công ty nào còn
   * thiếu biểu phí và đang giữ bao nhiêu khách. Một danh sách chín cái tên một chữ cái,
   * không kèm gì, là thứ đã khiến 03/09/2026 ban hành nhầm công ty hai lần liền. */
  const coverage = useQuery({ queryKey: ['cardFeeCoverage'], queryFn: listCardFeeCoverage });
  const schedules = useQuery({
    queryKey: ['cardFeeSchedules', companyId],
    queryFn: () => listCardFeeSchedules(companyId),
    enabled: companyId !== '',
  });

  const create = useMutation({
    mutationFn: () =>
      createCardFeeSchedule({
        companyId,
        firstIssueFee: Number(firstIssueFee) || 0,
        reprintFeePerRemains: Number(reprintFee) || 0,
        effectiveFrom,
        ...(decisionRef !== '' ? { decisionRef } : {}),
      }),
    onSuccess: () => {
      setDecisionRef('');
      void qc.invalidateQueries({ queryKey: ['cardFeeSchedules', companyId] });
      /* Làm mới luôn ĐỘ PHỦ — không thì công ty vừa ban hành xong vẫn hiện "chưa có biểu
       * phí" ở ô chọn, và người dùng sẽ ban hành thêm một dòng nữa vì tưởng hụt. */
      void qc.invalidateQueries({ queryKey: ['cardFeeCoverage'] });
    },
  });

  if (!allowed) {
    return (
      <section className="space-y-6">
        <PageHeader title="Biểu phí cấp thẻ mộ" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền cemetery.card_fee.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = schedules.data ?? [];
  const active = activeIndex(rows);

  /* Công ty ĐANG GIỮ KHÁCH mà chưa có biểu phí — đây mới là thứ chặn người thật.
   *
   * Lọc theo `customerCount > 0` là CHỦ Ý: hệ đang có mấy công ty rác từ đợt thử tay, và
   * liệt kê chúng ra sẽ làm danh sách này dài tới mức không ai đọc — đúng cái bệnh mà nó
   * sinh ra để chữa. Công ty rỗng thiếu biểu phí thì không chặn ai; lúc nào nó nhận khách
   * đầu tiên nó sẽ tự hiện lên đây. */
  const missing = (coverage.data ?? []).filter(
    (c) => c.effectiveFrom === null && c.customerCount > 0,
  );

  /* Một chỗ quyết nút có bấm được không, và trả về chính câu giải thích. */
  const blocked: string | null = !canSetPrice
    ? 'cần mã quyền cemetery.card_fee.set_price — ban hành giá tách khỏi người thu tiền.'
    : companyId === ''
      ? 'chưa chọn công ty.'
      : decisionRef === ''
        ? 'chưa nhập số quyết định làm căn cứ.'
        : null;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Biểu phí cấp thẻ mộ"
        description="Cấp giấy lần đầu tính một suất phẳng. Mỗi lần in lại tính theo số cốt của phần mộ."
      />

      {create.error !== null && <Alert variant="destructive">{errText(create.error)}</Alert>}

      <Alert variant="info">
        Biểu phí <strong>chỉ thêm, không sửa và không xoá</strong> — ràng buộc ở tầng cơ sở dữ liệu,
        không phải quy ước. Đổi giá là ban hành một dòng mới với ngày hiệu lực mới; dòng cũ ở lại để
        thẻ đã cấp năm trước vẫn đọc ra đúng giá năm đó, khớp với tờ giấy khách đang cầm.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Chọn công ty</CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label="Công ty"
            hint="Biểu phí gắn theo TỪNG công ty. Ban hành cho công ty không giữ khách nào thì không mở khoá được cho ai."
          >
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— Chọn công ty —</option>
              {(coverage.data ?? []).map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {c.code} — {c.name} · {c.customerCount} khách ·{' '}
                  {c.effectiveFrom === null ? 'CHƯA CÓ BIỂU PHÍ' : 'đã có biểu phí'}
                </option>
              ))}
            </Select>
          </Field>

          {missing.length > 0 && (
            <Alert variant="warning" className="mt-4">
              <span className="block font-medium">
                {missing.length} công ty đang giữ khách nhưng CHƯA có biểu phí — cấp thẻ ở đó sẽ bị
                từ chối:
              </span>
              <ul className="mt-1 space-y-0.5">
                {missing.map((c) => (
                  <li key={c.companyId}>
                    <button
                      type="button"
                      onClick={() => setCompanyId(c.companyId)}
                      className="underline underline-offset-4"
                    >
                      {c.name} ({c.code})
                    </button>{' '}
                    — {c.customerCount} khách đang chờ
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </CardContent>
      </Card>

      {companyId !== '' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Các bản đã ban hành</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hiệu lực từ</TableHead>
                    <TableHead align="right">Cấp giấy lần đầu</TableHead>
                    <TableHead align="right">In lại (mỗi cốt)</TableHead>
                    <TableHead>Căn cứ</TableHead>
                    <TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableMessage colSpan={5}>
                      <EmptyState
                        icon={Receipt}
                        title="Chưa ban hành biểu phí nào"
                        description="Chưa có biểu phí thì hệ TỪ CHỐI cấp thẻ, thay vì âm thầm cấp miễn phí."
                      />
                    </TableMessage>
                  ) : (
                    rows.map((row, i) => (
                      <TableRow key={row.id}>
                        <TableCell className="num">
                          {new Date(row.effectiveFrom).toLocaleDateString('vi-VN')}
                        </TableCell>
                        <TableCell align="right" className="num">
                          {formatMoney(row.firstIssueFee)}
                        </TableCell>
                        <TableCell align="right" className="num">
                          {formatMoney(row.reprintFeePerRemains)}
                        </TableCell>
                        <TableCell>{row.decisionRef ?? '—'}</TableCell>
                        <TableCell>
                          {i === active
                            ? 'Đang hiệu lực'
                            : i < active
                              ? 'Chưa tới ngày'
                              : 'Đã thay thế'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ban hành bản mới</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Cấp giấy lần đầu (đ)" hint="Một suất phẳng, không nhân với số cốt.">
                  <Input
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={firstIssueFee}
                    onChange={(e) => setFirstIssueFee(e.target.value)}
                  />
                </Field>
                <Field label="In lại — mỗi cốt (đ)" hint="Nhân với số cốt của phần mộ.">
                  <Input
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={reprintFee}
                    onChange={(e) => setReprintFee(e.target.value)}
                  />
                </Field>
                <Field label="Hiệu lực từ ngày">
                  <Input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </Field>
                <Field
                  label="Số quyết định làm căn cứ"
                  hint="Bắt buộc: giá thu của khách phải trỏ được về một văn bản hiệu lực."
                >
                  <Input
                    value={decisionRef}
                    onChange={(e) => setDecisionRef(e.target.value)}
                    placeholder="VD: QĐ-2026/ALV-15"
                  />
                </Field>
              </div>

              <Button
                disabled={blocked !== null || create.isPending}
                onClick={() => create.mutate()}
              >
                Ban hành
              </Button>
              {blocked !== null && (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Chưa ban hành được: {blocked}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
