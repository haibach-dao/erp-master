/* CI invariants for the permission layer. These do not change behaviour — they make
 * the three failure modes that break silently break loudly instead:
 *   (a) a code with the wrong number of segments matches nothing, including `*.*.*`;
 *   (b) a decorator referencing a code nobody seeded is a permanent 403;
 *   (c) a route with no decorator is an open door, because PermissionGuard currently
 *       allows routes that declare no permission.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_CODES,
  ROLE_CATALOG,
} from '../src/modules/authorization/permission-catalog';
import { SCOPES } from '../src/modules/authorization/scope.enum';
import { scanController, scanRoutes } from './route-scan';
import { UNGATED_ROUTE_ALLOWLIST } from './authz-allowlist';

const SRC_ROOT = join(__dirname, '..', 'src');
const routes = scanRoutes(SRC_ROOT);

describe('(a) permission codes are exactly three segments', () => {
  it.each(PERMISSION_CODES)('%s', (code) => {
    expect(code.split('.')).toHaveLength(3);
  });

  it('has no duplicate codes', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });
});

describe('(b) every @RequirePermission code exists in the catalog', () => {
  const gated = routes.filter((r) => r.permission !== null);

  it('finds the gated routes at all (guards the scanner itself)', () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  it.each(gated.map((r) => [r.id, r.permission] as const))('%s → %s', (_id, permission) => {
    expect(PERMISSION_CODES).toContain(permission);
  });

  it('a gated route is on a controller that actually registers PermissionGuard', () => {
    const unenforced = gated.filter((r) => !r.hasPermissionGuard).map((r) => r.id);
    expect(unenforced).toEqual([]);
  });
});

describe('(c) every ungated route is on the reviewed allowlist', () => {
  it('no route ships ungated without a written reason', () => {
    const undeclared = routes
      .filter((r) => r.permission === null && !r.isPublic)
      .map((r) => r.id)
      .filter((id) => !(id in UNGATED_ROUTE_ALLOWLIST));
    expect(
      undeclared,
      'Thiếu @RequirePermission — thêm gate, hoặc ghi lý do vào allowlist',
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const live = new Set(routes.filter((r) => r.permission === null).map((r) => r.id));
    const stale = Object.keys(UNGATED_ROUTE_ALLOWLIST).filter((id) => !live.has(id));
    expect(stale, 'Route đã được gate hoặc đã xoá — bỏ khỏi allowlist').toEqual([]);
  });

  it('reports the current coverage so shrinking it is visible in review', () => {
    const gated = routes.filter((r) => r.permission !== null).length;
    // Bậc thang: mỗi PR gate thêm route thì con số này chỉ được TĂNG.
    expect(gated).toBeGreaterThanOrEqual(61);
  });

  it('every public route says so explicitly, and only the ones that must be', () => {
    const publicRoutes = routes
      .filter((r) => r.isPublic)
      .map((r) => r.id)
      .sort();
    expect(publicRoutes).toEqual(['GET /health', 'POST /auth/login', 'POST /auth/refresh']);
  });

  it('a public route never also carries a permission — that would be a contradiction', () => {
    const contradictory = routes
      .filter((r) => r.isPublic && r.permission !== null)
      .map((r) => r.id);
    expect(contradictory).toEqual([]);
  });

  it('no deprecated code is still referenced by a route', () => {
    const deprecated = new Set(
      PERMISSION_CATALOG.filter((d) => d.deprecated !== undefined).map((d) => d.code),
    );
    const stragglers = routes
      .filter((r) => r.permission !== null && deprecated.has(r.permission))
      .map((r) => `${r.id} -> ${r.permission ?? ''}`);
    expect(stragglers, 'route còn dùng mã cũ — đổi sang mã thay thế').toEqual([]);
  });
});

describe('catalog metadata', () => {
  it('every code carries a description (a code nobody can explain is a code nobody reviewed)', () => {
    for (const def of PERMISSION_CATALOG) {
      expect(def.description.length, `mã ${def.code} thiếu mô tả`).toBeGreaterThan(0);
    }
  });

  it('every action comes from the closed set — a new verb needs a reviewed migration', () => {
    const strays = PERMISSION_CATALOG.filter((def) => def.code !== '*.*.*')
      .filter((def) => !(ACTIONS as readonly string[]).includes(def.code.split('.')[2] ?? ''))
      .map((def) => def.code);
    expect(strays, 'action lạ — thêm vào ACTIONS kèm lý do, hoặc đổi mã').toEqual([]);
  });

  it('sensitivity is one of S0..S3 and stays a column, never a fourth segment', () => {
    for (const def of PERMISSION_CATALOG) {
      expect(['S0', 'S1', 'S2', 'S3'], `mã ${def.code}`).toContain(def.sensitivity);
    }
  });

  it('every S3 leaf is wildcard-exempt, so a `*` grant cannot silently reach it', () => {
    const leaky = PERMISSION_CATALOG.filter(
      (def) => def.sensitivity === 'S3' && !def.wildcardExempt && def.code !== '*.*.*',
    ).map((def) => def.code);
    expect(leaky, 'leaf S3 phải wildcardExempt (doc 16 §D.4)').toEqual([]);
  });

  it('deprecated codes point at a live replacement', () => {
    const dangling = PERMISSION_CATALOG.filter((def) => def.deprecated !== undefined)
      .filter((def) =>
        (def.deprecated ?? '')
          .split('+')
          .map((c) => c.trim())
          .some((c) => !PERMISSION_CODES.includes(c)),
      )
      .map((def) => `${def.code} -> ${def.deprecated ?? ''}`);
    expect(dangling, 'mã thay thế chưa có trong danh mục').toEqual([]);
  });
});

/* Ma trận vai × quyền: các bất biến TÁCH NHIỆM VỤ ở doc 16 §E.3. Ở đây kiểm mức VAI
 * (không vai nào cầm cả hai vế). Bất biến mức BẢN GHI — verifiedBy != createdBy,
 * activatedBy != verifiedBy — phải kiểm ở tầng service, test này không thay thế được.
 */
