import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ClipboardCheck,
  FileText,
  KeyRound,
  LayoutDashboard,
  Landmark,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
  UserCog,
  Waypoints,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** `null` = trang không đòi quyền cụ thể; ngược lại hiện khi có BẤT KỲ quyền nào. */
  permissions: string[] | null;
};

export type NavGroup = {
  /** `null` = nhóm không tiêu đề, dùng cho mục đứng một mình ở đầu. */
  label: string | null;
  items: NavItem[];
};

/* Sơ đồ điều hướng — nguồn duy nhất cho cả sidebar lẫn breadcrumb.
 *
 * Ẩn một mục chỉ là phép lịch sự: guard trên server vẫn từ chối request, nên
 * một mục bị ẩn chưa bao giờ là thứ giữ ai đó ở ngoài.
 */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permissions: null }],
  },
  {
    label: 'Nghĩa trang',
    items: [
      {
        href: '/cemetery/customers',
        label: 'Khách hàng',
        icon: Users,
        permissions: ['crm.customer.view'],
      },
      {
        href: '/cemetery/graves',
        label: 'Mộ',
        icon: Landmark,
        permissions: ['cemetery.plot.view'],
      },
      {
        href: '/cemetery/contracts',
        label: 'Hợp đồng',
        icon: FileText,
        permissions: ['contract.record.view'],
      },
      {
        href: '/cemetery/burials',
        label: 'An táng',
        icon: ScrollText,
        permissions: ['burial.record.view'],
      },
      {
        href: '/cemetery/services',
        label: 'Dịch vụ',
        icon: Sparkles,
        permissions: ['service.subscription.view'],
      },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      {
        href: '/approvals/inbox',
        label: 'Phê duyệt',
        icon: ClipboardCheck,
        permissions: ['contract.record.verify', 'contract.record.approve', 'burial.record.verify'],
      },
      { href: '/audit', label: 'Audit', icon: ShieldCheck, permissions: ['audit.event.view'] },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      {
        href: '/organization',
        label: 'Tổ chức',
        icon: Building2,
        permissions: ['org.company.view'],
      },
      {
        href: '/organization/roles',
        label: 'Vai & quyền',
        icon: KeyRound,
        permissions: ['authz.role.view'],
      },
      {
        href: '/organization/assignments',
        label: 'Gán vai',
        icon: UserCog,
        permissions: ['authz.role_assignment.assign'],
      },
      {
        href: '/organization/scope',
        label: 'Gán phạm vi',
        icon: Waypoints,
        permissions: ['authz.scope.assign'],
      },
      {
        href: '/organization/rules-chain',
        label: 'Chuỗi luật',
        icon: ShieldCheck,
        permissions: ['authz.rule.view'],
      },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/* Mục đang mở = mục có href khớp DÀI NHẤT.
 *
 * Không dùng `startsWith` đơn thuần: `/organization` là tiền tố của
 * `/organization/roles`, nên "Tổ chức" sẽ sáng cùng lúc với "Vai & quyền".
 */
export function activeItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

export type Crumb = { label: string; href?: string };

/** Vụn đường dẫn: tên nhóm (không bấm được) → tên trang. */
export function breadcrumbs(pathname: string): Crumb[] {
  const item = activeItem(pathname);
  if (item === undefined) {
    return [];
  }
  const group = NAV.find((g) => g.items.includes(item));
  const crumbs: Crumb[] = [];
  if (group?.label != null) {
    crumbs.push({ label: group.label });
  }
  crumbs.push({ label: item.label, href: item.href });
  return crumbs;
}
