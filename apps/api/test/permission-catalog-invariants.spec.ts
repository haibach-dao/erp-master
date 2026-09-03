import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { PERMISSION_CATALOG } from '../src/modules/authorization/permission-catalog';
import {
  codesCarriedByMigration,
  codesRetiredByMigration,
  scanWebPermissionCodes,
} from './permission-catalog-scan';

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');
const WEB = join(__dirname, '..', '..', 'web');

/* RATCHET DANH MỤC MÃ QUYỀN. Đọc chú thích dài ở `permission-catalog-scan.ts` trước.
 *
 * Tóm lại: cửa XOÁ mã quyền tự chạy khi triển khai (`prisma migrate deploy`), cửa THÊM thì
 * không (`prisma db seed`, không lệnh nào gọi). Nên một mã mới có thể đi hết đường triển khai
 * mà CSDL không hề biết — và khi CSDL không biết, `permission.guard.ts` fail-closed chặn TẤT
 * CẢ, kể cả ADMIN, còn thanh menu thì lặng lẽ giấu mục đó đi. Không một phép kiểm nào đỏ, vì
 * mọi phép kiểm đều chạy ở tầng dưới tầng bị hỏng.
 *
 * Bộ này ÉP cái điều kiện làm cho chuyện đó không xảy ra được: mã mới phải có một migration
 * mang theo. Nó KHÔNG so danh mục với CSDL — xem lý do ở file quét (so với một CSDL vừa seed
 * là so danh sách với chính nó, không bao giờ đỏ).
 *
 * HAI SỔ, không một. "Đã có trước khi dựng ratchet" và "không phải mã quyền" là hai thứ khác
 * bản chất; gộp lại thì cả hai đều mất nghĩa.
 */

/* SỔ 1 — 148 mã đã có trên `main` TRƯỚC KHI dựng ratchet này.
 *
 * Đây là NỢ, không phải sự cho phép. Chúng ra đời trước luật nên không bị đòi migration; mọi mã
 * sinh sau đều bị đòi. Danh sách sinh bằng máy từ `git show main:...permission-catalog.ts`, không
 * gõ tay.
 *
 * Sổ này CHỈ ĐƯỢC NGÓT — xem ca kiểm ngay dưới. Thêm một dòng vào đây là cách êm nhất để né luật,
 * nên việc thêm phải là một hành động NHÌN THẤY ĐƯỢC lúc review chứ không phải một dòng lọt vào
 * giữa 148 dòng khác.
 */
