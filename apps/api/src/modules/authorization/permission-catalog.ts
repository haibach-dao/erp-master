/* Closed permission catalog — the single source of truth for authorization codes.
 * Codes are seeded from here and asserted from here; a code that exists only in a
 * decorator is a code nobody reviewed. Adding one is a deliberate edit + migration,
 * never an ad-hoc string at a call site (blueprint doc 16 §D.5).
 *
 * Three hard constraints, each of which fails SILENTLY when broken:
 *  1. Every code has EXACTLY three segments (module.resource.action). `permissionMatches`
 *     compares segment counts, so a 2- or 4-segment code matches nothing — not even `*.*.*`.
 *  2. `action` comes from the CLOSED set below (doc 16 §D.3). A new verb is a migration
 *     with a reason, not a new string at a call site.
 *  3. Sensitivity is a COLUMN, never a fourth segment.
 *
 * Nothing here grants anything. Seeding this catalog adds rows to `authz.permissions`
 * only; who holds what is decided in ROLE_CATALOG and lands in a separate change.
 */

/** Data sensitivity (doc 16 §D.4). S3 is personal data / irreversible acts / unmasking. */
export type Sensitivity = 'S0' | 'S1' | 'S2' | 'S3';

/** Closed action set — group A (shared verbs) then group B (business verbs). */
export const ACTIONS = [
  // A — shared
  'view',
  'search',
  'export',
  'view_sensitive',
  'download',
  'download_sensitive',
  'create',
  'update',
  'delete',
  'verify',
  'approve',
  'override',
  // B — business
  'activate',
  'hold',
  'release',
  'set_status',
  'set_price',
  'renew',
  'cancel',
  'complete',
  'assign',
  'upload',
  'confirm',
  'adjust',
  'backdate',
  'close',
  'set_sensitivity',
  'set_protected',
  'view_protected',
  'view_price',
  'view_history',
  'grant',
  'revoke',
  'submit',
  'record',
  'withdraw',
  'rotate',
  'configure',
  'ai_ingest',
] as const;

export type Action = (typeof ACTIONS)[number];

export interface PermissionDef {
  code: string;
  sensitivity: Sensitivity;
  description: string;
  /** True for S3: a `*` wildcard grant must NOT reach this leaf (enforced in PR-6). */
  wildcardExempt: boolean;
  /** Release the code first appeared in — the OPERA "New task" label, for admin review. */
  introducedIn: string;
  /** Kept only until the routes still referencing it move to the new code (doc 16 §D.7). */
  deprecated?: string;
}

const GATE_1 = 'gate-1';

/** Terse builder so the catalog below reads as a table, not as boilerplate. */
function p(
  code: string,
  sensitivity: Sensitivity,
  description: string,
  extra: Partial<PermissionDef> = {},
): PermissionDef {
  return {
    code,
    sensitivity,
    description,
    wildcardExempt: sensitivity === 'S3',
    introducedIn: GATE_1,
    ...extra,
  };
}