const ROLE_ENTRIES = Object.entries(ROLE_CATALOG);
const codesOf = (roleCode: string): string[] =>
  (ROLE_CATALOG[roleCode]?.grants ?? []).map((g) => g.code);

function rolesHoldingBoth(a: string, b: string): string[] {
  return ROLE_ENTRIES.filter(([code]) => code !== 'ADMIN')
    .filter(([code]) => codesOf(code).includes(a) && codesOf(code).includes(b))
    .map(([code]) => code);
}

describe('tách nhiệm vụ ở mức vai (doc 16 §E.3)', () => {
  it.each([
    ['contract.record.create', 'contract.record.verify'],
    ['contract.record.verify', 'contract.record.activate'],
    ['burial.record.create', 'burial.record.verify'],
    ['burial.record.verify', 'burial.record.complete'],
    /* Soạn và HUỶ hồ sơ an táng phải tách ghế: người vừa soạn được vừa huỷ được có thể
     * dựng rồi rút một hồ sơ mà không ai ngoài nhật ký thấy — và huỷ NHẢ CỐT, tức là nó
     * đổi được ai nằm ở đâu. */
    ['burial.record.create', 'burial.record.cancel'],
    ['crm.relationship.create', 'crm.relationship.verify'],
    ['cemetery.hold.hold', 'cemetery.hold.release'],
    ['authz.change.submit', 'authz.change.approve'],
    ['cemetery.price.set_price', 'service.subscription.create'],
    ['service.price.set_price', 'service.subscription.create'],
    ['service.transaction.view', 'service.transaction.adjust'],
    ['file.object.set_sensitivity', 'file.object.download_sensitive'],
    /* Biểu phí thẻ mộ — ba cặp, vì tiền rò ra ở cả ba chỗ nối:
     * ĐẶT GIÁ + THU: người ở quầy tự hạ đơn giá xuống rồi thu, không ai đối chứng.
     * THA + THU: người thu tiền tự tha tiền — không cần gian dối phức tạp, chỉ cần bấm.
     * THA + ĐẶT GIÁ: gộp lại là một người tự định đoạt trọn vẹn khoản thu của khách. */
    ['cemetery.card_fee.set_price', 'cemetery.card.print'],
    ['cemetery.card_fee.waive', 'cemetery.card.print'],
    ['cemetery.card_fee.waive', 'cemetery.card_fee.set_price'],
    /* Sửa số cốt của loại mộ là sửa CƠ SỐ NHÂN của tiền in lại. Ai vừa sửa được cơ số vừa
     * thu được thì đặt giá lại toàn bộ mà không cần chạm tới biểu phí. */
    ['cemetery.grave_type.update', 'cemetery.card.print'],
    /* Thẻ nhãn — ai vừa MỞ được thẻ mới vừa GẮN được thì tự định đoạt trọn vẹn cái nhãn dán
     * lên một phần mộ hoặc lên một con người. Cặp thứ hai nặng hơn: một thẻ khách tự tạo,
     * tự gắn, là một câu nói về người mà không ai ngoài người tạo nó rà qua. */
    ['config.plot_tag.update', 'cemetery.plot_tag.assign'],
    ['config.customer_tag.update', 'crm.customer_tag.assign'],
  ])('không vai nào cầm cả %s lẫn %s', (a, b) => {
    expect(rolesHoldingBoth(a, b)).toEqual([]);
  });

  it('hai vai kiểm soát không có quyền GHI nghiệp vụ', () => {
    const businessWrite = new Set(
      PERMISSION_CATALOG.map((d) => d.code)
        .filter((code) =>
          ['cemetery', 'contract', 'burial', 'service'].includes(code.split('.')[0] ?? ''),
        )
        .filter((code) => !(code.split('.')[2] ?? '').startsWith('view'))
        .filter((code) => !['search', 'export'].includes(code.split('.')[2] ?? '')),
    );
    for (const roleCode of ['KTNB_KIEM_TOAN', 'DPO_DLCN']) {
      const writes = codesOf(roleCode).filter((c) => businessWrite.has(c));
      expect(writes, `${roleCode} phải CHỈ ĐỌC nghiệp vụ`).toEqual([]);
    }
  });

  it('quản trị hạ tầng không chạm dữ liệu nhạy cảm nghiệp vụ hay doanh thu', () => {
    const forbidden = [
      'crm.person.view_sensitive',
      'crm.person.view_protected',
      'contract.amount.view_sensitive',
      'service.revenue.view',
      'file.object.download_sensitive',
      'authz.change.approve',
    ];
    const held = codesOf('QT_HE_THONG').filter((c) => forbidden.includes(c));
    expect(held, 'QT_HE_THONG giữ leaf bị cấm').toEqual([]);
  });

  it('chỉ ADMIN được cầm quyền cấp/thu quyền — và đó là một quyết định, không phải sơ suất', () => {
    const selfService = [
      'authz.role.create',
      'authz.role.update',
      'authz.role_permission.grant',
      'authz.role_permission.revoke',
      'authz.role_assignment.assign',
      'authz.role_assignment.revoke',
      'authz.scope.assign',
    ];
    /* Chủ doanh nghiệp chốt: ADMIN cấp/thu quyền được, và uỷ quyền được cho người khác.
     * Test này KHÔNG chặn điều đó — nó chặn việc một vai khác lặng lẽ có thêm mã cấp
     * quyền mà không ai để ý. Muốn thêm vai vào danh sách thì phải sửa test này, tức
     * phải có người đọc. */
    const holders = ROLE_ENTRIES.filter(([code]) =>
      codesOf(code).some((c) => selfService.includes(c)),
    ).map(([code]) => code);
    expect(holders).toEqual(['ADMIN']);
  });

  it('vai khẩn cấp BREAK_GLASS chưa được tạo (chưa có valid_to thì nó là siêu quyền vĩnh viễn)', () => {
    expect(Object.keys(ROLE_CATALOG)).not.toContain('BREAK_GLASS');
  });

  /* Ngoại lệ CÓ CHỦ Ý, không phải sơ suất: ghế cho hiệu lực cũng soạn được hợp đồng, nên
   * giám đốc tự soạn tự cho hiệu lực được (G0-Q10). Chuỗi soạn -> THẨM ĐỊNH thì vẫn phải
   * hai người — bất biến đó kiểm ở tầng service theo BẢN GHI, không kiểm được ở đây. */
  it('chỉ GD_CONG_TY được cầm cả create lẫn activate hợp đồng', () => {
    expect(rolesHoldingBoth('contract.record.create', 'contract.record.activate')).toEqual([
      'GD_CONG_TY',
    ]);
  });

  it('vai THẨM ĐỊNH tuyệt đối không được soạn hợp đồng', () => {
    expect(codesOf('QL_NGHIA_TRANG')).toContain('contract.record.verify');
    expect(codesOf('QL_NGHIA_TRANG')).not.toContain('contract.record.create');
  });

  it('ghế máy giữ đúng hai mã', () => {
    expect(codesOf('SYSTEM_WORKER').sort()).toEqual([
      'cemetery.plot.set_status',
      'service.subscription.cancel',
    ]);
  });
});

