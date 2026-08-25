import * as React from 'react';
import { cn } from '@/lib/utils';

/* Bảng dùng chung cho mọi trang danh sách: header dính, zebra, hover, và
 * `align="right"` cho cột số (kèm tabular-nums) — trước đây mỗi trang tự chế
 * bằng `p-2` nên nhìn thô và không đều nhau. */
export function Table({
  className,
  containerClassName,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { containerClassName?: string }) {
  return (
    <div
      className={cn(
        'relative w-full overflow-auto rounded-lg border border-border bg-card shadow-sm',
        containerClassName,
      )}
    >
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('sticky top-0 z-10 bg-muted/70 backdrop-blur', className)} {...props} />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors even:bg-muted/25 hover:bg-accent/60',
        className,
      )}
      {...props}
    />
  );
}

type CellProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right' | 'center';
};

export function TableHead({ className, align = 'left', ...props }: CellProps) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = 'left',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-middle',
        align === 'right' && 'num',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

/* Một dòng chiếm hết chiều ngang bảng: dùng cho rỗng / lỗi / đang tải, thay vì
 * mỗi trang tự đếm `colSpan` rồi tự đặt padding. */
export function TableMessage({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
