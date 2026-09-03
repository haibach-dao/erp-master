'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CUSTOMER_TAG_SUBJECT_LABEL,
  assignCustomerTag,
  listCustomerTagTypes,
  listCustomerTags,
  removeCustomerTag,
  type CustomerTagType,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

/* THẺ NHÃN CỦA MỘT KHÁCH HÀNG.
 *
 * File RIÊNG, không dùng chung với `plot-tags.tsx`, và điều đó là cố ý ở mọi tầng của tính
 * năng này — hai bảng, hai danh mục, hai bộ mã quyền, hai component. Gộp lại thì cột
 * `subject` (thứ chặn thẻ nói về con người) trở thành một prop tuỳ chọn có thể quên, và
 * đường mã chung sẽ là chỗ đầu tiên ai đó cho thẻ khách đi qua nhánh thẻ mộ.
 *
 * Khác `PlotTagCell` ở hai điểm nhìn thấy được, cả hai đều có lý do:
 *  1. Hiện thành một THẺ (card) trên trang hồ sơ, không phải một ô trong bảng. Danh sách
 *     khách có dòng bấm được cả dòng, nên nút bấm trong ô sẽ tranh chấp với cú bấm ấy.
 *  2. Hiện `subject` cạnh mỗi thẻ. Người gắn phải luôn nhìn thấy thẻ này đang nói về HỒ SƠ
 *     hay GIAO DỊCH — đó là lời nhắc rằng nó không được nói về con người.
 */
export function CustomerTagsCard({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canView = can(user, 'crm.customer_tag.view');
  const canAssign = can(user, 'crm.customer_tag.assign');

  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');

  const tags = useQuery({
    queryKey: ['customerTags', customerId],
    queryFn: () => listCustomerTags(customerId),
    enabled: canView,
  });
  /* Danh mục thẻ KHÁCH — toàn hệ, không tra theo công ty. Bảng riêng, không bao giờ lẫn
   * thẻ mộ vào đây. */
  const types = useQuery({
    queryKey: ['customerTagTypes'],
    queryFn: listCustomerTagTypes,
    enabled: canView,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['customerTags', customerId] });
    /* Danh sách khách có thể đang LỌC theo thẻ, và nó cũng hiện cột thẻ — gắn hay gỡ là đổi
     * cả tập kết quả lẫn nội dung dòng. */
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };

  const add = useMutation({
    mutationFn: () => assignCustomerTag(customerId, pick),
    onSuccess: () => {
      setPick('');
      invalidate();
    },
  });
  const drop = useMutation({
    mutationFn: (tagTypeId: string) =>
      removeCustomerTag(customerId, tagTypeId, reason === '' ? undefined : reason),
    onSuccess: () => {
      setReason('');
      invalidate();
    },
  });

  if (!canView) {
    return null;
  }

  const assigned = tags.data ?? [];
  const assignedIds = new Set(assigned.map((t) => t.tagTypeId));
  const choices: CustomerTagType[] = (types.data ?? []).filter(
    (t) => t.status === 'Active' && !assignedIds.has(t.id),
  );

  /* Một chỗ quyết nút có bấm được không, và trả về chính câu giải thích. */
  const blocked: string | null = !canAssign
    ? 'cần mã quyền crm.customer_tag.assign.'
    : choices.length === 0
      ? 'không còn thẻ nào để gắn — đã gắn hết, hoặc danh mục thẻ khách còn trống.'
      : pick === ''
        ? 'chưa chọn thẻ.'
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Thẻ nhãn
          <span className="ml-2 font-normal text-muted-foreground">({assigned.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(add.error ?? drop.error) !== null && (
          <Alert variant="destructive">{errText(add.error ?? drop.error)}</Alert>
        )}

        <p className="text-sm text-muted-foreground">
          Thẻ khách chỉ nói về <strong>hồ sơ</strong> hoặc <strong>giao dịch</strong> — không nói về
          con người. Gỡ thẻ không xoá dấu vết: hệ vẫn nhớ ai gắn, ai gỡ, lúc nào.
        </p>

        <div className="space-y-2">
          {assigned.length === 0 && (
            <p className="text-sm text-muted-foreground">Khách hàng này chưa mang thẻ nào.</p>
          )}
          {assigned.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* Biến thể trung tính: bảng màu còn lại đang mang nghĩa trạng thái nghiệp
                    vụ, và một thẻ đỏ do người dùng đặt tên sẽ đọc như cảnh báo hệ thống. */}
                <Badge variant="outline">{t.tagType.name}</Badge>
                <span className="text-xs text-muted-foreground">
                  {CUSTOMER_TAG_SUBJECT_LABEL[t.tagType.subject] ?? t.tagType.subject} · gắn ngày{' '}
                  {new Date(t.assignedAt).toLocaleDateString('vi-VN')}
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

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <Field label="Gắn thêm thẻ" className="min-w-56 flex-1">
            <Select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={!canAssign || choices.length === 0}
            >
              <option value="">— Chọn thẻ từ danh mục —</option>
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({CUSTOMER_TAG_SUBJECT_LABEL[t.subject] ?? t.subject})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lý do gỡ" hint="Áp cho lần gỡ tiếp theo" className="min-w-48 flex-1">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canAssign}
              placeholder="VD: đã bổ sung giấy tờ"
            />
          </Field>
          <Button
            variant="outline"
            disabled={blocked !== null}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            Gắn thẻ
          </Button>
        </div>
        {blocked !== null && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Chưa gắn được: {blocked}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* Thẻ đang mang, CHỈ ĐỌC — dùng trong bảng danh sách khách hàng.
 *
 * Không có nút nào, và đó không phải là cắt bớt: dòng trong bảng ấy bấm được cả dòng để mở
 * hồ sơ, nên một cái nút trong ô sẽ tranh chấp với cú bấm đó. Sửa thẻ ở trang hồ sơ.
 *
 * Dữ liệu đến kèm truy vấn danh sách (server `include`), không hỏi thêm lượt nào — 50 dòng
 * mà mỗi dòng một lượt gọi là một bảng nhấp nháy dần.
 */
export function CustomerTagChips({
  tags,
}: {
  tags: readonly { tagTypeId: string; tagType: { name: string; subject: string } }[];
}) {
  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const shown = tags.slice(0, 2);
  const rest = tags.length - shown.length;
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title={tags.map((t) => t.tagType.name).join(', ')}
    >
      {shown.map((t) => (
        <Badge key={t.tagTypeId} variant="outline">
          {t.tagType.name}
        </Badge>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </span>
  );
}
