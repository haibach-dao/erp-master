'use client';

import { useState } from 'react';
import { Lock, Tags } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CUSTOMER_TAG_SUBJECTS,
  CUSTOMER_TAG_SUBJECT_LABEL,
  createCustomerTagType,
  listCustomerTagTypes,
  updateCustomerTagType,
  type CustomerTagType,
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
import { Select } from '@/components/ui/select';
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

/* DANH MỤC THẺ NHÃN CHO KHÁCH HÀNG — trang RIÊNG, tách khỏi thẻ phần mộ.
 *
 * Tách ở giao diện là tầng cuối của một ranh giới đã tách ở mọi tầng dưới: hai bảng danh
 * mục (khoá ngoại không cho thẻ khách chạm tới phần mộ), hai bộ mã quyền, hai nhánh service.
 *
 * Và tách ở đây có một tác dụng riêng mà các tầng dưới không làm được: nó buộc người ta phải
 * ĐI TỚI một trang khác để mở một thẻ dán lên con người. Để chung một trang với thẻ mộ thì
 * hai việc có mức rủi ro khác hẳn nhau đứng cạnh nhau như hai mục ngang hàng, và người mở
 * thẻ mộ hằng ngày sẽ quen tay với cả ô kia.
 */
export default function CustomerTagsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canView = can(user, 'crm.customer_tag.view');
  const canEdit = can(user, 'config.customer_tag.update');
  const [open, setOpen] = useState(false);

  const types = useQuery({
    queryKey: ['customerTagTypes'],
    queryFn: listCustomerTagTypes,
    enabled: canView,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['customerTagTypes'] });
  const toggle = useMutation({
    mutationFn: (t: CustomerTagType) =>
      updateCustomerTagType(t.id, { status: t.status === 'Active' ? 'Retired' : 'Active' }),
    onSuccess: invalidate,
  });

  if (!canView) {
    return (
      <section className="space-y-6">
        <PageHeader title="Thẻ nhãn khách hàng" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền crm.customer_tag.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = types.data ?? [];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Thẻ nhãn khách hàng"
        description="Danh mục thẻ dán lên hồ sơ khách hàng. Dùng chung cho mọi công ty."
        actions={
          <Button disabled={!canEdit} onClick={() => setOpen(true)}>
            Thêm thẻ
          </Button>
        }
      />

      {toggle.error !== null && <Alert variant="destructive">{errText(toggle.error)}</Alert>}

      <Alert variant="warning">
        Thẻ ở đây dán lên một <strong>con người</strong>, mà gia đình họ vừa có người mất. Mỗi thẻ
        bắt buộc khai nó nói về <strong>hồ sơ</strong> (“thiếu CCCD”) hay <strong>giao dịch</strong>{' '}
        (“mua trước chưa an táng”). Thẻ nói về tính cách, sức khoẻ, tôn giáo hay khả năng chi trả{' '}
        <strong>không có ô nào để khai</strong> — cơ sở dữ liệu từ chối, không phải người nhắc nhau.
        <br />
        <span className="text-muted-foreground">
          Thước đo: mọi thẻ ở đây phải chịu được việc đọc to trước mặt chính khách.
        </span>
      </Alert>

      {!canEdit && (
        <Alert variant="info">
          Bạn xem được danh mục nhưng không mở được thẻ mới — cần mã quyền{' '}
          <strong>config.customer_tag.update</strong>. Tách riêng khỏi quyền mở thẻ phần mộ, vì mở
          một thẻ dán lên con người là việc khác hẳn về mức rủi ro.
        </Alert>
      )}

      <Card>
        <CardContent className="px-0 py-0">
          <Table containerClassName="rounded-none border-0 shadow-none">
            <TableHeader>
              <TableRow>
                <TableHead>Thẻ</TableHead>
                <TableHead>Nói về</TableHead>
                {/* Cột TRA CỨU: bấm vào con số là ra danh sách khách đang mang thẻ đó. */}
                <TableHead align="right">Đang gắn</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.isPending ? <TableSkeleton rows={4} cols={5} /> : null}

              {!types.isPending && rows.length === 0 ? (
                <TableMessage colSpan={5}>
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
                  <TableCell className="whitespace-nowrap text-sm">
                    {CUSTOMER_TAG_SUBJECT_LABEL[t.subject] ?? t.subject}
                  </TableCell>
                  <TableCell align="right">
                    <TagCountLink
                      count={t.usageCount}
                      href={`/cemetery/customers?tagTypeId=${encodeURIComponent(t.id)}`}
                      label={`Xem ${t.usageCount} khách hàng mang thẻ ${t.name}`}
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

      {open && <NewCustomerTagDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </section>
  );
}

/* Hộp thoại RIÊNG, không dùng chung với bên thẻ mộ — xem lý do ở `components/tag-admin.tsx`.
 * Điểm khác nhìn thấy được: ô "thẻ này nói về gì" BẮT BUỘC, và lời nhắc cuối biểu mẫu. */
function NewCustomerTagDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createCustomerTagType({
        code: code.trim() === '' ? suggestCode(name) : code.trim(),
        name: name.trim(),
        subject,
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const blocked: string | null =
    name.trim().length < 2
      ? 'chưa nhập tên thẻ.'
      : subject === ''
        ? 'chưa chọn thẻ này nói về hồ sơ hay giao dịch.'
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Thêm thẻ nhãn khách hàng"
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
            placeholder="VD: Thiếu CCCD"
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
            placeholder={name.trim() === '' ? 'thieu-cccd' : suggestCode(name)}
          />
        </Field>

        <Field label="Thẻ này nói về">
          <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">— Chọn —</option>
            {CUSTOMER_TAG_SUBJECTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        {subject !== '' && (
          <p className="text-xs text-muted-foreground">
            {CUSTOMER_TAG_SUBJECTS.find((s) => s.value === subject)?.hint}
          </p>
        )}

        <Field label="Giải thích" hint="Khi nào thì dùng thẻ này — người sau sẽ đọc.">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="VD: hồ sơ chưa có bản sao CCCD của chủ mộ"
          />
        </Field>

        <Alert variant="warning">
          Thẻ này sẽ dán lên một <strong>con người</strong>. Nó phải chịu được việc đọc to trước mặt
          chính khách.
        </Alert>

        {blocked !== null && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Chưa thêm được: {blocked}
          </p>
        )}
      </div>
    </Dialog>
  );
}
