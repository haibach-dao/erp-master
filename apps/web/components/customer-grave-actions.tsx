'use client';

import { useState } from 'react';
import { ArrowLeftRight, Info, Landmark, Plus, Undo2, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { birthOrder, relationshipLabel } from '@/lib/relationship';
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

/* Nhãn quan hệ lấy từ `lib/relationship`, KHÔNG dựng bảng tĩnh riêng ở đây.
 *
 * File này từng giữ một bảng nhãn riêng in ra "Cha/Mẹ"/"Con" trong khi trang khách hàng
 * in "Bố đẻ"/"Con gái" — cùng một quan hệ, hai cách gọi, tuỳ màn hình. Nhãn là một luật
 * hiển thị; luật sống ở hai chỗ thì hai chỗ sẽ lệch. */
function relLabel(
  code: string | null,
  gender: string | null | undefined,
  dateOfBirth: string | null,
  ownerDateOfBirth: string | null,
): string {
  if (code === null || code === '') return '';
  // Anh hay em phải so tuổi với CHỦ MỘ; thiếu ngày sinh thì nhãn lùi về trung tính.
  return relationshipLabel(code, gender, birthOrder(dateOfBirth, ownerDateOfBirth));
}

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
  const [detailPlot, setDetailPlot] = useState<CustomerPlot | null>(null);

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
                  {/* "Sức chứa" một mình trả lời nửa câu hỏi. Người dùng cần biết ĐÃ DÙNG
                      bao nhiêu, không phải chứa được bao nhiêu. */}
                  <TableHead>Cốt đã dùng</TableHead>
                  <TableHead>Người an táng</TableHead>
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
                    <TableCell className="num">
                      {g.capacity === null ? '—' : `${g.occupants.length}/${g.capacity}`}
                    </TableCell>
                    {/* Cột này là câu trả lời cho "an táng xong rồi mà màn hình không đổi gì".
                        In ĐÍCH DANH người nằm trong mộ, kèm cốt số và quan hệ với chủ mộ —
                        một con số đếm thì vẫn bắt người dùng mở hộp thoại ra mới biết là ai. */}
                    <TableCell>
                      {g.occupants.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Chưa có ai</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {g.occupants.map((oc) => (
                            <li key={oc.burialRecordId} className="text-sm leading-snug">
                              <span className="text-xs text-muted-foreground">
                                {oc.slotNumber === null ? 'Chưa rõ cốt' : `Cốt ${oc.slotNumber}`} ·{' '}
                              </span>
                              <span className="font-medium">{oc.fullName}</span>
                              {relLabel(
                                oc.relationshipToOwner,
                                oc.gender,
                                oc.dateOfBirth,
                                customer.person?.dateOfBirth ?? null,
                              ) !== '' ? (
                                <span className="text-xs text-muted-foreground">
                                  {' '}
                                  (
                                  {relLabel(
                                    oc.relationshipToOwner,
                                    oc.gender,
                                    oc.dateOfBirth,
                                    customer.person?.dateOfBirth ?? null,
                                  )}
                                  )
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {/* Đường vào chi tiết là một NÚT riêng, không phải cả dòng bấm được.
                            Dòng này đã chứa bốn nút; lồng nút trong một dòng bấm được thì
                            mỗi cú bấm chạy hai việc, và trình đọc màn hình đọc ra một mớ
                            không phân biệt được. */}
                        <Button variant="ghost" size="sm" onClick={() => setDetailPlot(g)}>
                          <Info className="size-4" aria-hidden />
                          Chi tiết
                        </Button>
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

      {detailPlot !== null ? (
        <PlotDetailDialog plot={detailPlot} onClose={() => setDetailPlot(null)} />
      ) : null}
    </>
  );
}

/* CHI TIẾT MỘT PHẦN MỘ — chỉ ĐỌC, không có nút hành động nào.
 *
 * Cố ý không nhồi "an táng" / "sang tên" / "thu hồi" vào đây: ba việc đó đã có ba nút riêng
 * trên dòng, và một hộp thoại vừa xem vừa làm là chỗ người ta bấm nhầm.
 *
 * Dữ liệu lấy TỪ SERVER (`plotOwnership`), không nhận qua props, dù dòng bảng đã có sẵn
 * `occupants`. Hai lý do:
 *   - `plotOwnership` biết những thứ dòng bảng không biết: cốt nào còn trống, số hồ sơ an
 *     táng chưa có cốt, ngày an táng, chủ mộ đã mất chưa.
 *   - Mở chi tiết là lúc người dùng muốn con số ĐÚNG LÚC NÀY, không phải con số của lần
 *     tải trang trước.
 */
function PlotDetailDialog({ plot, onClose }: { plot: CustomerPlot; onClose: () => void }) {
  const ownership = useQuery({
    queryKey: ['plotOwnership', plot.gravePlotId],
    queryFn: () => getPlotOwnership(plot.gravePlotId),
  });
  const history = useQuery({
    queryKey: ['usageRightHistory', plot.gravePlotId],
    queryFn: () => getUsageRightHistory(plot.gravePlotId),
  });

  const o = ownership.data;
  // `getUsageRightHistory` trả BAO NGOÀI, không phải mảng suông — mở ra một lần ở đây.
  const rows = history.data?.history ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Phần mộ ${plot.plotCode ?? '—'}`}
      description={
        o === undefined
          ? undefined
          : `${o.graveTypeName} · ${o.occupants.length}/${o.capacity} cốt đã dùng`
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="space-y-4">
        {ownership.error !== null ? (
          <Alert variant="destructive">{errText(ownership.error)}</Alert>
        ) : null}

        {o?.holder != null ? (
          <Alert variant="info">
            Chủ mộ: <strong>{o.holder.name ?? '—'}</strong> · {o.holder.customerCode}
            {o.holder.isDeceased ? ' (đã mất)' : ''}
          </Alert>
        ) : null}

        <div>
          <p className="mb-1.5 text-sm font-medium">Người an táng</p>
          {ownership.isPending ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (o?.occupants.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có ai. Dùng “An táng vào cốt” trên dòng phần mộ.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {(o?.occupants ?? []).map((oc) => (
                <li key={oc.burialRecordId} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="text-xs text-muted-foreground">
                        {oc.slotNumber === null ? 'Chưa rõ cốt' : `Cốt ${oc.slotNumber}`} ·{' '}
                      </span>
                      <strong>{oc.fullName}</strong>
                    </span>
                    <Badge variant="neutral">
                      {relLabel(
                        oc.relationshipToOwner,
                        oc.gender,
                        oc.dateOfBirth,
                        o?.holder?.dateOfBirth ?? null,
                      ) || 'Có quan hệ'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {oc.burialDate === null
                      ? 'Chưa ghi ngày an táng'
                      : `An táng ${new Date(oc.burialDate).toLocaleDateString('vi-VN')}`}
                    {' · '}
                    {statusOf(oc.status).label}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cốt trống là con số quyết định "còn an táng thêm được không". Lấy từ server, không
            tính lại ở đây: sức chứa có thể bị ghi đè trên từng mộ, và hồ sơ chưa gán cốt vẫn
            chiếm chỗ thật. */}
        {o !== undefined ? (
          <p className="text-sm text-muted-foreground">
            {o.freeSlots.length === 0
              ? `Đã kín ${o.capacity}/${o.capacity} cốt.`
              : `Cốt còn trống: ${o.freeSlots.join(', ')}`}
          </p>
        ) : null}

        {o !== undefined && o.unnumberedBurials > 0 ? (
          <Alert variant="warning">
            Có {o.unnumberedBurials} hồ sơ an táng CHƯA gán cốt số. Chúng vẫn chiếm chỗ, nên số
            cốt trống ở trên đã trừ đi rồi.
          </Alert>
        ) : null}

        <div>
          <p className="mb-1.5 text-sm font-medium">Lịch sử chủ mộ</p>
          {history.isPending ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có bản ghi nào.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {rows.map((h) => (
                <li key={h.usageRightId} className="flex justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <strong>{h.holderName ?? '—'}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {h.holderCode ?? '—'}
                      {/* Quyền sinh NGOÀI hợp đồng phải đọc ra được: không có nhãn này thì
                          không ai phân biệt quyền nào đã qua thẩm định. */}
                      {h.viaContract ? ' · theo hợp đồng' : ' · gán tay'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {statusOf(h.status).label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
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

  /* MỘT nguồn cho "vì sao nút An táng không bấm được", và nó LUÔN được in ra.
   *
   * LỖI ĐÃ TRẢ GIÁ (27/08/2026): nút bị chặn bởi `personId === ''` — chưa chọn ai — nhưng
   * điều kiện đó không đi qua cơ chế giải thích nào cả. Kết quả: hộp thoại mở ra với đúng
   * một ứng viên hiện sẵn, nút xám, và không một chữ nói vì sao. Chủ doanh nghiệp hỏi
   * "sao cái nút An táng không sáng vậy" — câu hỏi đó là bằng chứng giao diện đã hỏng, chứ
   * không phải người dùng đọc chưa kỹ.
   *
   * Tách làm hai vì hai thứ khác nhau, không phải để cho có:
   *   - `blocked`        : trở ngại THẬT (chưa có chủ mộ, mộ đã kín) -> Alert cảnh báo
   *   - `disabledReason` : gồm cả `blocked` LẪN "chưa chọn người" -> dòng nhắc cạnh nút
   *
   * "Chưa chọn người" KHÔNG dựng Alert cảnh báo: đó là trạng thái bình thường lúc vừa mở,
   * báo động ở đó là dạy người dùng bỏ qua cảnh báo. Nhưng nó VẪN phải hiện ra chữ. */
  const disabledReason =
    blocked ??
    (personId === '' ? 'Bấm chọn một người trong danh sách để bật nút An táng.' : null);

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
          {/* `mr-auto` đẩy dòng nhắc sang trái, hai nút vẫn ở phải. Đặt nó TRONG footer chứ
              không ở cuối thân hộp thoại: thân có `overflow-y-auto`, nên câu giải thích sẽ
              cuộn ra khỏi tầm mắt đúng lúc người dùng đang nhìn cái nút xám. */}
          {disabledReason !== null && !bury.isPending ? (
            <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {disabledReason}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            disabled={disabledReason !== null || bury.isPending}
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
                    {relLabel(
                      oc.relationshipToOwner,
                      oc.gender,
                      oc.dateOfBirth,
                      o.holder?.dateOfBirth ?? null,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Field
          label="Chọn người an táng"
          hint={
            eligible.isPending
              ? 'Đang tìm người đủ điều kiện…'
              : `Bấm một dòng để chọn. Danh sách chỉ hiện người ĐÃ MẤT, CÓ QUAN HỆ đã xác nhận với ${eligible.data?.owner?.fullName ?? 'chủ mộ'}, và CHƯA nằm ở cốt nào.`
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
            /* `radiogroup` + `radio`, không phải danh sách nút rời: đây là CHỌN MỘT trong
               nhiều, và trình đọc màn hình phải nghe được "1 trong 3, đã chọn" thay vì ba
               cái nút không liên quan. Nền xám thôi thì không đủ — nó là màu, và màu một
               mình không phải dấu hiệu trạng thái. */
            <ul role="radiogroup" aria-label="Người an táng" className="divide-y divide-border">
              {matches.map((c) => {
                const picked = personId === c.deceasedPersonId;
                return (
                  <li key={c.deceasedPersonId}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => setPersonId(c.deceasedPersonId)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50',
                        picked ? 'bg-accent' : '',
                      )}
                    >
                      {/* Dấu chọn phải THẤY ĐƯỢC ngay cả khi chỉ có MỘT ứng viên: đúng tình
                          huống 27/08/2026 — một dòng duy nhất, không dấu hiệu nào, nên nó
                          nhìn như dòng thông tin chứ không như lựa chọn. */}
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-full border',
                          picked ? 'border-primary' : 'border-input',
                        )}
                      >
                        {picked ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{c.fullName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.customerCode ?? '(chưa có mã KH)'}
                          {c.dateOfDeath !== null
                            ? ` · mất ${new Date(c.dateOfDeath).toLocaleDateString('vi-VN')}`
                            : ' · chưa ghi ngày mất'}
                        </span>
                      </span>
                      <Badge variant={c.isOwner ? 'default' : 'neutral'}>
                        {relLabel(
                          c.relationshipType,
                          c.gender,
                          c.dateOfBirth,
                          eligible.data?.owner?.dateOfBirth ?? null,
                        ) || 'Có quan hệ'}
                      </Badge>
                    </button>
                  </li>
                );
              })}
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
