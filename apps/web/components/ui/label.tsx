import * as React from 'react';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, required = false, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-sm font-medium leading-none text-foreground', className)}
    {...props}
  >
    {children}
    {required ? (
      <span className="ml-0.5 text-destructive" aria-hidden>
        *
      </span>
    ) : null}
  </label>
));
Label.displayName = 'Label';

/* Cặp nhãn + trường dùng chung một khoảng cách, để form không mỗi trang một kiểu. */
export function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error !== undefined ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint !== undefined ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
