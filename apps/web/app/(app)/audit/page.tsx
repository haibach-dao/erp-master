'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api';

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
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit-events'],
    queryFn: () => apiFetch<AuditEventPage>('/api/v1/audit-events?pageSize=50'),
    retry: false,
  });

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Audit &amp; Check Log</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}

      {error !== null &&
        (error instanceof ApiError && error.status === 401 ? (
          <p className="text-sm text-muted-foreground">
            Bạn cần{' '}
            <Link href="/login" className="underline">
              đăng nhập
            </Link>{' '}
            để xem nhật ký audit.
          </p>
        ) : (
          <p className="text-sm text-red-600">Lỗi: {(error as Error).message}</p>
        ))}

      {data !== undefined && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-2 text-left font-medium">Thời điểm (UTC)</th>
                <th className="p-2 text-left font-medium">Ai</th>
                <th className="p-2 text-left font-medium">Hành động</th>
                <th className="p-2 text-left font-medium">Đối tượng</th>
                <th className="p-2 text-left font-medium">Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {data.data.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={5}>
                    Chưa có sự kiện audit.
                  </td>
                </tr>
              )}
              {data.data.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="p-2">{new Date(e.occurredAt).toISOString()}</td>
                  <td className="p-2">
                    {e.actorType}
                    {e.actorId !== null ? ` · ${e.actorId}` : ''}
                  </td>
                  <td className="p-2 font-mono text-xs">{e.action}</td>
                  <td className="p-2">
                    {e.entityType} · {e.entityId}
                  </td>
                  <td className="p-2">{e.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border p-2 text-xs text-muted-foreground">
            {data.total} sự kiện · trang {data.page}
          </div>
        </div>
      )}
    </section>
  );
}
