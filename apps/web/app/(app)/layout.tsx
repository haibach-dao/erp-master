import type { ReactNode } from 'react';
import { TopBar } from '@/components/top-bar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="p-6">{children}</main>
    </div>
  );
}
