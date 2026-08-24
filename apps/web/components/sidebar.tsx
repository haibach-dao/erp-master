'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/cemetery/customers', label: 'Khách hàng' },
  { href: '/cemetery/graves', label: 'Mộ' },
  { href: '/cemetery/contracts', label: 'Hợp đồng' },
  { href: '/cemetery/services', label: 'Dịch vụ' },
  { href: '/approvals/inbox', label: 'Phê duyệt' },
  { href: '/audit', label: 'Audit' },
  { href: '/organization', label: 'Tổ chức' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="w-52 shrink-0 space-y-1 border-r border-border p-3">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded-md px-3 py-2 text-sm ${
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
