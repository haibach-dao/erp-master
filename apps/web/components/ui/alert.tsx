import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      info: 'border-info/25 bg-info-soft text-foreground [&>svg]:text-info',
      success: 'border-success/25 bg-success-soft text-foreground [&>svg]:text-success',
      warning: 'border-warning/30 bg-warning-soft text-foreground [&>svg]:text-warning',
      destructive:
        'border-destructive/25 bg-destructive-soft text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
} as const;

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { title?: string };

/* Thay cho các chỗ trước đây hardcode `text-red-600` / `border-amber-500/50`
 * rải rác trong trang. */
export function Alert({ className, variant, title, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        {title !== undefined ? <p className="font-medium">{title}</p> : null}
        {children !== undefined ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
