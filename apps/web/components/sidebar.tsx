'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { canAny } from '@/lib/permissions';
import { NAV, activeItem } from '@/lib/nav';
import { Brand } from '@/components/brand';

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const active = activeItem(pathname);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permissions === null || canAny(user, i.permissions)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav
      aria-label="Điều hướng chính"
      className="flex w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4"
    >
      <Brand className="px-2" />

      <div className="flex flex-col gap-5">
        {groups.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} className="space-y-1">
            {group.label !== null ? (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => {
              const isActive = active?.href === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon
                    className={`size-4 shrink-0 ${
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                    aria-hidden
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
