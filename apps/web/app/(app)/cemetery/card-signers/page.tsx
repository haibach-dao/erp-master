'use client';

import { useState } from 'react';
import { Lock, PenLine } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCardSigner, listCardSigners, updateCardSigner, type CardSigner } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

/* NGƯỜI KÝ THẺ MỘ — danh mục toàn hệ (anh Bách chốt 03/09/2026).
 *
 * Đây là người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là CHỦ MỘ, tên khách in thẳng
 * từ hồ sơ và KHÔNG nhập ở đâu cả — trang này không đụng tới nó.
 *
 * Không có nút XOÁ, chỉ có "Ngừng dùng": thẻ đã cấp năm ngoái vẫn phải đọc ra được tên người
 * đã ký nó. Cùng nếp với danh mục thẻ nhãn.
 */
export default function CardSignersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canView = can(user, 'cemetery.card_signer.view');
  const canEdit = can(user, 'config.card_signer.update');
  const [open, setOpen] = useState(false);

  const signers = useQuery({
    queryKey: ['cardSigners'],
    queryFn: listCardSigners,
    enabled: canView,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['cardSigners'] });

  const toggle = useMutation({
    mutationFn: (s: CardSigner) =>
      updateCardSigner(s.id, { status: s.status === 'Active' ? 'Retired' : 'Active' }),
    onSuccess: invalidate,
  });
  const setDefault = useMutation({
    mutationFn: (s: CardSigner) => updateCardSigner(s.id, { isDefault: true }),
    onSuccess: invalidate,
  });

  if (!canView) {
    return (
      <section className="space-y-6">
        <PageHeader title="Người ký thẻ mộ" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền cemetery.card_signer.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = signers.data ?? [];
  const active = rows.filter((s) => s.status === 'Active');
  const hasDefault = active.some((s) => s.isDefault);
  const mutError = toggle.error ?? setDefault.error;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Người ký thẻ mộ"
        description="Người của INDEVCO ký ở ô bên phải tờ thẻ. Dùng chung cho mọi công ty."
        actions={
          <Button disabled={!canEdit} onClick={() => setOpen(true)}>
            Thêm người ký
          </Button>
        }
      />

      {mutError != null && <Alert variant="destructive">{errText(mutError)}</Alert>}

      <Alert variant="info">
        Tờ thẻ có <strong>hai ô ký</strong>. Ô bên <strong>trái</strong> là chủ mộ — tên khách in
        thẳng từ hồ sơ, không nhập ở đây. Danh mục này là ô bên <strong>phải</strong>, dưới dòng
        “INDEVCO - XN AN LẠC VIÊN”.
        <br />
        <span className="text-muted-foreground">
          Chỉ ngừng dùng được, không xoá: thẻ đã cấp năm ngoái vẫn phải đọc ra tên người đã ký nó.
        </span>
      </Alert>

      {/* Không có người mặc định thì mỗi lần cấp thẻ đều phải tự chọn — không sai, nhưng là
          việc lặp lại mỗi ngày, nên nói ra thay vì để người dùng tự nhận ra. */}
      {!signers.isPending && active.length > 0 && !hasDefault && (
        <Alert variant="warning">
          Chưa đặt người ký mặc định — màn hình cấp thẻ sẽ để trống ô người ký và nhân viên phải
          chọn mỗi lần. Bấm “Đặt mặc định” ở một dòng bên dưới.
        </Alert>
      )}

      {!canEdit && (
        <Alert variant="info">
          Bạn xem được danh mục nhưng không sửa được — cần mã quyền{' '}
          <strong>config.card_signer.update</strong>. Một dòng mở ở đây in lên thẻ của mọi công ty.
        </Alert>
      )}

      <Card>
        <CardContent className="px-0 py-0">
          <Table containerClassName="rounded-none border-0 shadow-none">
            <TableHeader>
              <TableRow>
                <TableHead>Họ và tên</TableHead>
                <TableHead>Chức danh</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {signers.isPending ? <TableSkeleton rows={3} cols={4} /> : null}

              {!signers.isPending && rows.length === 0 ? (
                <TableMessage colSpan={4}>
                  <EmptyState
                    icon={PenLine}
                    title="Chưa có người ký nào"
                    description="Thêm người ký để nhân viên chọn được ở màn hình cấp thẻ, thay vì gõ tay mỗi lần."
                  />
                </TableMessage>
              ) : null}

              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.fullName}</span>
                    {s.isDefault && (
                      <Badge variant="neutral" className="ml-2">
                        Mặc định
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{s.title}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === 'Active' ? 'neutral' : 'outline'}>
                      {s.status === 'Active' ? 'Đang dùng' : 'Ngừng dùng'}
                    </Badge>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-1">
                      {/* Người đã ngừng dùng KHÔNG đặt mặc định được — ràng buộc ở CSDL từ
                          chối, nên đừng mời người ta bấm một nút chắc chắn hỏng. */}
                      {s.status === 'Active' && !s.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit}
                          loading={setDefault.isPending && setDefault.variables?.id === s.id}
                          onClick={() => setDefault.mutate(s)}
                        >
                          Đặt mặc định
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canEdit}
                        loading={toggle.isPending && toggle.variables?.id === s.id}
                        onClick={() => toggle.mutate(s)}
                      >
                        {s.status === 'Active' ? 'Ngừng dùng' : 'Dùng lại'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && <NewSignerDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </section>
  );
}

function NewSignerDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('PHÓ GIÁM ĐỐC');
  const [isDefault, setIsDefault] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      createCardSigner({ fullName: fullName.trim(), title: title.trim(), isDefault }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  /* Một chỗ quyết nút bấm được không, và trả về CHÍNH câu giải thích. Tách hai thứ đó ra là
   * cách người ta có một nút xám mà không ai nói vì sao. */
  const blocked: string | null =
    fullName.trim().length < 2
      ? 'chưa nhập họ tên.'
      : title.trim() === ''
        ? 'chưa nhập chức danh.'
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Thêm người ký thẻ mộ"
      description="In ở ô bên phải tờ thẻ, dưới dòng INDEVCO - XN AN LẠC VIÊN."
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
            Thêm người ký
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error !== null && <Alert variant="destructive">{errText(create.error)}</Alert>}

        <Field label="Họ và tên">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="VD: Trần Thị B"
          />
        </Field>

        <Field label="Chức danh" hint="In ngay trên chỗ ký. Hệ cũ mặc định PHÓ GIÁM ĐỐC.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Đặt làm người ký mặc định
        </label>
        {isDefault && (
          <p className="text-xs text-muted-foreground">
            Toàn hệ chỉ một người mặc định — người đang giữ vai trò này sẽ được bỏ đánh dấu.
          </p>
        )}

        {blocked !== null && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Chưa thêm được: {blocked}
          </p>
        )}
      </div>
    </Dialog>
  );
}
