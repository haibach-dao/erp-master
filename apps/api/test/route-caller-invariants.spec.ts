import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanRouteCallers } from './route-caller-scan';

const SRC = join(__dirname, '..', 'src');

/* RATCHET PHẠM VI TẦNG ROUTE. Đọc chú thích dài ở `route-caller-scan.ts` trước.
 *
 * Tóm lại: `@RequirePermission` gate được "có được gọi endpoint này hay không", KHÔNG gate
 * "lên bản ghi nào". Route nào không truyền người gọi xuống service thì service không có gì
 * để kiểm phạm vi. Cái lưới `scope-check-invariants` không thấy nhóm này, vì nó soi method
 * NHẬN `Caller` — và điểm mù đó đã sinh ra IDOR thật (`ContractsService.get`,
 * `revealNationalId`).
 *
 * HAI SỔ, không một. "Đúng khi không bó" và "phải bó mà chưa bó" là hai thứ khác nhau; gộp
 * lại thì sổ nợ mất nghĩa — không ai đọc ra được còn bao nhiêu việc.
 */

/* SỔ 1 — route ĐÚNG khi không bó phạm vi bản ghi, kèm LÝ DO.
 *
 * Điểm chung: không có BẢN GHI ĐÍCH nào để bó. Hoặc là dữ liệu tham chiếu/danh mục, hoặc là
 * đang TẠO ra thứ chưa tồn tại, hoặc đã có phép kiểm HẸP HƠN phạm vi.
 */
const NO_RECORD_SCOPE: Readonly<Record<string, string>> = {
  'modules/authorization/authz-matrix.controller.ts:listRoles':
    'Danh mục VAI. Vai là dữ liệu toàn cục (`Role` không có `companyId`), không thuộc công ty nào nên không có gì để bó.',
  'modules/authorization/authz-matrix.controller.ts:listPermissions':
    'Danh mục MÃ QUYỀN — tập đóng, giống bảng tham chiếu. Màn hình cần nó để mời chọn mã thay vì gõ tay.',
  'modules/cemetery/cemetery.controller.ts:relationshipTypes':
    'Dữ liệu tham chiếu (quan hệ nhân thân), không thuộc công ty nào.',
  'modules/cemetery/cemetery.controller.ts:createCompany':
    'Đang TẠO công ty — chưa có công ty nào để bó theo. Bản chất là việc mức GROUP; gate `org.company.create` chỉ cấp cho vai toàn tập đoàn.',
  'modules/files/files.controller.ts:presign':
    'Tạo file MỚI: chưa có bản ghi nào trỏ tới nó, nên chưa quy được phạm vi. Neo là `uploadedBy`, đặt từ người gọi. Đường ĐỌC file thì đã bó (xem `assertFileInScope`).',
  'modules/files/files.controller.ts:confirm':
    'Đã chặn CHỈ người tải lên — hẹp hơn phạm vi, nên thêm phép kiểm phạm vi không làm nó chặt hơn.',
  'modules/holds/holds.controller.ts:expireStale':
    'Việc bảo trì: quét theo THỜI GIAN và đóng các phiếu giữ đã quá hạn, không nhắm vào bản ghi nào do người gọi chỉ định.',
};

/* SỔ 2 — route PHẢI bó mà CHƯA bó. Đây là NỢ ĐÃ ĐO, không phải chỗ được miễn.
 *
 * Mỗi dòng phải nói ra vì sao chưa làm. Bó lại là ĐỔI HÀNH VI (người đang làm được sẽ nhận
 * 403), nên phần lớn chờ quyết định nghiệp vụ về NEO: bó theo cái gì.
 */
