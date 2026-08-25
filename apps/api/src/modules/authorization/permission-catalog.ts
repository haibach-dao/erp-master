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

/* ---------------------------------------------------------------------------
 * WHO HOLDS WHAT — role × permission matrix (blueprint doc 16 §E.2).
 *
 * Reading rules applied when transcribing the matrix:
 *  - "C" -> granted. "–" -> not granted.
 *  - "A" (only with approval) -> NOT granted at Gate 1: the approval workflow (G0-A7)
 *    is still deferred, so "A" would otherwise mean "granted with no gate behind it".
 *  - "X" (forbidden) -> not granted. An explicit DENY row (deny beats allow) needs the
 *    deny table from a later step; until then "X" and "–" behave identically at runtime,
 *    and that gap is real rather than covered here.
 *  - A role that may `verify`/`approve`/`cancel`/`export` a thing is also granted the
 *    matching read leaf. The §E.2 group-2 table is written as a delta over the
 *    operational baseline, and a role that can verify a contract it cannot read is not
 *    a role. Every such derived read is marked `// đọc dẫn xuất`.
 *
 * `*.*.*` for ADMIN is deliberately left in place. Removing it in the same change that
 * introduces explicit roles is how every live operator gets locked out at once (§G.2);
 * it goes when the wildcard is tightened, one step later.
 * --------------------------------------------------------------------------- */

export interface RoleDef {
  name: string;
  description: string;
  grants: { code: string; scope: string }[];
}

/** Role-level default scope. Per-assignment narrowing lives in role_assignments.scope. */
function role(name: string, description: string, scope: string, codes: string[]): RoleDef {
  return { name, description, grants: codes.map((code) => ({ code, scope })) };
}

// Read leaves every operational role needs to see the catalogue it works in.
const CATALOG_READ = [
  'cemetery.reference.view',
  'cemetery.site.view',
  'cemetery.grave_type.view',
  'cemetery.plot.view',
];
const FILE_BASIC = [
  'file.object.view',
  'file.object.upload',
  'file.object.confirm',
  'file.object.download',
];
// "cemetery.*.view" in the group-2 matrix — reading the catalogue and the assets.
const CEMETERY_READ_ALL = [
  ...CATALOG_READ,
  'cemetery.price.view',
  'cemetery.hold.view',
  'cemetery.plot.view_history',
];