const PRE_RATCHET_CODES: readonly string[] = [
  'audit.event.export',
  'audit.event.view',
  'audit.event.view_sensitive',
  'audit.integrity.view',
  'audit.user_activity.view',
  'authz.change.approve',
  'authz.change.submit',
  'authz.matrix.export',
  'authz.permission.create',
  'authz.permission.update',
  'authz.permission.view',
  'authz.role.create',
  'authz.role.update',
  'authz.role.view',
  'authz.role_assignment.assign',
  'authz.role_assignment.revoke',
  'authz.role_permission.grant',
  'authz.role_permission.revoke',
  'authz.rule.update',
  'authz.rule.view',
  'authz.scope.assign',
  'burial.deceased.create',
  'burial.deceased.view',
  'burial.record.cancel',
  'burial.record.complete',
  'burial.record.create',
  'burial.record.export',
  'burial.record.search',
  'burial.record.verify',
  'burial.record.view',
  'cemetery.card.print',
  'cemetery.card.view',
  'cemetery.card_fee.set_price',
  'cemetery.card_fee.view',
  'cemetery.card_fee.waive',
  'cemetery.contract.activate',
  'cemetery.customer.view',
  'cemetery.document.view_sensitive',
  'cemetery.grave.hold',
  'cemetery.grave_type.create',
  'cemetery.grave_type.update',
  'cemetery.grave_type.view',
  'cemetery.hold.hold',
  'cemetery.hold.release',
  'cemetery.hold.view',
  'cemetery.plot.create',
  'cemetery.plot.export',
  'cemetery.plot.override',
  'cemetery.plot.search',
  'cemetery.plot.set_status',
  'cemetery.plot.update',
  'cemetery.plot.view',
  'cemetery.plot.view_history',
  'cemetery.plot_tag.assign',
  'cemetery.plot_tag.view',
  'cemetery.price.set_price',
  'cemetery.price.view',
  'cemetery.reference.view',
  'cemetery.site.create',
  'cemetery.site.view',
  'cemetery.usage_right.assign',
  'cemetery.usage_right.release',
  'cemetery.usage_right.transfer',
  'cemetery.usage_right.view',
  'config.customer_tag.update',
  'config.flag.update',
  'config.flag.view',
  'config.plot_tag.update',
  'config.reference.update',
  'config.reference.view',
  'contract.amount.view_sensitive',
  'contract.party.assign',
  'contract.party.view',
  'contract.record.activate',
  'contract.record.ai_ingest',
  'contract.record.approve',
  'contract.record.cancel',
  'contract.record.create',
  'contract.record.export',
  'contract.record.search',
  'contract.record.update',
  'contract.record.verify',
  'contract.record.view',
  'crm.consent.record',
  'crm.consent.view',
  'crm.consent.withdraw',
  'crm.customer.create',
  'crm.customer.delete',
  'crm.customer.export',
  'crm.customer.search',
  'crm.customer.update',
  'crm.customer.view',
  'crm.customer_tag.assign',
  'crm.customer_tag.view',
  'crm.person.ai_ingest',
  'crm.person.create',
  'crm.person.export',
  'crm.person.set_protected',
  'crm.person.update',
  'crm.person.view',
  'crm.person.view_contact',
  'crm.person.view_financial',
  'crm.person.view_protected',
  'crm.person.view_sensitive',
  'crm.relationship.cancel',
  'crm.relationship.create',
  'crm.relationship.verify',
  'crm.relationship.view',
  'file.object.confirm',
  'file.object.delete',
  'file.object.download',
  'file.object.download_sensitive',
  'file.object.set_sensitivity',
  'file.object.upload',
  'file.object.view',
  'iam.secret.rotate',
  'iam.secret.view',
  'iam.session.revoke',
  'iam.session.view',
  'iam.user.create',
  'iam.user.update',
  'iam.user.view',
  'notification.channel.configure',
  'notification.message.view',
  'notification.template.update',
  'notification.template.view',
  'org.company.create',
  'org.company.update',
  'org.company.view',
  'service.catalog.create',
  'service.catalog.view',
  'service.period.close',
  'service.price.set_price',
  'service.price.view',
  'service.revenue.ai_ingest',
  'service.revenue.export',
  'service.revenue.view',
  'service.subscription.cancel',
  'service.subscription.create',
  'service.subscription.export',
  'service.subscription.override',
  'service.subscription.renew',
  'service.subscription.search',
  'service.subscription.view',
  'service.subscription.view_price',
  'service.transaction.adjust',
  'service.transaction.backdate',
  'service.transaction.view',
];

/* Con số này CHỈ ĐƯỢC GIẢM. Nó không phải một hằng cho tiện đọc — nó là cái chốt: sổ nợ trên có
 * thể ngót đi khi một mã cũ được migration mang đi, nhưng phình ra thì phải sửa cả con số này, và
 * sửa nó là một dòng diff không ai đọc lướt qua được. */
const PRE_RATCHET_MAX = 148;

/* SỔ 2 — chuỗi ba đoạn ở `apps/web` KHÔNG phải mã quyền, kèm lý do.
 *
 * RỖNG, và rỗng là KẾT QUẢ ĐO ĐƯỢC chứ không phải chưa ai nhìn: quét cả `apps/web` hôm nay ra
 * đúng 31 mã phân biệt, 31/31 đều có trong danh mục, không một dương tính giả nào. Ngày nào phải
 * mở sổ này thì phải kèm lý do thật; "cho đỡ đỏ" không phải một lý do. */
const KHONG_PHAI_MA_QUYEN: Readonly<Record<string, string>> = {};

const CATALOG_CODES = PERMISSION_CATALOG.map((def) => def.code);