export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // --- Toàn quyền tạm thời. Doc 16 Q13 đề xuất BỎ HẲN; giữ tới khi 14 vai có quyền
  //     tường minh, nếu không seed lại sẽ khoá sạch ADMIN đang chạy (doc 16 §G.2).
  p('*.*.*', 'S3', 'Toàn quyền (tạm thời — sẽ thay bằng quyền tường minh)', {
    wildcardExempt: false,
  }),

  // --- org ---
  p('org.company.view', 'S1', 'Xem công ty'),
  p('org.company.create', 'S3', 'Tạo công ty'),
  p('org.company.update', 'S3', 'Sửa công ty'),

  // --- cemetery ---
  p('cemetery.reference.view', 'S0', 'Xem danh mục tham chiếu (quan hệ nhân thân...)'),
  p('cemetery.site.view', 'S1', 'Xem nghĩa trang'),
  p('cemetery.site.create', 'S2', 'Tạo nghĩa trang'),
  p('cemetery.grave_type.view', 'S1', 'Xem loại mộ'),
  p('cemetery.grave_type.create', 'S1', 'Tạo loại mộ'),
  p('cemetery.price.view', 'S2', 'Xem giá niêm yết lô mộ'),
  p('cemetery.price.set_price', 'S3', 'Đặt giá lô mộ'),
  p('cemetery.plot.view', 'S1', 'Xem lô mộ'),
  p('cemetery.plot.search', 'S1', 'Tra cứu lô mộ theo tiêu chí tự nhập'),
  p('cemetery.plot.export', 'S3', 'Trích xuất danh sách lô mộ ra ngoài hệ'),
  p('cemetery.plot.create', 'S2', 'Tạo lô mộ'),
  p('cemetery.plot.set_status', 'S2', 'Đổi trạng thái lô mộ'),
  p('cemetery.plot.override', 'S3', 'Vượt quy tắc trạng thái/sức chứa lô mộ'),
  p('cemetery.plot.view_history', 'S2', 'Xem lịch sử đổi trạng thái lô mộ'),
  p('cemetery.hold.view', 'S1', 'Xem phiếu giữ chỗ'),
  p('cemetery.hold.hold', 'S2', 'Giữ chỗ lô mộ'),
  p('cemetery.hold.release', 'S3', 'Huỷ giữ chỗ lô mộ'),

  // --- crm ---
  p('crm.person.view', 'S2', 'Xem nhân thân (đã mask)'),
  p('crm.person.create', 'S2', 'Tạo nhân thân'),
  p('crm.person.update', 'S2', 'Sửa nhân thân'),
  p('crm.person.view_sensitive', 'S3', 'Xem CCCD/định danh không mask'),
  p('crm.person.export', 'S3', 'Trích xuất nhân thân ra ngoài hệ'),
  p('crm.person.set_protected', 'S3', 'Đặt cờ bảo vệ nhân thân (LÀN CẤM)'),
  p('crm.person.view_protected', 'S3', 'Xem nhân thân được bảo vệ (LÀN CẤM)'),
  p('crm.person.ai_ingest', 'S3', 'Đưa dữ liệu nhân thân vào công cụ AI dùng chung'),
  p('crm.customer.view', 'S2', 'Xem khách hàng'),
  p('crm.customer.search', 'S2', 'Tra cứu khách hàng theo tiêu chí tự nhập'),
  p('crm.customer.create', 'S2', 'Tạo khách hàng'),
  p('crm.customer.export', 'S3', 'Trích xuất khách hàng ra ngoài hệ'),
  p('crm.relationship.view', 'S3', 'Xem quan hệ nhân thân'),
  p('crm.relationship.create', 'S3', 'Tạo quan hệ nhân thân'),
  p('crm.relationship.verify', 'S3', 'Thẩm định quan hệ nhân thân'),
  p('crm.relationship.cancel', 'S3', 'Chấm dứt quan hệ nhân thân'),
  p('crm.consent.view', 'S3', 'Xem đồng ý xử lý dữ liệu cá nhân'),
  p('crm.consent.record', 'S3', 'Ghi nhận đồng ý xử lý dữ liệu cá nhân'),
  p('crm.consent.withdraw', 'S3', 'Rút đồng ý xử lý dữ liệu cá nhân'),

  // --- contract ---
  p('contract.record.view', 'S2', 'Xem hợp đồng'),
  p('contract.record.search', 'S2', 'Tra cứu hợp đồng theo tiêu chí tự nhập'),
  p('contract.record.export', 'S3', 'Trích xuất hợp đồng ra ngoài hệ'),
  p('contract.record.create', 'S2', 'Soạn hợp đồng'),
  p('contract.record.update', 'S2', 'Sửa hợp đồng'),
  p('contract.record.verify', 'S3', 'Thẩm định hợp đồng'),
  p('contract.record.approve', 'S3', 'Duyệt chủ trương hợp đồng'),
  p('contract.record.activate', 'S3', 'Cho hợp đồng HIỆU LỰC (sinh hệ quả thật)'),
  p('contract.record.cancel', 'S3', 'Huỷ hợp đồng'),
  p('contract.record.ai_ingest', 'S3', 'Đưa dữ liệu hợp đồng vào công cụ AI dùng chung'),
  p('contract.amount.view_sensitive', 'S3', 'Xem số tiền hợp đồng không mask'),
  p('contract.party.view', 'S2', 'Xem bên tham gia hợp đồng'),
  p('contract.party.assign', 'S3', 'Gán bên tham gia hợp đồng'),

  // --- burial ---
  p('burial.deceased.view', 'S3', 'Xem hồ sơ người mất'),
  p('burial.deceased.create', 'S3', 'Tạo hồ sơ người mất'),
  p('burial.record.view', 'S2', 'Xem hồ sơ an táng'),
  p('burial.record.search', 'S2', 'Tra cứu hồ sơ an táng theo tiêu chí tự nhập'),
  p('burial.record.export', 'S3', 'Trích xuất hồ sơ an táng ra ngoài hệ'),
  p('burial.record.create', 'S2', 'Soạn hồ sơ an táng'),
  p('burial.record.verify', 'S3', 'Thẩm định hồ sơ an táng'),
  p('burial.record.complete', 'S3', 'Hoàn tất an táng (BẤT KHẢ HỒI)'),

  // --- service ---
  p('service.catalog.view', 'S1', 'Xem danh mục dịch vụ'),
  p('service.catalog.create', 'S1', 'Tạo mục dịch vụ'),
  p('service.price.view', 'S2', 'Xem giá niêm yết dịch vụ'),
  p('service.price.set_price', 'S3', 'Đặt giá dịch vụ'),
  p('service.subscription.view', 'S2', 'Xem thuê bao dịch vụ'),
  p('service.subscription.search', 'S2', 'Tra cứu thuê bao theo tiêu chí tự nhập'),
  p('service.subscription.export', 'S3', 'Trích xuất thuê bao ra ngoài hệ'),
  p('service.subscription.create', 'S2', 'Đăng ký thuê bao dịch vụ'),
  p('service.subscription.renew', 'S2', 'Gia hạn thuê bao dịch vụ'),
  p('service.subscription.cancel', 'S3', 'Huỷ thuê bao dịch vụ'),
  p('service.subscription.override', 'S3', 'Bán lệch giá niêm yết'),
  p('service.subscription.view_price', 'S3', 'Xem giá ĐÃ THƯƠNG LƯỢNG của thuê bao'),
  p('service.transaction.view', 'S2', 'Xem giao dịch thu'),
  p('service.transaction.adjust', 'S3', 'Ghi bù/điều chỉnh giao dịch'),
  p('service.transaction.backdate', 'S3', 'Ghi giao dịch lùi ngày'),
  p('service.revenue.view', 'S3', 'Xem báo cáo doanh thu'),
  p('service.revenue.export', 'S3', 'Trích xuất báo cáo doanh thu ra ngoài hệ'),
  p('service.revenue.ai_ingest', 'S3', 'Đưa dữ liệu doanh thu vào công cụ AI dùng chung'),
  p('service.period.close', 'S3', 'Đóng kỳ kế toán'),

  // --- file ---
  p('file.object.view', 'S1', 'Xem metadata file'),
  p('file.object.upload', 'S1', 'Xin URL tải file lên'),
  p('file.object.confirm', 'S1', 'Xác nhận đã tải file lên'),
  p('file.object.download', 'S2', 'Tải file thường'),
  p('file.object.download_sensitive', 'S3', 'Tải file nhạy cảm (mang dữ liệu ra ngoài)'),
  p('file.object.set_sensitivity', 'S3', 'Đổi mức nhạy cảm của file'),
  p('file.object.delete', 'S3', 'Xoá file'),

  // --- audit ---
  p('audit.event.view', 'S2', 'Đọc nhật ký kiểm toán'),
  p('audit.event.view_sensitive', 'S3', 'Đọc nhật ký kiểm toán không mask'),
  p('audit.event.export', 'S3', 'Trích xuất nhật ký kiểm toán ra ngoài hệ'),
  p('audit.user_activity.view', 'S3', 'Xem sổ hoạt động theo người'),
  p('audit.integrity.view', 'S2', 'Kiểm tra toàn vẹn chuỗi hash nhật ký'),

  // --- authz (quản trị chính ma trận quyền) ---
  p('authz.permission.view', 'S1', 'Xem danh mục quyền'),
  p('authz.permission.create', 'S3', 'Thêm mã quyền'),
  p('authz.permission.update', 'S3', 'Sửa mã quyền'),
  p('authz.role.view', 'S1', 'Xem danh mục vai'),
  p('authz.role.create', 'S3', 'Tạo vai'),
  p('authz.role.update', 'S3', 'Sửa vai'),
  p('authz.role_permission.grant', 'S3', 'Cấp quyền cho vai'),
  p('authz.role_permission.revoke', 'S3', 'Thu quyền của vai'),
  p('authz.role_assignment.assign', 'S3', 'Gán vai cho người'),
  p('authz.role_assignment.revoke', 'S3', 'Thu vai của người'),
  p('authz.scope.assign', 'S3', 'Gán phạm vi dữ liệu cho người'),
  p('authz.change.submit', 'S2', 'Trình thay đổi ma trận quyền'),
  p('authz.change.approve', 'S3', 'Cho thay đổi ma trận quyền HIỆU LỰC'),
  p('authz.matrix.export', 'S2', 'Xuất bản chiếu ma trận vai × quyền'),

  // --- iam ---
  // Doc 16 §D.5 gộp `user / session` chung một danh sách action. Ở đây tách theo nghĩa
  // thực tế: session không có create/update qua giao diện quản trị, chỉ xem và thu hồi.
  p('iam.user.view', 'S3', 'Xem tài khoản'),
  p('iam.user.create', 'S3', 'Tạo tài khoản'),
  p('iam.user.update', 'S3', 'Sửa tài khoản'),
  p('iam.session.view', 'S3', 'Xem phiên đăng nhập'),
  p('iam.session.revoke', 'S3', 'Thu hồi phiên đăng nhập'),
  p('iam.secret.view', 'S3', 'Xem bí mật/khoá mã hoá'),
  p('iam.secret.rotate', 'S3', 'Xoay khoá mã hoá'),

  // --- config ---
  p('config.reference.view', 'S3', 'Xem danh mục cấu hình'),
  p('config.reference.update', 'S3', 'Sửa danh mục cấu hình'),
  p('config.flag.view', 'S3', 'Xem cờ hệ thống'),
  p('config.flag.update', 'S3', 'Đổi cờ hệ thống (gồm cờ ảnh hưởng an toàn)'),

  // --- notification ---
  p('notification.template.view', 'S2', 'Xem mẫu thông báo'),
  p('notification.template.update', 'S3', 'Sửa mẫu thông báo'),
  p('notification.message.view', 'S2', 'Xem thông báo đã gửi'),
  p('notification.channel.configure', 'S3', 'Cấu hình kênh gửi ra ngoài'),

  // --- Mã CŨ, giữ tới khi decorator chuyển sang mã mới (doc 16 §D.7) ---
  p('cemetery.customer.view', 'S2', 'Xem khách hàng', {
    deprecated: 'crm.customer.view',
  }),
  p('cemetery.grave.hold', 'S2', 'Giữ chỗ lô mộ', {
    deprecated: 'cemetery.hold.hold',
  }),
  p('cemetery.contract.activate', 'S3', 'Cho hợp đồng hiệu lực', {
    deprecated: 'contract.record.activate',
  }),
  p('cemetery.document.view_sensitive', 'S3', 'Xem giấy tờ/định danh nhạy cảm', {
    deprecated: 'crm.person.view_sensitive + file.object.download_sensitive',
  }),
];

export const PERMISSION_CODES: readonly string[] = PERMISSION_CATALOG.map((p) => p.code);

export interface RoleDef {
  name: string;
  grants: { code: string; scope: string }[];
}

/* Who holds what. UNCHANGED in this change on purpose: seeding the catalog must not
 * move a single row in `role_permissions`. Replacing ADMIN's `*.*.*` with the 14
 * explicit roles is the next step, and it needs a before/after report of who holds
 * what (doc 16 §F PR-4, §G.2).
 */
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
