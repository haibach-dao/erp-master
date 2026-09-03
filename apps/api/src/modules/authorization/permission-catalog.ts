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
  /* Thêm 2026-09-02 cùng biểu phí cấp thẻ mộ. KHÔNG dùng lại ba từ gần nghĩa đã có:
   * `approve` là duyệt việc người khác ĐỀ NGHỊ, `override` là vượt một quy tắc kỹ thuật,
   * còn `waive` là THA một khoản tiền công ty đã có quyền thu. Hậu quả của nó là tài
   * chính và nó không cần ai đề nghị trước, nên phải cấp riêng và — quan trọng hơn —
   * đếm được riêng trong nhật ký: "tháng này ai đã tha bao nhiêu khoản" là câu kế toán
   * sẽ hỏi, và câu đó không trả lời được nếu miễn phí nấp dưới `override`. */
  'waive',
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
  /* S3 trong khi `.view`/`.create` chỉ S1, và đó không phải nhầm: sửa `defaultCapacity`
   * đổi sức chứa hiệu dụng của MỌI phần mộ chưa có `capacityOverride` cùng một lúc — và
   * từ 02/09/2026 con số đó là thứ nhân ra tiền in lại thẻ. Một lần gõ nhầm ở đây là thu
   * sai trên toàn bộ mộ cùng loại, âm thầm, không lỗi nào bật lên. */
  p('cemetery.grave_type.update', 'S3', 'Sửa số cốt mặc định của loại mộ'),
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
  /* Biểu phí cấp thẻ (chốt 02/09/2026): cấp giấy lần đầu 200.000đ phẳng, mỗi lần in lại
   * 50.000đ × SỐ CỐT CỦA PHẦN MỘ.
   *
   * Ba mã, không một mã, vì đây là ba việc mà gộp lại thì mất luôn khả năng tách nhiệm vụ:
   * BAN HÀNH đơn giá là quyết định chính sách; THU theo đơn giá đó là việc ở quầy; THA một
   * khoản đã có quyền thu là việc thứ ba và là chỗ tiền rò ra. Người thu tiền mà tự đặt
   * được giá, hoặc tự tha được tiền, thì không còn ai đối chứng.
   *
   * `set_price` là S3 dù chỉ THÊM dòng (bảng append-only): đơn giá mới áp cho mọi lần cấp
   * sau đó, nên một dòng gõ sai là thu sai hàng loạt, không thu hồi được. */
  p('cemetery.card_fee.view', 'S2', 'Xem biểu phí cấp thẻ mộ và số tiền phí từng lần cấp'),
  p('cemetery.card_fee.set_price', 'S3', 'Ban hành dòng biểu phí cấp thẻ mộ (chỉ thêm)'),
  p('cemetery.card_fee.waive', 'S3', 'Miễn phí cấp thẻ — lỗi công ty / khách nộp lại thẻ cũ'),
  /* THẺ NHÃN CHO PHẦN MỘ (đợt 1: chỉ xem và lọc, không chặn nghiệp vụ nào).
   *
   * `assign` gắn VÀ gỡ chung một mã ở đợt 1 — tách được, nhưng tách khi thẻ chưa chặn gì
   * là đẻ ra một mã không ai dùng khác đi. Ngày nào thẻ chặn được một việc thì tách gỡ ra
   * riêng, vì lúc đó "gỡ thẻ" mới là hành vi mở khoá một thứ đang bị chặn. */
  p('cemetery.plot_tag.view', 'S1', 'Xem thẻ nhãn trên phần mộ'),
  p('cemetery.plot_tag.assign', 'S2', 'Gắn và gỡ thẻ nhãn cho phần mộ'),
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
  /* THẺ NHÃN CHO KHÁCH HÀNG — S2 cả hai, và `view` KHÔNG phải S1 như thẻ mộ.
   *
   * Vì sao chặt hơn thẻ mộ: thẻ mộ nói về một VẬT, thẻ khách nói về một CON NGƯỜI. Kể cả
   * khi danh mục đã ép mỗi thẻ phải nói về hồ sơ hoặc giao dịch, bộ thẻ của một người vẫn
   * là một bức chân dung — "thiếu CCCD, thiếu giấy chứng tử, thiếu file hợp đồng" đọc
   * liền nhau nói nhiều hơn từng cái rời. Ai đọc được nó là một quyết định, không mặc định.
   *
   * QUYỀN MỞ DANH MỤC nằm ở `config.customer_tag.update` (S3), tách hẳn khỏi `assign` này:
   * người ở quầy GẮN được thẻ có sẵn, nhưng không TẠO được một thẻ mới nói về con người. */
  p('crm.customer_tag.view', 'S2', 'Xem thẻ nhãn trên hồ sơ khách hàng'),
  p('crm.customer_tag.assign', 'S2', 'Gắn và gỡ thẻ nhãn cho khách hàng'),
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
  p('burial.record.cancel', 'S3', 'Huỷ hồ sơ an táng (nhả cốt ra)'),

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
  /* BỎ DẦN 28/08/2026 — chủ doanh nghiệp quyết: phân quyền KHÔNG qua bước trình-rồi-duyệt.
   *
   * Hai mã này khai một quy trình hai bước (soạn thay đổi → người khác cho hiệu lực) mà
   * không route nào từng gọi tới. Câu hỏi đặt ra là bổ sung quy trình đó hay bỏ hẳn, và
   * câu trả lời là BỎ: người phân quyền chính là người có thẩm quyền phân quyền. Cấp mã
   * ADMIN cho một IT thì họ cũng phân quyền được cho người khác — đó là điều đã biết và
   * đã chấp nhận khi cấp. Bắt họ tự trình rồi tự duyệt là một vòng thủ tục rỗng.
   *
   * Nên với RIÊNG việc phân quyền: bấm là hiệu lực. Nguyên tắc "Đã duyệt ≠ Hiệu lực" ở
   * hiến pháp AI vẫn nguyên giá trị cho hồ sơ nghiệp vụ — nó không áp cho đường này.
   *
   * HỆ QUẢ ĐANG CHẤP NHẬN: không có ai thứ hai nhìn lại trước khi một mã S3 đổi chủ. Thứ
   * thay cho cặp mắt đó là AUDIT — `AUTHZ.PERMISSION_GRANTED`/`_REVOKED` ghi ảnh trước/sau
   * mỗi lần bấm. Phát hiện SAU, không chặn TRƯỚC. Đó là đánh đổi đã chọn, không phải khe hở.
   */
  p('authz.change.submit', 'S2', 'Trình thay đổi ma trận quyền', {
    deprecated: 'authz.role_permission.grant',
  }),
  p('authz.change.approve', 'S3', 'Cho thay đổi ma trận quyền HIỆU LỰC', {
    deprecated: 'authz.role_permission.grant + authz.role_permission.revoke',
  }),
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
  /* QUẢN TRỊ HAI DANH MỤC THẺ NHÃN — hai mã, đúng như hai danh mục ở tầng dữ liệu.
   *
   * Anh Bách chốt 03/09/2026: thẻ mộ và thẻ khách TÁCH RIÊNG, cả hai TOÀN HỆ. Hai mã ở đây
   * là nửa quan trọng của việc tách ấy: mở một thẻ MỘ mới ("cần sửa bia") là việc vận hành
   * thường ngày; mở một thẻ KHÁCH mới là lúc có thể lọt vào hệ một câu nói về con người.
   * Hai mức rủi ro thì phải cấp được cho hai nhóm người khác nhau.
   *
   * S3 cả hai, và mức đó KHÔNG hạ được: danh mục là dữ liệu TOÀN HỆ, không chia theo công
   * ty. Một dòng mở ở đây dùng được ở MỌI công ty.
   *
   * KHÔNG dùng lại `config.reference.update` ngay dưới: mã đó hiện chưa route nào dùng,
   * nhưng QT_NGHIEP_VU ĐANG CẦM `config.reference.view`. Gắn chức năng mới vào một mã đã
   * cấp là cho một vai thêm năng lực mà chưa ai duyệt lần nào. */
  p('config.plot_tag.update', 'S3', 'Quản trị danh mục thẻ nhãn phần mộ (toàn hệ)'),
  p('config.customer_tag.update', 'S3', 'Quản trị danh mục thẻ nhãn khách hàng (toàn hệ)'),
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
  /* Xem biểu phí thẻ đi cùng gói ĐỌC nghĩa trang: người ở quầy phải trả lời được "cấp thẻ
   * này hết bao nhiêu" trước khi khách quyết. Nó cũng chảy sang KTNB_KIEM_TOAN và
   * DPO_DLCN — đúng chủ ý, hai ghế đó chỉ đọc. */
  'cemetery.card_fee.view',
  /* Xem thẻ nhãn mộ đi cùng gói ĐỌC: thẻ mộ nói về VẬT — "bia nứt", "nền lún" — nên ai đọc
   * được danh sách mộ thì đọc được tình trạng của nó. Thẻ KHÁCH thì KHÔNG đi cùng gói này,
   * nó phải cấp riêng cho từng vai: xem chú thích ở `crm.customer_tag.view`. */
  'cemetery.plot_tag.view',
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
    /* Thẻ nhãn khách — front desk là nơi PHÁT HIỆN ra "thiếu CCCD", "thiếu giấy chứng tử",
     * nên họ phải ghi lại được. Họ GẮN thẻ có sẵn nhưng KHÔNG mở được danh mục
     * (`config.customer_tag.update` là S3, ở ghế khác) — nên không ai ở quầy tạo được một
     * thẻ mới nói về con người. Đó là toàn bộ ý nghĩa của việc tách hai mã này. */
    'crm.customer_tag.view',
    'crm.customer_tag.assign',
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
    /* MÃ GHI ĐẦU TIÊN của vai này, thêm 03/09/2026 cùng thẻ nhãn.
     *
     * Đo được trước khi thêm: cả 9 mã cũ của vai đều là `.view` / `.search` / upload tệp —
     * người DUY NHẤT nhìn thấy bia nứt không có cách nào ghi lại điều mình thấy. Thẻ
     * `#can-sua-bia`, thứ hữu ích nhất trong cả tính năng, sẽ không ai gắn được.
     *
     * An toàn ở đợt 1 vì thẻ CHƯA chặn nghiệp vụ nào: gắn thẻ không khoá đường bán, không
     * đổi trạng thái mộ, không đụng tiền. Phạm vi vai là SITE nên chỉ gắn được trong nghĩa
     * trang mình phụ trách.
     *
     * NGÀY NÀO THẺ CHẶN ĐƯỢC MỘT VIỆC, phải rà lại đúng dòng này: lúc đó gắn thẻ trở thành
     * hành vi khoá được đường bán, và nó không còn thuộc về một vai chỉ-đọc-cộng-một-mã. */
    'cemetery.plot_tag.assign',
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
    /* Gắn thẻ mộ: ghế thẩm định tác nghiệp là người đi thực địa cùng bảo trì, và là người
     * xác nhận việc đã xong để gỡ thẻ. Phạm vi SITE bó họ vào nghĩa trang mình phụ trách. */
    'cemetery.plot_tag.assign',
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
    'burial.record.view', // đọc dẫn xuất cho verify/cancel
    'burial.record.verify',
    /* Huỷ hồ sơ an táng: ghế THẨM ĐỊNH tác nghiệp là nơi hợp lý nhất — họ đã là người
     * duyệt hồ sơ, phạm vi SITE bó họ vào nghĩa trang mình phụ trách, và họ KHÔNG có
     * `burial.record.create` nên không tự soạn rồi tự huỷ được. Cùng nếp với
     * `service.subscription.cancel` ngay dưới. */
    'burial.record.cancel',
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
    /* Tha một khoản đã có quyền thu là quyết định về tiền, nên nó ở ghế CHO HIỆU LỰC chứ
     * không ở quầy. Cố ý KHÔNG cấp cho CSKH_TIEP_DON và THU_NGAN: người thu tiền mà tự
     * tha được tiền thì không còn ai đối chứng. */
    'cemetery.card_fee.waive',
    /* Số cốt của loại mộ là dữ liệu tính tiền và chỉ có `companyId`, không có `cemeteryId`
     * — nên nó thuộc ghế COMPANY này, không thuộc QL_NGHIA_TRANG vốn là ghế SITE. */
    'cemetery.grave_type.update',
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
    /* Bỏ 28/08/2026 cùng quyết định phân quyền không qua trình-rồi-duyệt: hai mã
     * `authz.change.*` không gate route nào, nên giữ ở đây là ghi một quyền không tồn tại
     * vào bản chiếu ma trận. */
  ]),

  HD_GIA: role('Hội đồng giá', 'Duyệt giá — tách hẳn khỏi người bán', 'COMPANY', [
    ...CEMETERY_READ_ALL,
    /* Ban hành biểu phí thẻ về đúng ghế duyệt giá, KHÔNG về ghế thu tiền. Đây là mã
     * `set_price` đầu tiên thực sự có vai cầm — hai mã đặt giá còn lại
     * (`cemetery.price.set_price`, `cemetery.plot.override`) hiện chưa vai nào giữ. */
    'cemetery.card_fee.set_price',
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
      /* Bỏ 28/08/2026 — xem chú thích ở `authz.change.submit` trong danh mục. */
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
    'Đọc ma trận quyền và giữ danh mục. KHÔNG sửa được ma trận (28/08/2026).',
    'GROUP',
    [
      ...CEMETERY_READ_ALL,
      'authz.permission.view',
      'authz.role.view',
      'authz.matrix.export',
      /* Bỏ 28/08/2026 — xem chú thích ở `authz.change.submit` trong danh mục. */
      'config.reference.view',
      /* Hai danh mục thẻ về đúng ghế "giữ danh mục". Vai này CỐ Ý không có mã `assign` nào
       * — người mở danh mục không phải người gắn thẻ, và ngược lại. Đó là cặp tách nhiệm vụ
       * mà `authz-invariants` canh: ai vừa mở được thẻ mới vừa gắn được thì tự định đoạt
       * trọn vẹn cái nhãn dán lên một con người. */
      'config.plot_tag.update',
      'config.customer_tag.update',
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
