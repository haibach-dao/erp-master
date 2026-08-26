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
  /* Thêm 2026-08-25: tách "xem thông tin liên lạc" khỏi "xem CCCD". Lý do phải ghi ở đây
   * vì bộ action là danh sách ĐÓNG — thêm một từ là một quyết định, không phải một chuỗi
   * gõ vội ở call site. */
  'view_contact',
  /* Thêm 2026-08-26 cùng bảng `person_bank_accounts`. Tách khỏi `view_sensitive` vì hai
   * rủi ro khác nhau: CCCD lộ ra là rủi ro ĐỊNH DANH, số tài khoản lộ ra là rủi ro TÀI
   * CHÍNH. Người giữ hồ sơ nhân thân cần cái thứ nhất để làm thủ tục; họ không cần cái
   * thứ hai. Gộp lại thì "cho xem CCCD" đồng nghĩa "cho xem số tài khoản" — leo thang do
   * đặt tên mã, không do ai quyết định. */
  'view_financial',
  /* Thêm 2026-08-26 cùng chức năng cấp thẻ quản lý mộ. KHÔNG dùng lại `export`: `export`
   * là trích dữ liệu ra tệp cho người trong hệ dùng tiếp, còn `print` là CẤP một giấy tờ
   * có số lần cấp, có chữ ký, có giá trị đối chứng với khách. Hai việc khác nhau về hậu
   * quả nên phải đếm được riêng trong nhật ký. */
  'print',
  /* Thêm 2026-08-26. KHÔNG dùng lại `assign`: gán là cho một phần mộ CHƯA có chủ, sang
   * tên là chuyển quyền ĐANG có của người này sang người khác. Hai việc khác nhau về hậu
   * quả (một cái tạo quyền mới, một cái tước quyền của ai đó) nên phải cấp được riêng và
   * đếm được riêng trong nhật ký. */
  'transfer',
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
  /* KHÔNG có `*.*.*` trong danh mục. Bỏ hẳn theo G0-Q13, và bỏ khỏi DANH MỤC chứ không
   * chỉ bỏ khỏi vai: mã còn trong danh mục là mã còn cấp lại được từ màn hình quản trị,
   * và một lần cấp lại là xoá sạch ý nghĩa của việc bỏ nó. Guard từ chối mã không có
   * trong danh mục, nên nó cũng không còn là một yêu cầu hợp lệ.
   */

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
  p('cemetery.plot.update', 'S2', 'Sửa lô mộ (gồm toạ độ sơ đồ mặt bằng)'),
  /* Thẻ quản lý mộ. Hai mã tách nhau vì hai hành vi khác hẳn: XEM TRƯỚC không để lại gì,
   * CẤP THẺ thì tăng số lần cấp và ghi nhật ký vĩnh viễn. Gộp một mã thì mỗi lần liếc
   * qua thẻ đều thành một lần cấp — đúng lỗi hệ cũ mắc phải. */
  p('cemetery.card.view', 'S2', 'Xem trước thẻ quản lý mộ (không cấp số)'),
  p('cemetery.card.print', 'S3', 'Cấp/in thẻ quản lý mộ — tăng số lần cấp, ghi nhật ký'),
  /* Quyền sử dụng phần mộ = ai đứng tên mộ HÔM NAY.
   *
   * `assign` là S3 vì nó tạo ra quyền sở hữu mà KHÔNG đi qua hợp đồng — bình thường
   * `contract.record.activate` mới sinh ra quyền sử dụng. Đường tắt này có thật trong
   * nghiệp vụ (chuyển từ hệ cũ, sửa sai, cấp lại), nhưng nó vượt mặt chuỗi thẩm định nên
   * phải là một mã riêng, cấp riêng, và ghi nhật ký riêng — chứ không nấp trong
   * `cemetery.plot.set_status`. */
  p('cemetery.usage_right.view', 'S2', 'Xem quyền sử dụng phần mộ (ai đứng tên)'),
  p('cemetery.usage_right.assign', 'S3', 'Gán phần mộ cho chủ mộ, không qua hợp đồng'),
  /* Thu hồi: mộ trở về TRỐNG. Chặn khi mộ còn người an táng — một phần mộ có người nằm
   * mà không ai đứng tên là hồ sơ không ai chịu trách nhiệm. */
  p('cemetery.usage_right.release', 'S3', 'Thu hồi quyền sử dụng, mộ trở về trống'),
  /* Sang tên: đây là đường THỪA KẾ. Gán mộ chặn người đã mất, nên nếu không có đường này
   * thì mộ của người đã mất kẹt vĩnh viễn ở tên họ. */
  p('cemetery.usage_right.transfer', 'S3', 'Sang tên phần mộ cho chủ mới (kể cả thừa kế)'),
  p('cemetery.hold.view', 'S1', 'Xem phiếu giữ chỗ'),
  p('cemetery.hold.hold', 'S2', 'Giữ chỗ lô mộ'),
  p('cemetery.hold.release', 'S3', 'Huỷ giữ chỗ lô mộ'),

  // --- crm ---
  p('crm.person.view', 'S2', 'Xem nhân thân (đã mask)'),
  p('crm.person.create', 'S2', 'Tạo nhân thân'),
  p('crm.person.update', 'S2', 'Sửa nhân thân'),
  /* Tách khỏi `view_sensitive` (2026-08-25). Điện thoại/email/địa chỉ/ngày sinh là dữ
   * liệu liên lạc — cần cho người bán và người thu tiền làm việc hàng ngày. CCCD thì
   * không. Gộp hai thứ vào một mã nghĩa là muốn cho ai xem số điện thoại thì phải cho họ
   * luôn CCCD đầy đủ; đó là leo thang do thiết kế mã, không do ai quyết định. */
  p('crm.person.view_contact', 'S2', 'Xem thông tin liên lạc (điện thoại/email/địa chỉ/ngày sinh)'),
  p('crm.person.view_sensitive', 'S3', 'Xem CCCD/định danh không mask'),
  /* Số tài khoản ngân hàng của nhân thân. CỐ Ý chưa gán cho vai nào ngoài ADMIN: nghĩa
   * trang chưa có nghiệp vụ nào chi trả cho thân nhân, nên chưa ai cần. Khi có nghiệp vụ
   * (hoàn tiền, chi hỗ trợ), chủ doanh nghiệp quyết vai nào được cấp — không phải AI. */
  p('crm.person.view_financial', 'S3', 'Xem số tài khoản ngân hàng của nhân thân'),
  p('crm.person.export', 'S3', 'Trích xuất nhân thân ra ngoài hệ'),
  p('crm.person.set_protected', 'S3', 'Đặt cờ bảo vệ nhân thân (LÀN CẤM)'),
  p('crm.person.view_protected', 'S3', 'Xem nhân thân được bảo vệ (LÀN CẤM)'),
  p('crm.person.ai_ingest', 'S3', 'Đưa dữ liệu nhân thân vào công cụ AI dùng chung'),
  p('crm.customer.view', 'S2', 'Xem khách hàng'),
  p('crm.customer.search', 'S2', 'Tra cứu khách hàng theo tiêu chí tự nhập'),
  p('crm.customer.create', 'S2', 'Tạo khách hàng'),
  p('crm.customer.update', 'S2', 'Sửa hồ sơ khách hàng'),
  /* XOÁ HẲN, không phải đóng hồ sơ. S3 vì không đảo ngược được.
   *
   * Vì sao vẫn có: dữ liệu nhập thử và dữ liệu nhập sai lúc đầu phải dọn được, nếu không
   * người ta sẽ dọn bằng cách sửa đè lên một hồ sơ có thật — tệ hơn nhiều. Service chặn
   * xoá khi còn bất kỳ thứ gì trỏ tới, nên mã này không phải cửa xoá lịch sử. */
  p('crm.customer.delete', 'S3', 'Xoá hẳn hồ sơ khách hàng chưa phát sinh nghiệp vụ'),
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
  p('authz.rule.view', 'S2', 'Xem chuỗi luật truy cập'),
  p('authz.rule.update', 'S3', 'Sửa chuỗi luật truy cập (thêm/đổi thứ tự/thu hồi)'),

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

