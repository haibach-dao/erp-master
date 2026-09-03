'use client';

import { useState } from 'react';
import { Lock, Tags } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPlotTagType,
  listPlotTagTypes,
  updatePlotTagType,
  type PlotTagType,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import {
  TagCountLink,
  TagNameCell,
  TagStatusCell,
  TagToggleCell,
  errText,
  suggestCode,
} from '@/components/tag-admin';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

/* DANH MỤC THẺ NHÃN CHO PHẦN MỘ — trang RIÊNG, tách khỏi thẻ khách hàng.
 *
 * Tách ở giao diện là tầng cuối của một ranh giới đã tách ở mọi tầng dưới: hai bảng danh
 * mục, hai bộ mã quyền, hai nhánh service. Để chung một trang thì hai thứ có mức rủi ro khác
 * hẳn nhau đứng cạnh nhau như hai mục ngang hàng — và người mở thẻ mộ hằng ngày sẽ quen tay
 * với cả ô mở thẻ dán lên con người.
 *
 * Thẻ mộ nói về một VẬT, nên trang này KHÔNG có ô "thẻ này nói về gì". Không có gì phải rào.
 */
export default function PlotTagsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canView = can(user, 'cemetery.plot_tag.view');
  const canEdit = can(user, 'config.plot_tag.update');
  const [open, setOpen] = useState(false);

  const types = useQuery({
    queryKey: ['plotTagTypes'],
    queryFn: listPlotTagTypes,
    enabled: canView,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['plotTagTypes'] });
  const toggle = useMutation({
    mutationFn: (t: PlotTagType) =>
      updatePlotTagType(t.id, { status: t.status === 'Active' ? 'Retired' : 'Active' }),
    onSuccess: invalidate,
  });

  if (!canView) {
    return (
      <section className="space-y-6">
        <PageHeader title="Thẻ nhãn phần mộ" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền cemetery.plot_tag.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = types.data ?? [];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Thẻ nhãn phần mộ"
        description="Danh mục thẻ dán lên phần mộ. Dùng chung cho mọi công ty."
        actions={
          <Button disabled={!canEdit} onClick={() => setOpen(true)}>
            Thêm thẻ
          </Button>
        }
      />

      {toggle.error !== null && <Alert variant="destructive">{errText(toggle.error)}</Alert>}

      <Alert variant="info">
        Thẻ mộ nói về một <strong>vật</strong>: “cần sửa bia”, “nền lún đọng nước”, “chưa lên sơ
        đồ”. Nó <strong>khác trạng thái mộ</strong> — trạng thái là vị trí trong vòng đời bán và nó
        khoá đường bán; thẻ chỉ tả tình trạng, không khoá gì. Nhờ vậy mới nói được “mộ còn trống{' '}
        <em>nhưng</em> bia nứt”.
      </Alert>

      {!canEdit && (
        <Alert variant="info">
          Bạn xem được danh mục nhưng không mở được thẻ mới — cần mã quyền{' '}
          <strong>config.plot_tag.update</strong>. Tách riêng vì một thẻ mở ở đây dùng được ở mọi
          công ty.
        </Alert>
      )}

      <Card>
        <CardContent className="px-0 py-0">
          <Table containerClassName="rounded-none border-0 shadow-none">
            <TableHeader>
              <TableRow>
                <TableHead>Thẻ</TableHead>
                {/* Cột TRA CỨU: bấm vào con số là ra danh sách mộ đang mang thẻ đó. */}
                <TableHead align="right">Đang gắn</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.isPending ? <TableSkeleton rows={4} cols={4} /> : null}

              {!types.isPending && rows.length === 0 ? (
                <TableMessage colSpan={4}>
                  <EmptyState
                    icon={Tags}
                    title="Chưa có thẻ nào"
                    description='Bấm "Thêm thẻ" để mở thẻ đầu tiên. Người dùng chỉ chọn được thẻ có trong danh mục này.'
                  />
                </TableMessage>
              ) : null}

              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TagNameCell name={t.name} code={t.code} description={t.description} />
                  <TableCell align="right">
                    <TagCountLink
                      count={t.usageCount}
                      href={`/cemetery/graves?tagTypeId=${encodeURIComponent(t.id)}`}
                      label={`Xem ${t.usageCount} phần mộ mang thẻ ${t.name}`}
                    />
                  </TableCell>
                  <TagStatusCell status={t.status} />
                  <TagToggleCell
                    status={t.status}
                    canEdit={canEdit}
                    loading={toggle.isPending && toggle.variables?.id === t.id}
                    onClick={() => toggle.mutate(t)}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && <NewPlotTagDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </section>
  );
}

/* Hộp thoại RIÊNG, không dùng chung với bên thẻ khách — xem lý do ở `components/tag-admin.tsx`.
 * Điểm khác nhìn thấy được: ở đây KHÔNG có ô "thẻ này nói về gì". */
function NewPlotTagDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createPlotTagType({
        code: code.trim() === '' ? suggestCode(name) : code.trim(),
        name: name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const blocked: string | null = name.trim().length < 2 ? 'chưa nhập tên thẻ.' : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Thêm thẻ nhãn phần mộ"
      description="Thẻ dùng chung cho mọi công ty. Chỉ ngừng dùng được về sau, không xoá."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Thôi
          </Button>
          <Button
            disabled={blocked !== null}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Thêm thẻ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error !== null && <Alert variant="destructive">{errText(create.error)}</Alert>}

        <Field label="Tên thẻ">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Cần sửa bia"
          />
        </Field>

        <Field
          label="Mã thẻ"
          hint="Bỏ trống để tự sinh từ tên. Chữ thường, số và gạch ngang — đây là thứ giữ cho VIP/vip/V.I.P không thành ba thẻ."
        >
          <Input
            className="font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={name.trim() === '' ? 'can-sua-bia' : suggestCode(name)}
          />
        </Field>

        <Field label="Giải thích" hint="Khi nào thì dùng thẻ này — người sau sẽ đọc.">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="VD: bia nứt, mờ chữ, cần đưa vào đợt sửa gần nhất"
          />
        </Field>

        {blocked !== null && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Chưa thêm được: {blocked}
          </p>
        )}
      </div>
    </Dialog>
  );
}
