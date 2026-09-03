'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignPlotTag,
  listPlotTagTypes,
  listPlotTags,
  removePlotTag,
  type PlotTagType,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

/* THẺ NHÃN CỦA MỘT PHẦN MỘ — hiện trong ô, và mở được hộp thoại gắn/gỡ.
 *
 * Dùng biến thể `outline` cho mọi thẻ, KHÔNG dùng bảng màu trạng thái: bảy màu kia đang
 * mang nghĩa vòng đời bán (`lib/status.ts`), và một thẻ đỏ do người dùng tự đặt tên sẽ đọc
 * như một cảnh báo của hệ thống. Thẻ là chữ, không phải tín hiệu màu.
 */
export function PlotTagCell({
  gravePlotId,
  companyId,
}: {
  gravePlotId: string;
  /** Chỉ dùng để nạp lại danh sách mộ khi thẻ đổi — danh mục thẻ là toàn hệ, không theo công ty. */
  companyId: string;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const canAssign = can(user, 'cemetery.plot_tag.assign');

  const tags = useQuery({
    queryKey: ['plotTags', gravePlotId],
    queryFn: () => listPlotTags(gravePlotId),
  });

  const assigned = tags.data ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {assigned.map((t) => (
          <Badge key={t.id} variant="outline" title={t.tagType.description ?? undefined}>
            {t.tagType.name}
          </Badge>
        ))}
        {assigned.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {canAssign ? 'Sửa thẻ' : 'Xem thẻ'}
        </Button>
      </div>

      {open && (
        <PlotTagDialog
          gravePlotId={gravePlotId}
          companyId={companyId}
          canAssign={canAssign}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PlotTagDialog({
  gravePlotId,
  companyId,
  canAssign,
  onClose,
}: {
  gravePlotId: string;
  companyId: string;
  canAssign: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');

  const tags = useQuery({
    queryKey: ['plotTags', gravePlotId],
    queryFn: () => listPlotTags(gravePlotId),
  });
  /* Danh mục thẻ MỘ — toàn hệ, không tra theo công ty. Danh mục thẻ KHÁCH là bảng khác và
   * không bao giờ xuất hiện ở đây: ranh giới nằm ở khoá ngoại, không ở một câu lọc. */
  const types = useQuery({ queryKey: ['plotTagTypes'], queryFn: listPlotTagTypes });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['plotTags', gravePlotId] });
    /* Danh sách mộ có thể đang LỌC theo thẻ — gắn hay gỡ là đổi tập kết quả, nên phải nạp
     * lại, nếu không dòng vừa gỡ thẻ vẫn nằm trong một bộ lọc nó không còn thuộc về. */
    void qc.invalidateQueries({ queryKey: ['gravePlots', companyId] });
  };

  const add = useMutation({
    mutationFn: () => assignPlotTag(gravePlotId, pick),
    onSuccess: () => {
      setPick('');
      invalidate();
    },
  });
  const drop = useMutation({
    mutationFn: (tagTypeId: string) =>
      removePlotTag(gravePlotId, tagTypeId, reason === '' ? undefined : reason),
    onSuccess: () => {
      setReason('');
      invalidate();
    },
  });

  const assigned = tags.data ?? [];
  const assignedIds = new Set(assigned.map((t) => t.tagTypeId));
  /* Chỉ mời chọn thẻ ĐANG DÙNG và CHƯA gắn. Server vẫn từ chối cả hai ca — đây là để người
   * dùng không phải bấm mới biết. */
  /* Chỉ mời chọn thẻ ĐANG DÙNG và CHƯA gắn. Server từ chối cả hai ca — đây là để người dùng
   * không phải bấm mới biết. */
  const choices: PlotTagType[] = (types.data ?? []).filter(
    (t) => t.status === 'Active' && !assignedIds.has(t.id),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Thẻ nhãn của phần mộ"
      description="Gỡ thẻ không xoá dấu vết — hệ vẫn nhớ ai gắn, ai gỡ, lúc nào."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="space-y-4">
        {(add.error ?? drop.error) !== null && (
          <Alert variant="destructive">{errText(add.error ?? drop.error)}</Alert>
        )}

        <div className="space-y-2">
          {assigned.length === 0 && (
            <p className="text-sm text-muted-foreground">Phần mộ này chưa mang thẻ nào.</p>
          )}
          {assigned.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 border-b border-border pb-2"
            >
              <div>
                <span className="text-sm font-medium">{t.tagType.name}</span>
                <span className="block text-xs text-muted-foreground">
                  Gắn ngày {new Date(t.assignedAt).toLocaleDateString('vi-VN')}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canAssign}
                loading={drop.isPending && drop.variables === t.tagTypeId}
                onClick={() => drop.mutate(t.tagTypeId)}
              >
                Gỡ
              </Button>
            </div>
          ))}
        </div>

        {canAssign ? (
          <div className="space-y-3 border-t border-border pt-3">
            <Field label="Gắn thêm thẻ">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">— Chọn thẻ từ danh mục —</option>
                {choices.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lý do gỡ" hint="Áp cho lần gỡ tiếp theo. VD: đã sửa xong, gắn nhầm.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button disabled={pick === ''} loading={add.isPending} onClick={() => add.mutate()}>
              Gắn thẻ
            </Button>
            {pick === '' && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {choices.length === 0
                  ? 'Không còn thẻ nào để gắn — mọi thẻ đang dùng đã gắn hết, hoặc danh mục còn trống.'
                  : 'Chưa gắn được: chưa chọn thẻ.'}
              </p>
            )}
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Chỉ xem được. Gắn hoặc gỡ thẻ cần mã quyền cemetery.plot_tag.assign.
          </p>
        )}
      </div>
    </Dialog>
  );
}
