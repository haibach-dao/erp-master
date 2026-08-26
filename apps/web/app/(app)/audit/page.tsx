'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api';
import {
  actionLabel,
  actionVariant,
  actorTypeLabel,
  formatAuditTime,
  resultLabel,
} from '@/lib/audit';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
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

interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  /** Email người thao tác, do API tra từ `iam.users`. `null` khi tra không ra. */
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Nhãn loại đối tượng bằng tiếng Việt, do API dịch. */
  entityTypeLabel: string;
  /** Tên đối tượng; rơi về id rút gọn nếu đối tượng đã bị xoá. */
  entityLabel: string;
  result: string;
  correlationId: string | null;
}

interface AuditEventPage {
  data: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AuditPage() {
  const { data, error, isPending } = useQuery({
    queryKey: ['audit-events'],
    queryFn: () => apiFetch<AuditEventPage>('/api/v1/audit-events?pageSize=50'),
    retry: false,
  });

  const unauthenticated = error instanceof ApiError && error.status === 401;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Audit &amp; Check Log"
        description="Nhật ký bất biến: ai làm gì, lên đối tượng nào, kết quả ra sao."
      />

      {error !== null && !unauthenticated ? (
        <Alert variant="destructive" title="Không tải được nhật ký">
          {(error as Error).message}
        </Alert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời điểm</TableHead>
            <TableHead>Ai</TableHead>
            <TableHead>Hành động</TableHead>
            <TableHead>Đối tượng</TableHead>
            <TableHead>Kết quả</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending && error === null ? <TableSkeleton rows={6} cols={5} /> : null}

          {unauthenticated ? (
            <TableMessage colSpan={5}>
              <EmptyState
                icon={ShieldCheck}
                title="Cần đăng nhập để xem nhật ký audit"
                action={
                  <Link
                    href="/login"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Đăng nhập
                  </Link>
                }
              />
            </TableMessage>
          ) : null}

          {data !== undefined && data.data.length === 0 ? (
            <TableMessage colSpan={5}>
              <EmptyState
                icon={ShieldCheck}
                title="Chưa có sự kiện audit"
                description="Nhật ký sẽ tự đầy lên khi có người thao tác trên hệ thống."
              />
            </TableMessage>
          ) : null}

          {data?.data.map((e) => {
            const time = formatAuditTime(e.occurredAt);
            const result = resultLabel(e.result);
            return (
              <TableRow key={e.id}>
                {/* Giờ địa phương để đọc; mốc ISO tuyệt đối trong `title` để đối chiếu
                    với log máy chủ. */}
                <TableCell
                  className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                  title={time.iso}
                >
                  {time.display}
                </TableCell>
                <TableCell>
                  {/* Email người thao tác. Tra không ra (tài khoản đã xoá, hoặc ghế máy)
                      thì hiện loại chủ thể — đừng để trống, dòng nào cũng phải quy được
                      trách nhiệm về một chỗ. */}
                  {e.actorLabel !== null ? (
                    <span className="font-medium">{e.actorLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">{actorTypeLabel(e.actorType)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={actionVariant(e.action)}>{actionLabel(e.action)}</Badge>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{e.entityLabel}</span>
                  <span className="block text-xs text-muted-foreground">{e.entityTypeLabel}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={result.variant}>{result.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {data !== undefined && data.data.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.total.toLocaleString('vi-VN')} sự kiện · đang xem trang {data.page}
        </p>
      ) : null}
    </section>
  );
}
