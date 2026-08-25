import Link from 'next/link';
import { cn } from '@/lib/utils';

/* Dấu hiệu nhận diện ở góc trái — thay cho dòng chữ "ERP Master" trần. */
export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn('flex items-center gap-2.5 rounded-md', className)}
      aria-label="ERP Master — về Dashboard"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-xs"
        aria-hidden
      >
        EM
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">ERP Master</span>
        <span className="text-[11px] text-muted-foreground">INDEVCO</span>
      </span>
    </Link>
  );
}