export const ROLE_CATALOG: Readonly<Record<string, RoleDef>> = {
  // --- Vai cũ. Giữ nguyên tới khi wildcard bị siết, nếu không là khoá cửa cả hệ.
  ADMIN: {
    name: 'Quản trị',
    description: 'Vai cũ mang `*.*.*`. Doc 16 Q13 đề xuất BỎ HẲN sau khi 14 vai chạy thật.',
    grants: [{ code: '*.*.*', scope: 'GROUP' }],
  },
  STAFF: {
    name: 'Nhân viên (vai cũ)',
    description: 'Vai cũ với 2 mã deprecated. Thay bằng vai tác nghiệp tương ứng.',
    grants: [
      { code: 'cemetery.customer.view', scope: 'COMPANY' },
      { code: 'cemetery.grave.hold', scope: 'COMPANY' },
    ],
  },

  // --- Nhóm 1: vai tác nghiệp ---
  CSKH_TIEP_DON: role('Tiếp đón & CSKH', 'Front desk — tiếp khách, tra hồ sơ', 'COMPANY', [
    ...CATALOG_READ,
    'cemetery.price.view',
    'cemetery.hold.view',
    'crm.customer.view',
    'crm.customer.create',
    'crm.person.view',
    'contract.record.view',
    'contract.party.view',
    'service.catalog.view',
    'service.price.view',
    'service.subscription.view',
    ...FILE_BASIC,
  ]),

  KD_KINH_DOANH: role('Kinh doanh', 'Giữ chỗ, soạn hợp đồng, bán dịch vụ', 'COMPANY', [
    ...CATALOG_READ,
    'cemetery.plot.search',
    'cemetery.price.view',
    'cemetery.hold.view',
    'cemetery.hold.hold',
    'crm.customer.view',
    'crm.customer.create',
    'crm.customer.search',
    'crm.person.view',
    'crm.person.create',
    'crm.relationship.view',
    'crm.relationship.create',
    'crm.consent.view',
    'crm.consent.record',
    'contract.record.view',
    'contract.record.search',
    'contract.record.create',
    'contract.record.update',
    'contract.amount.view_sensitive',
    'contract.party.view',
    'contract.party.assign',
    'service.catalog.view',
    'service.price.view',
    'service.subscription.view',
    'service.subscription.create',
    'service.subscription.renew',
    'service.subscription.search',
    'service.subscription.view_price',
    ...FILE_BASIC,
  ]),

  HS_NHAN_THAN: role(
    'Hồ sơ nhân thân & giấy tờ',
    'Lớp Person/CCCD/quan hệ, dùng chung liên công ty (G0-E5.1)',
    'COMPANY',
    [
      'cemetery.reference.view',
      'crm.customer.view',
      'crm.customer.create',
      'crm.customer.search',
      'crm.person.view',
      'crm.person.create',
      'crm.person.update',
      'crm.person.view_sensitive',
      'crm.relationship.view',
      'crm.relationship.create',
      'crm.consent.view',
      'crm.consent.record',
      'contract.party.view',
      'burial.deceased.view',
      'burial.deceased.create',
      'burial.record.view',
      'burial.record.search',
      ...FILE_BASIC,
      'file.object.download_sensitive',
    ],
  ),

  NV_AN_TANG: role('Nghiệp vụ an táng', 'Thực hiện an táng — tách hẳn khỏi kinh doanh', 'COMPANY', [
    ...CATALOG_READ,
    'crm.customer.view',
    'crm.person.view',
    'crm.relationship.view',
    'contract.record.view',
    'contract.party.view',
    'burial.deceased.view',
    'burial.deceased.create',
    'burial.record.view',
    'burial.record.create',
    'burial.record.search',
    'service.catalog.view',
    ...FILE_BASIC,
    'file.object.download_sensitive',
  ]),

  NV_BAO_TRI: role('Chăm sóc mộ & bảo trì', 'Bảo trì tại một nghĩa trang', 'SITE', [
    ...CATALOG_READ,
    'cemetery.plot.search',
    'cemetery.plot.view_history',
    'burial.record.view',
    'service.catalog.view',
    'service.subscription.view',
    'file.object.view',
    'file.object.upload',
    'file.object.confirm',
  ]),

  THU_NGAN: role('Thu ngân', 'Thu tiền, ghi nhận giao dịch', 'COMPANY', [
    ...CATALOG_READ,
    'cemetery.price.view',
    'crm.customer.view',
    'contract.record.view',
    'contract.record.search',
    'contract.amount.view_sensitive',
    'contract.party.view',
    'service.catalog.view',
    'service.price.view',
    'service.subscription.view',
    'service.subscription.create',
    'service.subscription.renew',
    'service.subscription.search',
    'service.subscription.view_price',
    'service.transaction.view',
    ...FILE_BASIC,
  ]),

  // --- Nhóm 2: quản lý, kiểm soát, quản trị ---
  QL_NGHIA_TRANG: role('Quản lý nghĩa trang', 'Ghế THẨM ĐỊNH tác nghiệp', 'SITE', [
    ...CEMETERY_READ_ALL,
    'cemetery.plot.set_status',
    'cemetery.hold.release',
    'crm.customer.search',
    'crm.customer.view', // đọc dẫn xuất cho search
    'crm.person.view',
    'crm.relationship.view', // đọc dẫn xuất cho verify/cancel
    'crm.relationship.verify',
    'crm.relationship.cancel',
    'crm.consent.view',
    'crm.consent.withdraw',
    'contract.record.view', // đọc dẫn xuất cho verify
    'contract.record.search',
    'contract.record.verify',
    'contract.amount.view_sensitive',
    'burial.record.view', // đọc dẫn xuất cho verify
    'burial.record.verify',
    'burial.deceased.view',
    'service.subscription.view', // đọc dẫn xuất cho cancel
    'service.subscription.cancel',
    'service.subscription.search',
    'service.subscription.view_price',
    'service.transaction.view',
    'service.revenue.view',
    ...FILE_BASIC,
    'file.object.download_sensitive',
    'audit.event.view',
    'authz.permission.view',
    'authz.role.view',
    'authz.matrix.export',
    'notification.template.view',
    'notification.template.update',
    'notification.message.view',
  ]),

  GD_CONG_TY: role('Ban giám đốc công ty', 'Ghế CHO HIỆU LỰC', 'COMPANY', [
    ...CEMETERY_READ_ALL,
    'cemetery.plot.set_status',
    'cemetery.plot.export',
    'cemetery.hold.release',
    'crm.customer.search',
    'crm.customer.view', // đọc dẫn xuất cho search
    'crm.person.view',
    'crm.relationship.view', // đọc dẫn xuất cho verify/cancel
    'crm.relationship.verify',
    'crm.relationship.cancel',
    'crm.consent.view',
    'crm.consent.withdraw',
    'contract.record.view', // đọc dẫn xuất cho approve/activate
    'contract.record.search',
    'contract.record.approve',
    'contract.record.activate',
    'contract.record.cancel',
    'contract.record.export',
    'contract.amount.view_sensitive',
    'burial.record.view', // đọc dẫn xuất cho complete
    'burial.record.complete',
    'burial.record.export',
    'burial.deceased.view',
    'service.subscription.view', // đọc dẫn xuất cho cancel
    'service.subscription.cancel',
    'service.subscription.search',
    'service.subscription.view_price',
    'service.transaction.view',
    'service.period.close',
    'service.revenue.view',
    ...FILE_BASIC,
    'file.object.download_sensitive',
    'audit.event.view',
    'audit.integrity.view',
    'authz.permission.view',
    'authz.role.view',
    'authz.matrix.export',
    'authz.change.approve',
  ]),

  HD_GIA: role('Hội đồng giá', 'Duyệt giá — tách hẳn khỏi người bán', 'COMPANY', [
    ...CEMETERY_READ_ALL,
    'contract.amount.view_sensitive',
    'service.catalog.view',
    'service.price.view',
    'service.subscription.search',
    'service.subscription.view',
    'service.subscription.view_price',
    'service.revenue.view',
  ]),

  KT_DOI_SOAT: role('Kế toán đối soát', 'CHỈ ĐỌC — đối soát số liệu', 'COMPANY', [
    ...CEMETERY_READ_ALL,
    'cemetery.plot.export',
    'contract.record.view', // đọc dẫn xuất cho export
    'contract.record.search',
    'contract.record.export',
    'contract.amount.view_sensitive',
    'service.subscription.view',
    'service.subscription.search',
    'service.subscription.view_price',
    'service.transaction.view',
    'service.revenue.view',
    'audit.event.view',
    'audit.integrity.view',
  ]),

  KTNB_KIEM_TOAN: role('Kiểm toán nội bộ', 'CHỈ ĐỌC, toàn tập đoàn', 'GROUP', [
    ...CEMETERY_READ_ALL,
    'cemetery.plot.export',
    'crm.customer.search',
    'crm.customer.view', // đọc dẫn xuất cho search
    'crm.person.view',
    'crm.consent.view',
    'contract.record.view', // đọc dẫn xuất cho export
    'contract.record.search',
    'contract.record.export',
    'contract.amount.view_sensitive',
    'burial.record.view', // đọc dẫn xuất cho export
    'burial.record.export',
    'burial.deceased.view',
    'service.subscription.view',
    'service.subscription.search',
    'service.subscription.view_price',
    'service.transaction.view',
    'service.revenue.view',
    'audit.event.view',
    'audit.user_activity.view',
    'audit.integrity.view',
    'authz.permission.view',
    'authz.role.view',
    'authz.matrix.export',
    'iam.user.view',
    'iam.session.view',
    'config.flag.view',
    'notification.message.view',
  ]),

  DPO_DLCN: role('Cán bộ bảo vệ dữ liệu cá nhân', 'NĐ13 + G0-A6. CHỈ ĐỌC nghiệp vụ.', 'GROUP', [
    'crm.customer.view',
    'crm.customer.search',
    'crm.person.view',
    'crm.person.view_sensitive',
    'crm.person.set_protected',
    'crm.consent.view',
    'crm.consent.withdraw',
    'burial.deceased.view',
    'audit.event.view',
    'audit.event.view_sensitive',
    'audit.user_activity.view',
    'authz.permission.view',
    'authz.role.view',
    'authz.matrix.export',
    'iam.user.view',
    'iam.session.view',
    'config.flag.view',
    'notification.message.view',
  ]),

  QT_HE_THONG: role(
    'Quản trị hệ thống',
    'Hạ tầng. KHÔNG xem dữ liệu nhạy cảm nghiệp vụ, KHÔNG xem doanh thu.',
    'GROUP',
    [
      'audit.integrity.view',
      'authz.permission.view',
      'authz.role.view',
      'authz.matrix.export',
      'authz.change.submit',
      'iam.user.view',
      'iam.user.create',
      'iam.user.update',
      'iam.session.view',
      'iam.session.revoke',
      'config.flag.view',
    ],
  ),

  QT_NGHIEP_VU: role(
    'Quản trị nghiệp vụ',
    'Soạn ma trận quyền và danh mục. CHỈ submit, KHÔNG approve.',
    'GROUP',
    [
      ...CEMETERY_READ_ALL,
      'authz.permission.view',
      'authz.role.view',
      'authz.matrix.export',
      'authz.change.submit',
      'config.reference.view',
      'notification.template.view',
      'notification.template.update',
    ],
  ),

  // --- Ghế máy. Hai mã, và cả hai còn phải bị giới hạn ở tầng service (PR-12):
  //     set_status chỉ cho Held->Available, cancel chỉ cho thuê bao đã hết hạn.
  SYSTEM_WORKER: role(
    'Ghế máy (worker)',
    'Tiến trình nền — hold-expiry, service-sweep',
    'COMPANY',
    ['cemetery.plot.set_status', 'service.subscription.cancel'],
  ),

  // BREAK_GLASS cố ý KHÔNG tạo ở đây. Không có `valid_to` trên role_assignments thì nó
  // là siêu quyền VĨNH VIỄN, không phải vai khẩn cấp có hạn giờ (doc 16 §E.1).
};
