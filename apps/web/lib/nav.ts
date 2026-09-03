import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ClipboardCheck,
  FileText,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Map,
  Receipt,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tag as TagsIcon,
  Tags,
  UserCog,
  Users,
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
  /** Khoá ổn định cho trạng thái đóng/mở và `aria-controls`. Không đổi khi sửa nhãn. */
  id: string;
  /** `null` = nhóm KHÔNG có tiêu đề và KHÔNG thu gọn được — dùng cho mục đứng riêng ở đầu. */
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
    id: 'home',
    label: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permissions: null }],
  },
  {
    id: 'cemetery',
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
        href: '/cemetery/map',
        label: 'Sơ đồ mặt bằng',
        icon: Map,
        permissions: ['cemetery.plot.view'],
      },
      {
        href: '/cemetery/cards',
        label: 'Thẻ quản lý mộ',
        icon: IdCard,
        permissions: ['cemetery.card.view'],
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
  /* DANH MỤC tách thành nhóm riêng, không nằm lẫn trong "Nghĩa trang".
   *
   * Hai lý do, và lý do thứ hai mới là chính:
   * 1. Nhóm "Nghĩa trang" đã lên 10 mục — dài quá thì người ta thôi đọc và chỉ quét lấy
   *    mục quen tay.
   * 2. Đây là những màn hình ĐẶT LUẬT (mở thẻ mới, ban hành đơn giá), không phải màn hình
   *    làm việc hằng ngày. Chúng dùng thưa nhưng hậu quả rộng: một dòng ở đây áp cho mọi
   *    công ty. Để lẫn giữa các mục tác nghiệp là mời người ta ghé vào theo thói quen.
   */
  {
    id: 'catalog',
    label: 'Danh mục',
    items: [
      /* HAI mục riêng, không một mục "Thẻ nhãn" gộp.
       *
       * Tách ở thanh điều hướng là tầng cuối của một ranh giới đã tách ở mọi tầng dưới —
       * và nó buộc người ta phải ĐI TỚI một chỗ khác để mở thẻ dán lên con người, thay vì
       * gặp ô đó ngay cạnh ô mở thẻ mộ dùng hằng ngày. Hai `permissions` khác nhau cũng
       * nghĩa là người chỉ làm thực địa sẽ không thấy mục thẻ khách. */
      {
        href: '/cemetery/plot-tags',
        label: 'Thẻ nhãn phần mộ',
        icon: Tags,
        permissions: ['cemetery.plot_tag.view'],
      },
      {
        href: '/cemetery/customer-tags',
        label: 'Thẻ nhãn khách hàng',
        icon: TagsIcon,
        permissions: ['crm.customer_tag.view'],
      },
      {
        href: '/cemetery/card-fees',
        label: 'Biểu phí thẻ mộ',
        icon: Receipt,
        permissions: ['cemetery.card_fee.view'],
      },
    ],
  },
  {
    id: 'operations',
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
    id: 'admin',
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

/** Nhóm chứa mục đang mở — sidebar dùng để LUÔN bung đúng nhóm người dùng đang đứng. */
export function activeGroupId(pathname: string): string | undefined {
  const item = activeItem(pathname);
  if (item === undefined) {
    return undefined;
  }
  return NAV.find((g) => g.items.includes(item))?.id;
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
