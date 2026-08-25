import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* Tiêu đề trang thống nhất: mỗi trang trước đây tự đặt cỡ chữ và khoảng cách. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
