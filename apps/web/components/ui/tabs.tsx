'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/* Tab tối giản, không thêm dependency Radix.
 *
 * Vì sao cần: hồ sơ khách hàng có hơn 40 trường chia làm sáu nhóm nghiệp vụ. Đổ hết ra
 * một trang dài thì người dùng phải cuộn để tìm, và không nhìn thấy hồ sơ có những phần
 * nào nếu không cuộn hết.
 *
 * Bàn phím phải chạy được, không chỉ chuột: mũi tên trái/phải đổi tab, Home/End nhảy đầu
 * cuối — đúng hành vi người dùng bàn phím đã quen ở mọi bộ tab khác. Dùng "roving
 * tabindex": chỉ tab đang chọn nhận được Tab từ bàn phím, các tab còn lại đi bằng mũi
 * tên. Để cả bảy tab cùng nhận Tab thì người dùng bàn phím phải bấm bảy lần mới qua khỏi
 * thanh tab.
 */

export interface TabItem {
  id: string;
  label: string;
  /** Con số nhỏ cạnh nhãn — cho biết tab đó có gì bên trong mà không cần mở ra. */
  count?: number | undefined;
  icon?: React.ComponentType<{ className?: string }> | undefined;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
  children,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (delta: number) => {
    const i = items.findIndex((t) => t.id === value);
    if (i === -1) return;
    // Vòng lại đầu/cuối: đến tab cuối bấm phải nữa thì về tab đầu, không mắc kẹt.
    const next = items[(i + delta + items.length) % items.length];
    if (next === undefined) return;
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  const jump = (index: number) => {
    const t = items[index];
    if (t === undefined) return;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div
        role="tablist"
        aria-label="Phần thông tin"
        className="flex flex-wrap gap-1 border-b border-border"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            jump(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            jump(items.length - 1);
          }
        }}
      >
        {items.map((t) => {
          const active = t.id === value;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
                // Gạch dưới tràn xuống viền để tab đang chọn nối liền với vùng nội dung.
                '-mb-px border-b-2',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon !== undefined ? <Icon className="size-4" /> : null}
              {t.label}
              {t.count !== undefined ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs',
                    active ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/* Vùng nội dung của một tab.
 *
 * KHÔNG render khi tab không được chọn — mỗi tab ở đây gọi dữ liệu riêng, và giữ tất cả
 * trong DOM nghĩa là mở hồ sơ nào cũng nạp cả sáu phần. `tabIndex={0}` để người dùng bàn
 * phím Tab được vào vùng nội dung sau khi chọn tab.
 */
export function TabPanel({
  id,
  value,
  children,
}: {
  id: string;
  value: string;
  children: React.ReactNode;
}) {
  if (id !== value) {
    return null;
  }
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