describe('ratchet danh mục mã quyền', () => {
  it('sổ mã có trước ratchet CHỈ ĐƯỢC NGÓT, không được phình', () => {
    expect(PRE_RATCHET_CODES.length).toBeLessThanOrEqual(PRE_RATCHET_MAX);
    /* Trùng lặp trong sổ là cách một mã mới núp bóng: nó nâng `length` lên mà không thêm mã nào
     * mới được miễn, rồi lần sau ai đó "dọn trùng" và tạo chỗ trống. */
    expect(new Set(PRE_RATCHET_CODES).size).toBe(PRE_RATCHET_CODES.length);
  });

  it('mã quyền MỚI phải được một migration mang đi, nếu không CSDL sẽ không bao giờ có nó', () => {
    const baseline = new Set(PRE_RATCHET_CODES);
    const carried = codesCarriedByMigration(MIGRATIONS);

    const khongCoMigration = CATALOG_CODES.filter(
      (code) => !baseline.has(code) && !carried.has(code),
    );

    expect(
      khongCoMigration,
      khongCoMigration.length === 0
        ? ''
        : `Mã quyền mới mà KHÔNG migration nào mang đi: ${khongCoMigration.join(', ')}.\n` +
            'Thêm `p(...)` vào PERMISSION_CATALOG chỉ đổi MÃ NGUỒN. `prisma db seed` là thứ đưa\n' +
            'nó vào `authz.permissions`, mà không lệnh triển khai nào gọi seed — nên mã này sẽ\n' +
            'thiếu ở mọi CSDL không được seed tay, và `permission.guard.ts` sẽ chặn TẤT CẢ (kể cả\n' +
            'ADMIN) với câu "Mã quyền không có trong danh mục".\n' +
            'Cách sửa: viết một migration chèn dòng danh mục (và grant nếu có), theo nếp\n' +
            '`prisma/migrations/20260903140000_card_signer_permissions/migration.sql`.',
    ).toEqual([]);
  });

  /* TỰ KIỂM CHÍNH BỘ QUÉT. Thiếu ca này thì một ngày regex ngừng khớp, `retired` thành rỗng, ca
   * "không hồi sinh" ngay dưới xanh vĩnh viễn — và không ai biết cái lưới đã mục. Đúng lớp lỗi mà
   * cả bộ ratchet sinh ra để chặn. */
  it('bộ quét vẫn nhận ra được mã đã bị migration gỡ', () => {
    const retired = codesRetiredByMigration(MIGRATIONS);
    /* Danh sách này PHÌNH RA là bình thường — mỗi lần gỡ một mã là thêm một dòng ở đây, và việc
     * phải sửa nó là CHỦ ĐÍCH: một mã bị gỡ khỏi danh mục quyền không được lọt qua im lặng.
     * `config.tag.update` vào đây ngày 03/09/2026 — xem
     * `20260903160000_drop_shared_tag_permission`. Nó là mảnh sót của lần danh mục thẻ nhãn còn
     * dùng chung một mã, trước khi tách làm `plot_tag` + `customer_tag`; chưa từng có trong mã
     * nguồn, chỉ có trong CSDL vì một lần seed chạy giữa chừng. Chính người gác lúc boot tìm ra
     * nó, ở lần chạy thật đầu tiên.
     * Danh sách này NGÓT đi mới là chuyện phải dừng lại hỏi: nghĩa là một migration gỡ đã biến
     * mất khỏi lịch sử, hoặc bộ quét đã ngừng khớp. */
    expect([...new Set(retired.map((r) => r.code))].sort()).toEqual([
      '*.*.*',
      'config.tag.update',
      'crm.person.search',
    ]);
  });

  it('mã đã bị migration GỠ thì không được hồi sinh trong danh mục', () => {
    const retired = codesRetiredByMigration(MIGRATIONS);
    const inCatalog = new Set(CATALOG_CODES);
    const hoiSinh = retired.filter((r) => inCatalog.has(r.code));

    expect(
      hoiSinh.map((r) => `${r.code} (đã gỡ ở ${r.id})`),
      'Seed chỉ `upsert`, KHÔNG bao giờ DELETE — nên gõ lại một mã đã bị migration gỡ là lặng lẽ\n' +
        'hoàn tác một quyết định đã được cân nhắc, và lần seed sau sẽ dựng lại đúng dòng vừa xoá.',
    ).toEqual([]);
  });

  it('mọi mã quyền dùng ở apps/web đều có trong danh mục', () => {
    const inCatalog = new Set(CATALOG_CODES);
    const la = (code: string) => !inCatalog.has(code) && KHONG_PHAI_MA_QUYEN[code] === undefined;

    const treoLo = scanWebPermissionCodes(WEB)
      .filter((ref) => la(ref.code))
      .map((ref) => `${ref.id}: ${ref.code}`);

    expect(
      [...new Set(treoLo)].sort(),
      'Mã quyền ở web gõ sai chính tả không đỏ ở đâu cả: `can(user, ...)` trả false và thanh menu\n' +
        'chỉ lặng lẽ giấu mục đó đi. `apps/web` không có bộ test nào, nên phép kiểm phải đứng ở đây.',
    ).toEqual([]);
  });
});
