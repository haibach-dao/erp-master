'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';

/* Mảnh dùng chung cho HAI trang quản trị thẻ nhãn (thẻ mộ, thẻ khách).
 *
 * RANH GIỚI của việc dùng chung, ghi ra để lần sau không ai nới nó: ở đây CHỈ có những thứ
 * thuần HIỂN THỊ, không mang nghĩa nghiệp vụ nào — một ô tên, một huy hiệu trạng thái, một
 * đường dẫn đếm. Chúng không biết mình đang thuộc danh mục nào và không cần biết.
 *
 * Cái KHÔNG được đưa vào đây: hộp thoại thêm thẻ. Hộp thoại thẻ khách mang cột "nói về gì"
 * — cái rào chặn thẻ nói về con người — và gộp hai hộp thoại lại là biến cột đó thành một
 * prop tuỳ chọn có thể quên. Hai file trang giữ hai hộp thoại riêng, có lặp, và lặp ở đó là
 * cố ý. Xem thêm chú thích cùng ý ở `tags.service.ts` và `tags.controller.ts`.
 */

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

/* Gợi mã từ tên: bỏ dấu, hạ chữ thường, thay khoảng trắng bằng gạch ngang.
 *
 * Chỉ là GỢI Ý — sửa được, và server vẫn ép luật mã bằng regex. Nó ở đây vì mã là thứ duy
 * nhất chặn "VIP"/"vip"/"V.I.P" thành ba thẻ, mà bắt người ở quầy tự nghĩ ra một mã hợp lệ
 * là bắt họ học một luật không phải việc của họ.
 */
export function suggestCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function TagNameCell({
  name,
  code,
  description,
}: {
  name: string;
  code: string;
  description: string | null;
}) {
  return (
    <TableCell>
      <span className="font-medium">{name}</span>
      <span className="block font-mono text-xs text-muted-foreground">{code}</span>
      {description !== null && description !== '' && (
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      )}
    </TableCell>
  );
}

/* Biến thể trung tính: bảng màu còn lại đang mang nghĩa trạng thái nghiệp vụ, và một thẻ
 * màu do người dùng tự đặt tên sẽ đọc như cảnh báo hệ thống. */
export function TagStatusCell({ status }: { status: string }) {
  return (
    <TableCell>
      <Badge variant={status === 'Active' ? 'neutral' : 'outline'}>
        {status === 'Active' ? 'Đang dùng' : 'Ngừng dùng'}
      </Badge>
    </TableCell>
  );
}

export function TagToggleCell({
  status,
  canEdit,
  loading,
  onClick,
}: {
  status: string;
  canEdit: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <TableCell align="right">
      <Button variant="ghost" size="sm" disabled={!canEdit} loading={loading} onClick={onClick}>
        {status === 'Active' ? 'Ngừng dùng' : 'Dùng lại'}
      </Button>
    </TableCell>
  );
}

/* Con số 0 KHÔNG bấm được, và đó là chủ ý: một đường dẫn ra danh sách rỗng là một cú bấm
 * dẫn tới sự thất vọng. */
export function TagCountLink({
  count,
  href,
  label,
}: {
  count: number;
  href: string;
  label: string;
}) {
  if (count === 0) {
    return <span className="tabular-nums text-muted-foreground">0</span>;
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="font-medium tabular-nums text-primary underline-offset-4 hover:underline"
    >
      {count}
    </Link>
  );
}
