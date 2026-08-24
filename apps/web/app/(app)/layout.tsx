import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';
import { RequireAuth } from '@/components/require-auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="min-h-screen">
        <TopBar />
        <main className="p-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
