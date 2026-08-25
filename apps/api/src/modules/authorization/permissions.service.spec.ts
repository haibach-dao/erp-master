import { describe, expect, it, vi } from 'vitest';
import { PermissionsService } from './permissions.service';
import type { PrismaService } from '../../prisma/prisma.service';

function assignment(roleCode: string, codes: string[], scope: string, companyId: string | null) {
  return {
    scope: null,
    companyId,
    role: {
      code: roleCode,
      rolePermissions: codes.map((code) => ({ scope, permission: { code } })),
    },
  };
}

function build(
  assignments: unknown[],
  sites: { cemeteryId: string }[] = [],
  denies: { permissionCode: string }[] = [],
  meta: { code: string; wildcardExempt: boolean; sensitivity: string } | null = null,
) {
  const findMany = vi.fn().mockResolvedValue(assignments);
  const svc = new PermissionsService({
    roleAssignment: { findMany },
    scopeAssignment: { findMany: vi.fn().mockResolvedValue(sites) },
    permissionDeny: { findMany: vi.fn().mockResolvedValue(denies) },
    permission: { findUnique: vi.fn().mockResolvedValue(meta) },
  } as unknown as PrismaService);
  return { svc, findMany };
}

describe('getEffectiveAccess — what the caller may do, and where', () => {
  it('collects roles and codes across every assignment, de-duplicated and sorted', async () => {
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view', 'crm.customer.view'], 'COMPANY', 'co-1'),
      assignment('CSKH_TIEP_DON', ['crm.customer.view', 'cemetery.plot.view'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.roles).toEqual(['CSKH_TIEP_DON', 'THU_NGAN']);
    expect(access.permissions).toEqual([
      'cemetery.plot.view',
      'contract.record.view',
      'crm.customer.view',
    ]);
  });

  it('reports the companies the caller is bound to', async () => {
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-2'),
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope).toEqual({
      level: 'COMPANY',
      unrestricted: false,
      companyIds: ['co-1', 'co-2'],
      siteIds: [],
    });
  });

  it('a GROUP grant means no record restriction at all', async () => {
    const { svc } = build([assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null)]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.unrestricted).toBe(true);
  });

  it('a caller with no assignment is bound to nothing — not to everything', async () => {
    const { svc } = build([]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access).toEqual({
      roles: [],
      permissions: [],
      denied: [],
      scope: { level: 'NONE', unrestricted: false, companyIds: [], siteIds: [] },
    });
  });

  it('one GROUP role alongside a company-bound role still lifts the restriction', async () => {
    // Known consequence of the union rule in getGrants: the widest scope wins today.
    // Narrowing to the tightest scope is a separate change, and until it lands nothing
    // may treat `scope` as a security boundary.
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-1'),
      assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.unrestricted).toBe(true);
    expect(access.scope.companyIds).toEqual(['co-1']);
  });
});

describe('scope level — the difference between "no limit" and "no cemeteries yet"', () => {
  it('a site-bound role reports SITE, so an empty hub means reaching nothing', async () => {
    const { svc } = build([assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1')]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.level).toBe('SITE');
    expect(access.scope.siteIds).toEqual([]);
  });

  it('reports the cemeteries assigned in the hub', async () => {
    const { svc } = build(
      [assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1')],
      [{ cemeteryId: 'ct-2' }, { cemeteryId: 'ct-1' }],
    );
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.siteIds).toEqual(['ct-1', 'ct-2']);
  });

  it('the widest level wins today — a known inversion of the intended rule', async () => {
    const { svc } = build([
      assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1'),
      assignment('GD_CONG_TY', ['contract.record.approve'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.level).toBe('COMPANY');
  });
});

/* Union means "add up what each role gives", NOT "take the widest thing you hold
 * anywhere and apply it everywhere". Computed globally it leaks: the group-wide audit
 * role below never grants set_status, so it must not widen it.
 */
describe('scopeLevelFor — union computed PER CODE', () => {
  const twoRoles = [
    assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null),
    assignment('THU_NGAN', ['cemetery.plot.set_status'], 'COMPANY', 'co-1'),
  ];

  it('gives GROUP on the code the group-wide role actually grants', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'audit.event.view')).resolves.toBe('GROUP');
  });

  it('gives only COMPANY on a code the group-wide role never granted', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'cemetery.plot.set_status')).resolves.toBe('COMPANY');
  });

  it('gives NONE for a code nobody granted', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'service.revenue.view')).resolves.toBe('NONE');
  });
});

describe('deny — the only brake left once roles combine by union', () => {
  it('a denied code is not advertised as held', async () => {
    const { svc } = build(
      [assignment('DPO_DLCN', ['crm.person.view_sensitive'], 'GROUP', null)],
      [],
      [{ permissionCode: 'crm.person.view_sensitive' }],
    );
    const access = await svc.getEffectiveAccess('u1');
    expect(access.permissions).not.toContain('crm.person.view_sensitive');
    expect(access.denied).toEqual(['crm.person.view_sensitive']);
  });

  it('isDenied beats an exact grant', async () => {
    const { svc } = build([], [], [{ permissionCode: 'crm.person.view_protected' }]);
    await expect(svc.isDenied('u1', 'crm.person.view_protected')).resolves.toBe(true);
  });

  it('a deny may be written as a pattern covering a whole resource', async () => {
    const { svc } = build([], [], [{ permissionCode: 'crm.person.*' }]);
    await expect(svc.isDenied('u1', 'crm.person.view_sensitive')).resolves.toBe(true);
    await expect(svc.isDenied('u1', 'crm.customer.view')).resolves.toBe(false);
  });

  it('a denied code has no scope either — it does not fall back to a narrower reach', async () => {
    const { svc } = build(
      [assignment('DPO_DLCN', ['crm.person.view_sensitive'], 'GROUP', null)],
      [],
      [{ permissionCode: 'crm.person.view_sensitive' }],
    );
    await expect(svc.scopeLevelFor('u1', 'crm.person.view_sensitive')).resolves.toBe('NONE');
  });
});

describe('validity window — an expired grant stops existing on its own', () => {
  it('only asks the database for assignments that are in force', async () => {
    const { svc, findMany } = build([]);
    await svc.getGrants('u1');
    const where = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.validFrom).toBeDefined();
    expect(where.OR).toEqual([{ validTo: null }, { validTo: { gt: expect.any(Date) } }]);
  });
});
