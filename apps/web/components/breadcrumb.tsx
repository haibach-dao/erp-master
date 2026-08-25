'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { breadcrumbs } from '@/lib/nav';

export function Breadcrumb() {
  const pathname = usePathname();
  const crumbs = breadcrumbs(pathname);
  if (crumbs.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Đường dẫn" className="flex items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? (
              <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            ) : null}
            {last || crumb.href === undefined ? (
              <span className={last ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="text-muted-foreground hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
