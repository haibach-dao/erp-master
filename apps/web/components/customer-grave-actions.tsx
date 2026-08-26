'use client';

import { useState } from 'react';
import { Landmark, Plus, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignUsageRight,
  createBurial,
  createDeceased,
  getPlotOwnership,
  listCompanies,
  listGravePlots,
  searchPersons,
  type CustomerDetail,
} from '@/lib/api';
import { statusOf } from '@/lib/status';
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBuryPlotId(g.gravePlotId)}
                      >
                        <UserPlus className="size-4" aria-hidden />
                        An táng vào cốt
                      </Button>
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
  const [dateOfDeath, setDateOfDeath] = useState('');
  const [burialDate, setBurialDate] = useState('');

  const ownership = useQuery({
    queryKey: ['plotOwnership', gravePlotId],
    queryFn: () => getPlotOwnership(gravePlotId),
  });

  /* Tìm trong TOÀN BỘ nhân thân, không chỉ người đã có hồ sơ người mất: thực tế là hồ sơ
   * người mất thường được lập ngay lúc làm thủ tục an táng, không phải trước đó. */
  const persons = useQuery({
    queryKey: ['persons', q],
    queryFn: () => searchPersons(q),
  });

  const selected = (persons.data ?? []).find((p) => p.id === personId);

  const bury = useMutation({
    mutationFn: async () => {
      if (selected === undefined) {
        throw new Error('Chưa chọn người an táng');
      }
      /* Chưa có hồ sơ người mất thì lập ngay tại đây. Bắt người dùng sang màn hình khác
       * lập rồi quay lại là chỗ quy trình hay đứt. */
      const deceasedPersonId =
        selected.deceasedPersonId ??
        (
          await createDeceased({
            personId: selected.id,
            ...(dateOfDeath !== '' ? { dateOfDeath } : {}),
          })
        ).id;

      return createBurial({
        gravePlotId,
        deceasedPersonId,
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
          : null;

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

        <Field label="Tìm người an táng" hint="Gõ tên để tìm trong hồ sơ nhân thân.">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Họ tên…" />
        </Field>

        <Field label="Người an táng">
          <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">— Chọn người —</option>
            {(persons.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.isDeceased ? ' (đã có hồ sơ người mất)' : ' (chưa có hồ sơ người mất)'}
              </option>
            ))}
          </Select>
        </Field>

        {/* Chưa có hồ sơ người mất thì lập luôn — hỏi ngày mất ngay tại đây. */}
        {selected !== undefined && !selected.isDeceased ? (
          <Field
            label="Ngày mất"
            hint="Người này chưa có hồ sơ người mất; hệ sẽ lập khi bấm An táng."
          >
            <Input
              type="date"
              value={dateOfDeath}
              onChange={(e) => setDateOfDeath(e.target.value)}
            />
          </Field>
        ) : null}

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
