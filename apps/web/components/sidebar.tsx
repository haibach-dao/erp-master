'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { canAny } from '@/lib/permissions';

/* Navigation built from the caller's real permissions.
 *
 * `permission: null` means the page needs no specific right (the dashboard shell, which
 * degrades on its own when a panel is not allowed). Everything else is hidden when the
 * caller could not open it — hiding a link is a courtesy, and the guard refuses the
 * request anyway, so a hidden item is never the thing keeping anyone out.
 */
const ITEMS: { href: string; label: string; permissions: string[] | null }[] = [
  { href: '/dashboard', label: 'Dashboard', permissions: null },
  { href: '/cemetery/customers', label: 'Khách hàng', permissions: ['crm.customer.view'] },
  { href: '/cemetery/graves', label: 'Mộ', permissions: ['cemetery.plot.view'] },
  { href: '/cemetery/contracts', label: 'Hợp đồng', permissions: ['contract.record.view'] },
  { href: '/cemetery/burials', label: 'An táng', permissions: ['burial.record.view'] },
  { href: '/cemetery/services', label: 'Dịch vụ', permissions: ['service.subscription.view'] },
  {
    href: '/approvals/inbox',
    label: 'Phê duyệt',
    permissions: ['contract.record.verify', 'contract.record.approve', 'burial.record.verify'],
  },
  { href: '/audit', label: 'Audit', permissions: ['audit.event.view'] },
  { href: '/organization', label: 'Tổ chức', permissions: ['org.company.view'] },
  { href: '/organization/roles', label: 'Vai & quyền', permissions: ['authz.role.view'] },
  {
    href: '/organization/assignments',
    label: 'Gán vai',
    permissions: ['authz.role_assignment.assign'],
  },
  { href: '/organization/scope', label: 'Gán phạm vi', permissions: ['authz.scope.assign'] },
  { href: '/organization/rules-chain', label: 'Chuỗi luật', permissions: ['authz.rule.view'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = ITEMS.filter((i) => i.permissions === null || canAny(user, i.permissions));

  return (
    <nav className="w-52 shrink-0 space-y-1 border-r border-border p-3">
      {items.map((item) => {
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
