'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

// Client-side gate for the authenticated app shell. Backend remains the real
// authority; this only improves UX by redirecting unauthenticated users to /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user === null) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    // Chiếm trọn màn hình thay vì một dòng chữ ở góc: người dùng thấy app đang
    // mở, không phải một trang hỏng.
    return (
      <div
        className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Đang tải…
      </div>
    );
  }
  if (user === null) {
    return null;
  }
  return <>{children}</>;
}