/* Mọi mã trong danh mục, trừ chính `*.*.*`.
 *
 * ADMIN được cấp TƯỜNG MINH toàn bộ danh mục thay vì mang một wildcard. Kết quả hôm nay
 * y hệt — nhưng cơ chế thì khác hẳn, và khác đúng ở chỗ quan trọng: mã MỚI thêm vào danh
 * mục sau này KHÔNG tự chảy vào ADMIN nữa. Với wildcard, mọi leaf của mọi module tương
 * lai tự động thuộc ADMIN mà không ai quyết định điều đó lần nào.
 *
 * Đây chính là nhãn "New" của OPERA: mã mới xuất hiện thì phải có người rà và cấp, chứ
 * không được tự được cấp. Bản chiếu `scripts/authz-report.ts` vì thế đọc được thành một
 * danh sách hữu hạn, thay vì một dòng `*.*.*` che hết mọi câu hỏi.
 */
const ALL_CODES = PERMISSION_CATALOG.filter((d) => d.code !== '*.*.*').map((d) => d.code);

export const ROLE_CATALOG: Readonly<Record<string, RoleDef>> = {
  // --- Vai cũ. Giữ nguyên tới khi wildcard bị siết, nếu không là khoá cửa cả hệ.
  ADMIN: {
    name: 'Quản trị',
    description:
      'Toàn bộ danh mục, cấp TƯỜNG MINH. Không còn wildcard: mã mới không tự chảy vào đây (G0-Q13).',
    grants: ALL_CODES.map((code) => ({ code, scope: 'GROUP' })),
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
    /* Front desk là nơi trao thẻ cho khách, nên có cả xem trước lẫn cấp thẻ. LƯU Ý: họ
     * KHÔNG có `crm.person.view_sensitive`, nên thẻ họ in ra hiện CCCD dạng `079***123`.
     * Đó là hành vi ĐÚNG theo thiết kế, không phải lỗi — nếu nghiệp vụ đòi thẻ phải có
     * CCCD đầy đủ thì đó là quyết định của chủ doanh nghiệp về việc cấp thêm mã S3. */
    'cemetery.usage_right.view',
    'cemetery.card.view',
    'cemetery.card.print',
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
    'crm.customer.update',
    'crm.customer.search',
    'crm.person.view',
    'crm.person.view_contact', // G0-Q1 sửa 2026-08-25: người bán cần gọi được cho khách
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
      'crm.person.view_contact', // giữ nguyên tầm nhìn cũ sau khi tách mã
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
    'crm.person.view',
    'crm.person.view_contact', // G0-Q1 sửa 2026-08-25: người thu tiền cần liên hệ được khách
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
    /* Toạ độ sơ đồ là dữ liệu MẶT BẰNG — người quản lý nghĩa trang là người biết thực địa,
     * và vai này có phạm vi SITE nên chỉ sửa được sơ đồ nghĩa trang mình phụ trách. */
    'cemetery.plot.update',
    'cemetery.usage_right.view',
    /* Ghế THẨM ĐỊNH tác nghiệp là nơi hợp lý nhất cho đường tắt này: họ đã là người
     * duyệt hồ sơ an táng và đổi trạng thái mộ, và phạm vi SITE bó họ vào nghĩa trang
     * mình phụ trách. */
    'cemetery.usage_right.assign',
    'cemetery.usage_right.release',
    'cemetery.usage_right.transfer',
    'cemetery.card.view',
    'cemetery.card.print',
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
    /* G0-Q10: ghế cho hiệu lực cũng SOẠN được hợp đồng, để hợp đồng do giám đốc soạn đi
     * thẳng Draft -> Active mà không phải chờ ai thẩm định. Cố ý KHÔNG cấp `create` cho
     * QL_NGHIA_TRANG (vai đang giữ `verify`): nếu cấp, một người tự soạn rồi tự thẩm
     * định hợp đồng của mình, và thẩm định là bước duy nhất có người thật đọc lại nội
     * dung. Ở đây giám đốc tự soạn tự cho hiệu lực được — chủ doanh nghiệp đã cân nhắc
     * và chấp nhận, bù bằng audit; nhưng chuỗi soạn -> thẩm định thì luôn có hai người. */
    'contract.record.create',
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
    'crm.person.view_contact', // giữ nguyên tầm nhìn cũ sau khi tách mã
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
