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
import { scanRoutes } from './route-scan';
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
    expect(gated).toBeGreaterThanOrEqual(4);
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
    ['crm.relationship.create', 'crm.relationship.verify'],
    ['cemetery.hold.hold', 'cemetery.hold.release'],
    ['authz.change.submit', 'authz.change.approve'],
    ['cemetery.price.set_price', 'service.subscription.create'],
    ['service.price.set_price', 'service.subscription.create'],
    ['service.transaction.view', 'service.transaction.adjust'],
    ['file.object.set_sensitivity', 'file.object.download_sensitive'],
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

  it('không ai được cấp quyền cấp/thu quyền ở bước này — cửa duy nhất là migration + review Git', () => {
    const selfService = [
      'authz.role.create',
      'authz.role.update',
      'authz.role_permission.grant',
      'authz.role_permission.revoke',
      'authz.role_assignment.assign',
      'authz.role_assignment.revoke',
      'authz.scope.assign',
    ];
    const holders = ROLE_ENTRIES.filter(([code]) => code !== 'ADMIN')
      .filter(([code]) => codesOf(code).some((c) => selfService.includes(c)))
      .map(([code]) => code);
    expect(holders).toEqual([]);
  });

  it('vai khẩn cấp BREAK_GLASS chưa được tạo (chưa có valid_to thì nó là siêu quyền vĩnh viễn)', () => {
    expect(Object.keys(ROLE_CATALOG)).not.toContain('BREAK_GLASS');
  });

  it('ghế máy giữ đúng hai mã', () => {
    expect(codesOf('SYSTEM_WORKER').sort()).toEqual([
      'cemetery.plot.set_status',
      'service.subscription.cancel',
    ]);
  });
});

describe('hình dạng ma trận vai', () => {
  it('chỉ ADMIN mang wildcard toàn quyền', () => {
    const wildcardHolders = ROLE_ENTRIES.filter(([, def]) =>
      def.grants.some((g) => g.code === '*.*.*'),
    ).map(([code]) => code);
    expect(wildcardHolders).toEqual(['ADMIN']);
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
