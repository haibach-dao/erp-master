'use client';

import { useState } from 'react';
import { ArrowLeftRight, Landmark, Plus, Undo2, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignUsageRight,
  createBurial,
  getPlotOwnership,
  getUsageRightHistory,
  releaseUsageRight,
  transferUsageRight,
  type CustomerPlot,
  listCompanies,
  listGravePlots,
  getBurialCandidates,
  searchCustomers,
  type CustomerDetail,
} from '@/lib/api';
import { statusOf } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
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
  TableRow,
} from '@/components/ui/table';

const RELATIONSHIP_LABEL: Record<string, string> = {
  SELF: 'Chính chủ mộ',
  SPOUSE: 'Vợ/Chồng',
  PARENT: 'Cha/Mẹ',
  CHILD: 'Con',
  SIBLING: 'Anh/Chị/Em',
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

export function CustomerGraveActions({
  customer,
  onChanged,
}: {
  customer: CustomerDetail;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [buryPlotId, setBuryPlotId] = useState<string | null>(null);
  const [transferPlot, setTransferPlot] = useState<CustomerPlot | null>(null);
  const [releasePlot, setReleasePlot] = useState<CustomerPlot | null>(null);

  /* Chủ mộ đã mất thì KHÔNG gán thêm mộ được — cùng luật server ép, nhắc lại ở đây để nút
   * không mời người dùng bấm vào một việc chắc chắn bị từ chối. Server vẫn là chỗ ép
   * thật; đây chỉ là phép lịch sự. */
  const isDeceased = customer.person?.deceased != null;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-4" aria-hidden />
              Phần mộ đứng tên
            </CardTitle>
            {isDeceased ? (
              <p className="text-xs text-muted-foreground">
                Khách đã mất — không gán thêm mộ. Chuyển quyền phải qua thủ tục kế thừa.
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isDeceased}
            onClick={() => setAssignOpen(true)}
          >
            <Plus className="size-4" aria-hidden />
            Gán mộ
          </Button>
        </CardHeader>
        <CardContent>
          {customer.gravePlots.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="Chưa đứng tên phần mộ nào"
              description="Bấm “Gán mộ” hoặc cho một hợp đồng hiệu lực."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã mộ</TableHead>
                  <TableHead>Vị trí</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Sức chứa</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.gravePlots.map((g) => (
                  <TableRow key={g.gravePlotId}>
                    <TableCell className="font-mono text-xs">{g.plotCode ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[g.cemeteryName, g.zone, g.block, g.row].filter(Boolean).join(' / ') || '—'}
                    </TableCell>
                    <TableCell>
                      {g.status === null ? (
                        '—'
                      ) : (
                        <Badge variant={statusOf(g.status).variant}>
                          {statusOf(g.status).label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="num">{g.capacity ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setBuryPlotId(g.gravePlotId)}
                        >
                          <UserPlus className="size-4" aria-hidden />
                          An táng vào cốt
                        </Button>
                        {/* Sang tên là đường THỪA KẾ — vẫn bấm được khi chủ đã mất, đó
                            mới là lúc cần nó nhất. */}
                        <Button variant="ghost" size="sm" onClick={() => setTransferPlot(g)}>
                          <ArrowLeftRight className="size-4" aria-hidden />
                          Sang tên
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setReleasePlot(g)}>
                          <Undo2 className="size-4" aria-hidden />
                          Thu hồi
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {assignOpen ? (
        <AssignPlotDialog
          customer={customer}
          onClose={() => setAssignOpen(false)}
          onDone={() => {
            setAssignOpen(false);
            onChanged();
            void qc.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      ) : null}

      {transferPlot !== null ? (
        <TransferDialog
          plot={transferPlot}
          currentOwnerId={customer.id}
          onClose={() => setTransferPlot(null)}
          onDone={() => {
            setTransferPlot(null);
            onChanged();
            void qc.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      ) : null}

      {releasePlot !== null ? (
        <ReleaseDialog
          plot={releasePlot}
          onClose={() => setReleasePlot(null)}
          onDone={() => {
            setReleasePlot(null);
            onChanged();
            void qc.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      ) : null}

      {buryPlotId !== null ? (
        <BuryDialog
          gravePlotId={buryPlotId}
          onClose={() => setBuryPlotId(null)}
          onDone={() => {
            setBuryPlotId(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/* Gán mộ cho chủ mộ.
 *
 * Chọn công ty -> nghĩa trang chỉ là đường đi tới danh sách mộ; server kiểm phạm vi theo
 * MỘ chứ không theo cái client gửi lên, nên chọn sai ở đây chỉ dẫn tới 403 chứ không dẫn
 * tới gán nhầm.
 */
function AssignPlotDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState(customer.companyId ?? '');
  const [gravePlotId, setGravePlotId] = useState('');
  const [note, setNote] = useState('');

  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });

  const assign = useMutation({
    mutationFn: () =>
      assignUsageRight({
        gravePlotId,
        holderCustomerId: customer.id,
        ...(note !== '' ? { note } : {}),
      }),
    onSuccess: onDone,
  });

  /* Chỉ mộ CHƯA có người an táng mới gán chủ được. Mộ `Occupied` mà chưa có chủ là dữ
   * liệu đã lệch — server bắt rà soát, nên đừng mời người dùng chọn nó ở đây. */
  const assignable = (plots.data ?? []).filter((p) => p.status !== 'Occupied');

  return (
    <Dialog
      open
      onClose={onClose}
      title="Gán phần mộ cho chủ mộ"
      description="Đường tắt không qua hợp đồng — mỗi lần gán đều ghi nhật ký."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            disabled={gravePlotId === '' || assign.isPending}
            loading={assign.isPending}
            onClick={() => assign.mutate()}
          >
            Gán mộ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {assign.error !== null ? (
          <Alert variant="destructive">{errText(assign.error)}</Alert>
        ) : null}

        <Alert variant="info">
          Chủ mộ: <strong>{customer.person?.fullName ?? customer.orgName}</strong> ·{' '}
          {customer.customerCode}
        </Alert>

        <Field label="Công ty">
          <Select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setGravePlotId('');
            }}
          >
            <option value="">— Chọn công ty —</option>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Phần mộ"
          hint={
            companyId === ''
              ? 'Chọn công ty trước.'
              : `${assignable.length} phần mộ có thể gán (đã bỏ mộ đang có người an táng).`
          }
        >
          <Select
            value={gravePlotId}
            disabled={companyId === ''}
            onChange={(e) => setGravePlotId(e.target.value)}
          >
            <option value="">— Chọn phần mộ —</option>
            {assignable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.plotCode} — {statusOf(p.status).label} (sức chứa {p.effectiveCapacity})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Lý do gán tay" hint="Chuyển từ hệ cũ, sửa sai, cấp lại sau tranh chấp…">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* An táng một người vào MỘT CỐT cụ thể.
 *
 * Trình tự đúng theo nghiệp vụ: mộ phải có chủ -> người mất phải có quan hệ với chủ ->
 * mới đặt được vào cốt. Hộp thoại này hiện rõ hai điều kiện đầu thay vì để người dùng
 * bấm rồi nhận lỗi: biết trước vì sao chưa làm được thì đỡ hơn biết sau.
 */
function BuryDialog({
  gravePlotId,
  onClose,
  onDone,
}: {
  gravePlotId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [personId, setPersonId] = useState('');
  const [slot, setSlot] = useState('');
  const [burialDate, setBurialDate] = useState('');

  const ownership = useQuery({
    queryKey: ['plotOwnership', gravePlotId],
    queryFn: () => getPlotOwnership(gravePlotId),
  });

  /* Danh sách ứng viên do SERVER quyết, không phải giao diện tự lọc.
   *
   * Ba điều kiện — đã mất, có quan hệ đã xác nhận với chủ mộ (hoặc chính là chủ mộ), chưa
   * nằm ở cốt nào — đều là luật nghiệp vụ mà `createBurial` ép. Trước đây màn hình này
   * liệt kê MỌI khách hàng rồi để server từ chối: mời người dùng chọn một lựa chọn chắc
   * chắn hỏng là bắt họ học luật bằng cách va vào nó.
   *
   * Đặt luật ở một chỗ cũng là để hai bên không lệch: danh sách hiện ra và thứ server
   * chấp nhận luôn là cùng một tập. */
  const eligible = useQuery({
    queryKey: ['burialCandidates', gravePlotId],
    queryFn: () => getBurialCandidates(gravePlotId),
  });

  const matches = (eligible.data?.candidates ?? []).filter((c) =>
    q.trim() === ''
      ? true
      : `${c.fullName} ${c.customerCode ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const selected = matches.find((c) => c.deceasedPersonId === personId);

  const bury = useMutation({
    mutationFn: async () => {
      if (selected === undefined) {
        throw new Error('Chưa chọn người an táng');
      }
      /* KHÔNG lập hồ sơ người mất ở đây nữa: ứng viên đã PHẢI có hồ sơ người mất mới lọt
       * vào danh sách, nên `deceasedPersonId` luôn có sẵn. Người chưa mất thì đánh dấu ở
       * hồ sơ của họ trước — đó là một việc khác, không phải một bước phụ của an táng. */
      return createBurial({
        gravePlotId,
        deceasedPersonId: selected.deceasedPersonId,
        ...(slot !== '' ? { slotNumber: Number(slot) } : {}),
        ...(burialDate !== '' ? { burialDate } : {}),
      });
    },
    onSuccess: onDone,
  });

  const o = ownership.data;
  const blocked =
    o === undefined
      ? 'Đang tải thông tin phần mộ…'
      : o.holder === null
        ? 'Phần mộ chưa có chủ đứng tên. Gán chủ mộ trước khi an táng.'
        : o.freeSlots.length === 0
          ? `Phần mộ đã kín ${o.capacity}/${o.capacity} cốt.`
          : (eligible.data?.blocked ?? null);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`An táng vào ${o?.plotCode ?? 'phần mộ'}`}
      description={
        o === undefined
          ? undefined
          : `${o.graveTypeName} · ${o.occupants.length}/${o.capacity} cốt đã dùng`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            disabled={blocked !== null || personId === '' || bury.isPending}
            loading={bury.isPending}
            onClick={() => bury.mutate()}
          >
            An táng
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {bury.error !== null ? <Alert variant="destructive">{errText(bury.error)}</Alert> : null}
        {blocked !== null ? <Alert variant="warning">{blocked}</Alert> : null}

        {o?.holder != null ? (
          <Alert variant="info">
            Chủ mộ: <strong>{o.holder.name}</strong> · {o.holder.customerCode}
            {o.holder.isDeceased ? ' (đã mất)' : ''}
          </Alert>
        ) : null}

        {o !== undefined && o.occupants.length > 0 ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Đang nằm trong mộ</p>
            <ul className="divide-y divide-border rounded-md border">
              {o.occupants.map((oc) => (
                <li key={oc.burialRecordId} className="flex justify-between px-3 py-2 text-sm">
                  <span>
                    {oc.slotNumber === null ? 'Chưa rõ cốt' : `Cốt ${oc.slotNumber}`} ·{' '}
                    <strong>{oc.fullName}</strong>
                  </span>
                  <span className="text-muted-foreground">
                    {oc.relationshipToOwner === null
                      ? ''
                      : (RELATIONSHIP_LABEL[oc.relationshipToOwner] ?? oc.relationshipToOwner)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Field
          label="Người an táng"
          hint={
            eligible.isPending
              ? 'Đang tìm người đủ điều kiện…'
              : `Chỉ hiện người ĐÃ MẤT, CÓ QUAN HỆ đã xác nhận với ${eligible.data?.owner?.fullName ?? 'chủ mộ'}, và CHƯA nằm ở cốt nào.`
          }
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc theo họ tên hoặc mã KH…"
          />
        </Field>

        <div className="max-h-44 overflow-y-auto rounded-md border">
          {matches.length === 0 ? (
            /* Ba lý do rỗng khác nhau, ba câu khác nhau: chưa tải xong / bộ lọc không
               khớp / thực sự không ai đủ điều kiện. Gộp làm một là để người dùng đoán. */
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {eligible.isPending
                ? 'Đang tải…'
                : q.trim() !== ''
                  ? 'Không ai khớp bộ lọc.'
                  : 'Không ai đủ điều kiện. Khai quan hệ với chủ mộ, và đánh dấu người đó đã mất, trước khi an táng.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {matches.map((c) => (
                <li key={c.deceasedPersonId}>
                  <button
                    type="button"
                    onClick={() => setPersonId(c.deceasedPersonId)}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/50',
                      personId === c.deceasedPersonId ? 'bg-accent' : '',
                    )}
                  >
                    <span>
                      <span className="font-medium">{c.fullName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.customerCode ?? '(chưa có mã KH)'}
                        {c.dateOfDeath !== null
                          ? ` · mất ${new Date(c.dateOfDeath).toLocaleDateString('vi-VN')}`
                          : ' · chưa ghi ngày mất'}
                      </span>
                    </span>
                    <Badge variant={c.isOwner ? 'default' : 'neutral'}>
                      {RELATIONSHIP_LABEL[c.relationshipType ?? ''] ??
                        c.relationshipType ??
                        'Có quan hệ'}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cốt số"
            hint={
              o === undefined
                ? undefined
                : o.freeSlots.length === 0
                  ? 'Hết cốt trống.'
                  : `Còn trống: ${o.freeSlots.join(', ')}`
            }
          >
            <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="">— Chưa xác định —</option>
              {(o?.freeSlots ?? []).map((n) => (
                <option key={n} value={String(n)}>
                  Cốt {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ngày an táng">
            <Input type="date" value={burialDate} onChange={(e) => setBurialDate(e.target.value)} />
          </Field>
        </div>

        {o !== undefined && o.unnumberedBurials > 0 ? (
          <Alert variant="warning">
            {o.unnumberedBurials} hồ sơ trong mộ này chưa mang số cốt (nhập từ trước khi hệ có cột
            đó). Danh sách cốt trống có thể chưa phản ánh đúng thực địa.
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* Thu hồi quyền sử dụng — phần mộ trở về trống.
 *
 * Lý do BẮT BUỘC: thu hồi là tước quyền của một người. Sáu tháng sau nhìn lại mà không có
 * lý do thì không ai nói được vì sao mộ này đổi chủ.
 */
function ReleaseDialog({
  plot,
  onClose,
  onDone,
}: {
  plot: CustomerPlot;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');

  const release = useMutation({
    mutationFn: () => releaseUsageRight(plot.usageRightId, reason),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Thu hồi quyền sử dụng ${plot.plotCode ?? ''}`}
      description="Phần mộ trở về trạng thái trống."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || release.isPending}
            loading={release.isPending}
            onClick={() => release.mutate()}
          >
            Thu hồi
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {release.error !== null ? (
          <Alert variant="destructive">{errText(release.error)}</Alert>
        ) : null}

        <Alert variant="warning">
          Mộ còn hồ sơ an táng thì hệ sẽ TỪ CHỐI — một phần mộ có người nằm mà không ai đứng tên là
          hồ sơ không ai chịu trách nhiệm. Trường hợp đó dùng <strong>Sang tên</strong>.
        </Alert>

        <Field label="Lý do thu hồi" required hint="Ít nhất 3 ký tự. Ghi vào nhật ký vĩnh viễn.">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Khách trả lại mộ / nhập nhầm chủ / huỷ hợp đồng…"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* Sang tên — đường THỪA KẾ.
 *
 * Gán mộ chặn người đã mất đứng tên, nên nếu không có đường này thì mộ của người đã mất
 * kẹt vĩnh viễn ở tên họ. Chủ CŨ được phép đã mất (đó mới là lý do sang tên); chủ MỚI thì
 * phải còn sống.
 */
function TransferDialog({
  plot,
  currentOwnerId,
  onClose,
  onDone,
}: {
  plot: CustomerPlot;
  currentOwnerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [toCustomerId, setToCustomerId] = useState('');
  const [reason, setReason] = useState('');

  const customers = useQuery({ queryKey: ['customers', q], queryFn: () => searchCustomers(q) });
  const history = useQuery({
    queryKey: ['usageRightHistory', plot.gravePlotId],
    queryFn: () => getUsageRightHistory(plot.gravePlotId),
  });

  const transfer = useMutation({
    mutationFn: () => transferUsageRight(plot.usageRightId, { toCustomerId, reason }),
    onSuccess: onDone,
  });

  /* Bỏ chủ hiện tại và người đã mất khỏi danh sách: server chặn cả hai, nên đừng mời
   * người dùng chọn một lựa chọn chắc chắn bị từ chối. */
  const candidates = (customers.data ?? []).filter((c) => c.id !== currentOwnerId && !c.isDeceased);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Sang tên ${plot.plotCode ?? 'phần mộ'}`}
      description="Chuyển quyền đứng tên sang chủ mới. Người an táng trong mộ giữ nguyên."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            disabled={toCustomerId === '' || reason.trim().length < 3 || transfer.isPending}
            loading={transfer.isPending}
            onClick={() => transfer.mutate()}
          >
            Sang tên
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {transfer.error !== null ? (
          <Alert variant="destructive">{errText(transfer.error)}</Alert>
        ) : null}

        <Field label="Tìm chủ mới" hint="Chỉ khách hàng còn sống mới nhận sang tên được.">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Họ tên, mã KH…"
            autoFocus
          />
        </Field>

        <div className="max-h-40 overflow-y-auto rounded-md border">
          {candidates.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {q === '' ? 'Gõ để tìm khách hàng.' : 'Không ai khớp, hoặc người tìm được đã mất.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setToCustomerId(c.id)}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/50',
                      toCustomerId === c.id ? 'bg-accent' : '',
                    )}
                  >
                    <span>
                      <span className="font-medium">{c.person?.fullName ?? c.orgName}</span>
                      <span className="block text-xs text-muted-foreground">{c.customerCode}</span>
                    </span>
                    {toCustomerId === c.id ? <Badge variant="default">Đã chọn</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field
          label="Lý do sang tên"
          required
          hint="Ít nhất 3 ký tự. Thừa kế, chuyển nhượng, sửa sai…"
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Thừa kế sau khi chủ mộ mất…"
          />
        </Field>

        {/* Lịch sử chủ mộ: sang tên là việc lặp lại nhiều lần trên cùng một phần mộ, nên
            người thao tác cần thấy mộ này đã qua tay ai. */}
        {history.data !== undefined && history.data.history.length > 0 ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Lịch sử chủ mộ</p>
            <ul className="divide-y divide-border rounded-md border text-sm">
              {history.data.history.map((h) => (
                <li key={h.usageRightId} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium">{h.holderName ?? h.holderCode}</span>
                    {h.endedReason !== null ? (
                      <span className="block text-xs text-muted-foreground">{h.endedReason}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-start gap-1.5">
                    <Badge variant={h.status === 'Active' ? 'success' : 'neutral'}>
                      {h.status === 'Active'
                        ? 'Đang đứng tên'
                        : h.status === 'Transferred'
                          ? 'Đã sang tên'
                          : 'Đã chấm dứt'}
                    </Badge>
                    {!h.viaContract ? <Badge variant="warning">Gán tay</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