const MEASURED_DEBT: Readonly<Record<string, string>> = {
  'modules/audit/audit.controller.ts:list':
    'Sổ audit có `companyId`, nên neo RÕ và bó được ngay. Chưa làm vì kiểm toán nội bộ cần đọc chéo công ty — phải chốt trước: vai kiểm toán đọc toàn tập đoàn là ĐÚNG hay chỉ trong phạm vi được gán.',
  'modules/audit/audit.controller.ts:facets':
    'Cùng nợ với `list`. Facets trả về TẬP GIÁ TRỊ có mặt trong dữ liệu, nên nó rò danh sách công ty / loại thực thể ngay cả khi `list` đã bó.',
  'modules/authorization/access-rules.controller.ts:list':
    'Luật truy cập là dữ liệu phân quyền. Chưa quyết: luật có thuộc công ty không, hay toàn cục như vai. Bó sai chiều còn tệ hơn chưa bó.',
  'modules/authorization/access-rules.controller.ts:explain':
    'Trả về LÝ DO một request bị luật nào chặn — tức là mô tả chính hàng rào. Cùng câu hỏi neo với `list`.',
  'modules/authorization/access-rules.controller.ts:create':
    'Ghi luật truy cập. Nếu luật là toàn cục thì phải theo khuôn `authz-matrix`: chỉ mức GROUP. Chờ quyết cùng lượt với `list`.',
  'modules/authorization/access-rules.controller.ts:moveUp':
    'Đổi THỨ TỰ luật là đổi luật nào thắng — cùng mức nguy hiểm với `create`. Chờ quyết cùng lượt.',
  'modules/authorization/access-rules.controller.ts:moveDown':
    'Cùng nợ với `moveUp`: hạ thứ tự một luật cũng là đổi luật nào thắng, chỉ khác chiều. Bó một chiều mà hở chiều kia là không bó gì.',
  'modules/authorization/access-rules.controller.ts:revoke':
    'Thu hồi luật là MỞ hàng rào — chiều nguy hiểm hơn cả `create`. Chờ quyết cùng lượt.',
  'modules/authorization/authz-admin.controller.ts:list':
    'Liệt kê ai phụ trách nghĩa trang nào — đúng tấm bản đồ người muốn leo thang cần. Bó được theo công ty của nghĩa trang; chưa làm vì `assign`/`revoke` cùng file đã bó rồi, còn đường đọc thì cần chốt có cho đọc chéo công ty không.',
  'modules/burials/burials.controller.ts:createDeceased':
    'Đã ghi nợ riêng và nêu để quyết: `Person` là dữ liệu LIÊN CÔNG TY, `Customer.companyId` cho phép NULL nên kiểm có điều kiện là fail-open. Khác `revealNationalId` (đã bó): đó là ĐỌC nên mặc định chặn được, đây là GHI hợp lệ nên chặn hết là chặn nghiệp vụ thật.',
  'modules/cemetery/cemetery.controller.ts:statusHistory':
    'Lịch sử trạng thái một phần mộ. Neo RÕ (`GravePlot` có cả `companyId` lẫn `cemeteryId`) và rẻ — `changeGravePlotStatus` đã bó theo đúng neo đó. Chưa làm vì service `getStatusHistory` không nhận caller nào; sửa là đổi cả chữ ký.',
  'modules/contracts/contracts.controller.ts:addParty':
    'Thêm bên ký vào hợp đồng. Neo có sẵn: `assertContractInScope` vừa dựng cho `verify`/`activate`/`cancel`/`get`/`list`. Đây là chỗ rẻ nhất trong sổ này.',
  'modules/customers/customers.controller.ts:createPerson':
    'Tạo nhân thân MỚI — cùng câu hỏi neo với `createDeceased`: nhân thân chưa thuộc công ty nào lúc tạo.',
  'modules/customers/customers.controller.ts:createCustomer':
    'Tạo khách hàng. `Customer.companyId` cho phép NULL theo lược đồ, nên chưa chốt được: bắt buộc phải có công ty lúc tạo, hay cho phép tạo rồi gán sau.',
  'modules/customers/customers.controller.ts:customerDetail':
    'Hồ sơ khách 360: gom quan hệ nhân thân, phần mộ đứng tên, hồ sơ an táng. Neo RÕ (`Customer.companyId`) nhưng cho phép NULL — bó là chặn luôn khách chưa gán công ty, cần quyết.',
  'modules/customers/customers.controller.ts:updateCustomer':
    'Cùng neo và cùng câu hỏi NULL với `customerDetail`. Chiều GHI nên nguy hiểm hơn.',
  'modules/customers/customers.controller.ts:deleteCustomer':
    'Xoá khách hàng. Cùng neo; đây là chiều KHÔNG ĐẢO NGƯỢC nên đáng làm trước trong nhóm `customers`.',
  'modules/customers/customers.controller.ts:createRelationship':
    'Quan hệ nhân thân nối HAI người, có thể thuộc hai công ty khác nhau — neo phải chốt là bên nào, hay cả hai.',
  'modules/customers/customers.controller.ts:endRelationship':
    'Cùng câu hỏi neo với `createRelationship`.',
  'modules/customers/customers.controller.ts:personRelationships':
    'Đọc quan hệ nhân thân của một người — dữ liệu cá nhân (NĐ 13/2023). Cùng câu hỏi neo hai-bên.',
  'modules/customers/customers.controller.ts:profile':
    'Hồ sơ nhân thân đầy đủ (địa chỉ, học vấn, tài khoản ngân hàng). Cùng câu hỏi neo với `createPerson`; CCCD trên đường này đã che sẵn, đường đọc bản đầy đủ thì đã bó.',
  'modules/customers/customers.controller.ts:addPhone':
    'Ghi bảng phụ nhân thân. Năm đường `crm.person.update` (`addPhone`/`addAddress`/`addEducation`/`addBankAccount`/`deactivateSubRecord`) cùng MỘT câu hỏi neo, nên phải bó CÙNG LƯỢT — bó lệch là năm đường nói năm điều.',
  'modules/customers/customers.controller.ts:addAddress':
    'Cùng nợ với `addPhone`, bó cùng lượt. Địa chỉ thường trú là trường in trên giấy tờ, nên sai chủ thể là sai hồ sơ.',
  'modules/customers/customers.controller.ts:addEducation':
    'Cùng nợ với `addPhone`, bó cùng lượt. Ít nhạy hơn bốn đường kia, nhưng vẫn cùng một câu hỏi neo nên không tách ra được.',
  'modules/customers/customers.controller.ts:addBankAccount':
    'Cùng nợ với `addPhone`, và là đường nhạy nhất trong năm: số tài khoản ngân hàng.',
  'modules/customers/customers.controller.ts:deactivateSubRecord':
    'Cùng nợ với `addPhone`, bó cùng lượt. Đây là chiều XOÁ MỀM của cả bốn đường trên, nên hở nó là hở toàn bộ nhóm.',
  'modules/holds/holds.controller.ts:create':
    'Giữ chỗ một phần mộ. Neo RÕ qua `GravePlot` (công ty + nghĩa trang), rẻ như `changeGravePlotStatus`. Chưa làm vì cả module `holds` chưa tiêm `ScopeService` — làm thì làm cả ba đường một lượt.',
  'modules/holds/holds.controller.ts:release':
    'Nhả phiếu giữ. Cùng neo với `create`; bỏ sót chiều này là người ngoài phạm vi nhả được chỗ người khác đang giữ.',
  'modules/holds/holds.controller.ts:list':
    'Danh sách phiếu giữ — chỗ lấy được ID phiếu để gọi `release`. Bó ghi mà hở đọc là bó nửa vời.',
  'modules/services/services.controller.ts:createCatalog':
    'Danh mục dịch vụ có `companyId` nên neo rõ; nhưng ba đường `subscribe`/`renew`/`cancel` cùng module đã nằm trong sổ nợ của `scope-check-invariants` vì chưa chốt neo. Quyết một lượt cho cả module.',
  'modules/services/services.controller.ts:listSubscriptions':
    'Cùng nợ với `createCatalog` — chờ chốt neo cho cả module `services`.',
};

