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
});
