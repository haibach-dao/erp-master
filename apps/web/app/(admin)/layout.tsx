import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';
import { Sidebar } from '@/components/sidebar';
import { RequireAuth } from '@/components/require-auth';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen">
        <Sidebar />
        {/* `min-w-0` để bảng rộng cuộn trong khung của nó thay vì đẩy cả trang. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 px-6 py-6">
            <div className="mx-auto w-full max-w-[1400px] space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
