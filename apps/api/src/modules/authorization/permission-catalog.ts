/* Closed permission catalog — the single source of truth for authorization codes.
 * Codes are seeded from here and asserted from here; a code that exists only in a
 * decorator is a code nobody reviewed. Adding one is a deliberate edit + migration,
 * never an ad-hoc string at a call site (blueprint doc 16 §D.5).
 *
 * Hard constraint: every code has EXACTLY three segments (module.resource.action).
 * `permissionMatches` compares segment counts, so a 2- or 4-segment code silently
 * matches nothing — including the `*.*.*` wildcard.
 */

export interface PermissionDef {
  code: string;
  description: string;
}

export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  { code: '*.*.*', description: 'Toàn quyền (tạm thời, sẽ thay bằng quyền tường minh)' },
  { code: 'cemetery.customer.view', description: 'Xem khách hàng' },
  { code: 'cemetery.grave.hold', description: 'Giữ chỗ lô mộ' },
  { code: 'cemetery.contract.activate', description: 'Cho hợp đồng có hiệu lực' },
  { code: 'cemetery.document.view_sensitive', description: 'Xem giấy tờ/định danh nhạy cảm' },
  { code: 'audit.event.view', description: 'Đọc nhật ký kiểm toán' },
];

export const PERMISSION_CODES: readonly string[] = PERMISSION_CATALOG.map((p) => p.code);

export interface RoleDef {
  name: string;
  grants: { code: string; scope: string }[];
}

export const ROLE_CATALOG: Readonly<Record<string, RoleDef>> = {
  ADMIN: { name: 'Quản trị', grants: [{ code: '*.*.*', scope: 'GROUP' }] },
  STAFF: {
    name: 'Nhân viên',
    grants: [
      { code: 'cemetery.customer.view', scope: 'COMPANY' },
      { code: 'cemetery.grave.hold', scope: 'COMPANY' },
    ],
  },
};