describe('hình dạng ma trận vai', () => {
  /* G0-Q13: `*.*.*` bị bỏ HẲN. Không vai nào mang wildcard, và nó cũng không còn trong
   * danh mục — nếu còn, nó là thứ cấp lại được từ màn hình quản trị. */
  it('không vai nào mang grant wildcard', () => {
    const wildcardHolders = ROLE_ENTRIES.filter(([, def]) =>
      def.grants.some((g) => g.code.includes('*')),
    ).map(([code]) => code);
    expect(wildcardHolders).toEqual([]);
  });

  it('danh mục không còn mã wildcard nào', () => {
    expect(PERMISSION_CODES.filter((c) => c.includes('*'))).toEqual([]);
  });

  it('ADMIN cầm TOÀN BỘ danh mục một cách tường minh — đếm được, không phải một dòng `*`', () => {
    expect(codesOf('ADMIN').sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it('mọi grant trỏ mã có thật và scope có thật', () => {
    for (const [roleCode, def] of ROLE_ENTRIES) {
      for (const g of def.grants) {
        expect(PERMISSION_CODES, `${roleCode} cấp mã lạ: ${g.code}`).toContain(g.code);
        expect(SCOPES, `${roleCode} dùng scope lạ: ${g.scope}`).toContain(g.scope);
      }
    }
  });

  it('không vai nào cấp trùng một mã hai lần', () => {
    for (const [roleCode, def] of ROLE_ENTRIES) {
      const codes = def.grants.map((g) => g.code);
      expect(new Set(codes).size, `${roleCode} có mã trùng`).toBe(codes.length);
    }
  });

  it('không dùng scope chưa thực thi được (DEPARTMENT / ASSIGNED / CUSTOM)', () => {
    const unenforceable = ['DEPARTMENT', 'ASSIGNED', 'CUSTOM'];
    const offenders = ROLE_ENTRIES.filter(([, def]) =>
      def.grants.some((g) => unenforceable.includes(g.scope)),
    ).map(([code]) => code);
    expect(offenders, 'khai scope mà không thực thi thì tệ hơn không khai').toEqual([]);
  });

  it('mọi vai có mô tả — vai không giải thích được là vai không rà được', () => {
    for (const [roleCode, def] of ROLE_ENTRIES) {
      expect(def.description.length, `vai ${roleCode} thiếu mô tả`).toBeGreaterThan(0);
    }
  });
});

/* Cái quét là thứ mọi bất biến ở trên dựa vào. Nếu nó bỏ sót một route thì mọi test kia
 * xanh một cách vô nghĩa. Đã suýt xảy ra thật: decorator xuống dòng (@MaskUnless(...))
 * cắt đứt chuỗi decorator và route mất luôn mã quyền nằm ngay phía trên.
 */
describe('cái quét route tự nó phải đúng', () => {
  const SOURCE = [
    '@UseGuards(JwtAuthGuard, PermissionGuard)',
    "@Controller('demo')",
    'export class DemoController {',
    "  @Get('wrapped')",
    "  @RequirePermission('contract.record.view')",
    '  /* Comment khối giữa các decorator — đã từng làm đứt chuỗi thật. */',
    '  @MaskUnless(',
    "    { field: 'totalAmount', permission: 'contract.amount.view_sensitive' },",
    '  )',
    '  wrapped() {',
    '    return null;',
    '  }',
    '',
    '  @Get()',
    '  @Public()',
    '  open() {',
    '    return null;',
    '  }',
    '}',
  ].join(String.fromCharCode(10));

  const scanned = scanController('demo.controller.ts', SOURCE);

  it('giữ được mã quyền dù bên dưới có decorator xuống dòng', () => {
    expect(scanned.find((r) => r.id === 'GET /demo/wrapped')?.permission).toBe(
      'contract.record.view',
    );
  });

  it('vẫn nhận ra route công khai đứng sau một decorator xuống dòng', () => {
    expect(scanned.find((r) => r.id === 'GET /demo')?.isPublic).toBe(true);
  });

  it('không bỏ sót route nào trong đoạn mã trên', () => {
    expect(scanned.map((r) => r.id)).toEqual(['GET /demo/wrapped', 'GET /demo']);
  });
});
