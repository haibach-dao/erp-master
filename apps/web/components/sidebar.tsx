'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { canAny } from '@/lib/permissions';
import { NAV, activeGroupId, activeItem, type NavItem } from '@/lib/nav';
import { Brand } from '@/components/brand';

/* Điều hướng CHA — CON, thu gọn được.
 *
 * Trước 03/09/2026 đây là một danh sách phẳng. Sau vài đợt tính năng nó lên tới hơn hai chục
 * mục, và một danh sách dài quá thì người ta thôi đọc — chỉ quét lấy mục quen tay, còn mục
 * mới thì không ai thấy.
 *
 * Ba quyết định về HÀNH VI, ghi ra vì cái nào cũng dễ bị "sửa cho gọn" thành sai:
 *
 * 1. Nhóm chứa trang ĐANG MỞ luôn được bung. Người dùng phải thấy mình đang đứng ở đâu,
 *    kể cả khi tới đây bằng một đường dẫn dán từ chỗ khác.
 * 2. Mở một nhóm KHÔNG đóng nhóm khác. Kiểu accordion "chỉ một nhóm mở" đọc thì gọn nhưng
 *    dùng thì bực: đang đối chiếu hai màn hình ở hai nhóm là cứ mỗi lần bấm lại mất chỗ.
 * 3. Trạng thái đóng/mở KHÔNG lưu qua lần tải lại. Sidebar sống suốt phiên (nó nằm ở layout,
 *    không bị dựng lại khi chuyển trang) nên trong một phiên làm việc nó nhớ đủ. Lưu vào
 *    localStorage thì phải xử lý ca đọc ra rỗng lúc dựng phía server, và cái giá đó không
 *    đáng cho một tiện ích nhỏ. Ghi ra đây để lần sau ai thấy "thiếu" thì biết là cố ý.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const active = activeItem(pathname);
  const openGroup = activeGroupId(pathname);

  /* Ẩn một mục chỉ là phép lịch sự: guard trên server vẫn từ chối request, nên một mục bị
   * ẩn chưa bao giờ là thứ giữ ai đó ở ngoài. Nhóm rỗng sau khi lọc thì biến mất luôn —
   * một tiêu đề nhóm không có mục nào bên dưới chỉ nói với người dùng rằng họ đang thiếu
   * thứ gì đó, mà không nói được là thiếu gì. */
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permissions === null || canAny(user, i.permissions)),
  })).filter((g) => g.items.length > 0);

  const [open, setOpen] = useState<Set<string>>(
    () => new Set(openGroup === undefined ? [] : [openGroup]),
  );

  /* Điều hướng sang một nhóm đang đóng thì BUNG nó ra, và không đụng các nhóm khác. */
  useEffect(() => {
    if (openGroup === undefined) return;
    setOpen((prev) => (prev.has(openGroup) ? prev : new Set(prev).add(openGroup)));
  }, [openGroup]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav
      aria-label="Điều hướng chính"
      className="flex w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4"
    >
      <Brand className="px-2" />

      <div className="flex flex-col gap-1">
        {groups.map((group) => {
          /* Nhóm KHÔNG tiêu đề (Dashboard) không thu gọn được — không có gì để thu, và một
           * mũi tên bên cạnh một mục đơn lẻ chỉ gây hiểu nhầm là còn mục con bên dưới. */
          if (group.label === null) {
            return (
              <div key={group.id} className="mb-2 space-y-1">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} isActive={active?.href === item.href} />
                ))}
              </div>
            );
          }

          const isOpen = open.has(group.id);
          const hasActive = group.items.some((i) => i.href === active?.href);
          const panelId = `nav-group-${group.id}`;

          return (
            <div key={group.id} className="space-y-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(group.id)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  {group.label}
                  {/* Nhóm đang ĐÓNG mà chứa trang hiện tại thì gần như không xảy ra (hiệu ứng
                      ở trên tự bung), nhưng chấm này giữ cho ca ấy vẫn đọc được nếu người
                      dùng tự tay đóng nhóm mình đang đứng. */}
                  {!isOpen && hasActive && (
                    <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  )}
                </span>
                <ChevronDown
                  className={`size-3.5 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  aria-hidden
                />
              </button>

              {/* Ẩn bằng cách KHÔNG dựng, không phải bằng `hidden`: mục đang ẩn mà vẫn nằm
                  trong cây thì bàn phím Tab vẫn đi qua nó và trình đọc màn hình vẫn đọc. */}
              {isOpen && (
                <div id={panelId} className="space-y-1 pb-2">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} isActive={active?.href === item.href} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
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
          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
        }`}
        aria-hidden
      />
      {item.label}
    </Link>
  );
}
