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

  it('every role grant references a catalogued code and a real scope', () => {
    for (const [roleCode, def] of Object.entries(ROLE_CATALOG)) {
      for (const grant of def.grants) {
        expect(PERMISSION_CODES, `vai ${roleCode} cấp mã lạ: ${grant.code}`).toContain(grant.code);
        expect(SCOPES, `vai ${roleCode} dùng scope lạ: ${grant.scope}`).toContain(grant.scope);
      }
    }
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

/* PR-3 chỉ THÊM mã, tuyệt đối không cấp cho ai. Ràng buộc này giữ nguyên giá trị về
 * sau: mỗi lần bảng grant đổi, con số dưới đây phải đổi theo trong CÙNG một PR có
 * người rà — chứ không trôi kèm một PR "chỉ thêm danh mục". */
describe('seeding the catalog hands nobody anything', () => {
  it('the grant table is exactly the two legacy roles', () => {
    expect(Object.keys(ROLE_CATALOG).sort()).toEqual(['ADMIN', 'STAFF']);
    const grantCount = Object.values(ROLE_CATALOG).reduce((n, r) => n + r.grants.length, 0);
    expect(grantCount).toBe(3);
  });

  it('no S3 leaf is granted to anybody yet, except via the legacy wildcard', () => {
    const bySensitivity = new Map(PERMISSION_CATALOG.map((d) => [d.code, d.sensitivity]));
    const grantedS3 = Object.values(ROLE_CATALOG)
      .flatMap((r) => r.grants.map((g) => g.code))
      .filter((code) => code !== '*.*.*')
      .filter((code) => bySensitivity.get(code) === 'S3');
    expect(grantedS3).toEqual([]);
  });
});
