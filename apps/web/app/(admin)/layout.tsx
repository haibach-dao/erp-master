import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';
import { Sidebar } from '@/components/sidebar';
import { RequireAuth } from '@/components/require-auth';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <TopBar />
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