describe('phạm vi tầng route — route có gate thì phải TRUYỀN người gọi xuống', () => {
  const scan = scanRouteCallers(SRC);
  const ledger = { ...NO_RECORD_SCOPE, ...MEASURED_DEBT };

  /* Cái quét trả rỗng thì mọi test dưới xanh mà chẳng kiểm gì. Ratchet lọc trạng thái đã bị
   * đúng cú đó, nên neo lại: khẳng định nó ĐỌC ĐƯỢC controller và thấy route thật. */
  it('bộ quét chạy được và thật sự thấy route có gate (tự kiểm cái quét)', () => {
    expect(scan.gated).toBeGreaterThan(50);
    expect(Object.keys(ledger).length).toBeGreaterThan(0);
  });

  it('không có route MỚI nào ngoài hai sổ đã ghi', () => {
    const unexpected = scan.withoutCaller.map((h) => h.id).filter((id) => !(id in ledger));
    expect(
      unexpected,
      'Route này gate quyền nhưng KHÔNG truyền người gọi xuống service, nên service không có gì để kiểm phạm vi. Gate quyền không gate BẢN GHI. Hãy truyền `this.caller(req)` / `callerOf(req)` và bó phạm vi, hoặc thêm vào NO_RECORD_SCOPE (nếu thật sự không có bản ghi đích) / MEASURED_DEBT (nếu phải bó mà chưa bó) kèm lý do.',
    ).toEqual([]);
  });

  /* Chiều ngược: dòng nào trong sổ mà bộ quét KHÔNG còn thấy thì route đó đã được bó rồi —
   * phải xoá khỏi sổ. Thiếu chiều này thì sổ nợ chỉ phình ra, không bao giờ ngót. */
  it('mọi dòng trong sổ đều còn tồn tại — bó xong thì phải XOÁ khỏi sổ', () => {
    const found = new Set(scan.withoutCaller.map((h) => h.id));
    const stale = Object.keys(ledger).filter((id) => !found.has(id));
    expect(
      stale,
      'Route này đã truyền người gọi xuống, nhưng vẫn còn nằm trong sổ. Xoá dòng của nó đi — sổ nợ phải ngót được, không thì nó thành danh sách ai cũng bỏ qua.',
    ).toEqual([]);
  });

  it('mọi dòng trong cả hai sổ đều có lý do viết ra, không dòng nào để trống', () => {
    for (const [id, reason] of Object.entries(ledger)) {
      expect(reason.trim().length, `${id} thiếu lý do`).toBeGreaterThan(40);
    }
  });

  /* Một route không thể vừa "đúng khi không bó" vừa "nợ phải bó". Trùng là dấu hiệu ai đó
   * thêm vào sổ dễ hơn thay vì quyết định nó thuộc sổ nào. */
  it('không route nào nằm ở CẢ HAI sổ', () => {
    const both = Object.keys(NO_RECORD_SCOPE).filter((id) => id in MEASURED_DEBT);
    expect(both).toEqual([]);
  });
});
