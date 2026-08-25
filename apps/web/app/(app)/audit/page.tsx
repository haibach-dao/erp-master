'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api';
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
  action: string;
  entityType: string;
  entityId: string;
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
            <TableHead>Thời điểm (UTC)</TableHead>
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

          {data?.data.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {new Date(e.occurredAt).toISOString()}
              </TableCell>
              <TableCell>
                {e.actorType}
                {e.actorId !== null ? (
                  <span className="text-muted-foreground"> · {e.actorId}</span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs">{e.action}</TableCell>
              <TableCell>
                {e.entityType}
                <span className="text-muted-foreground"> · {e.entityId}</span>
              </TableCell>
              <TableCell>
                {/* `result` là chuỗi tự do từ server, không nằm trong từ vựng
                    trạng thái nghiệp vụ — chỉ tô đỏ khi thấy dấu hiệu từ chối. */}
                <Badge
                  variant={/deny|denied|fail|error/i.test(e.result) ? 'destructive' : 'neutral'}
                >
                  {e.result}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
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
