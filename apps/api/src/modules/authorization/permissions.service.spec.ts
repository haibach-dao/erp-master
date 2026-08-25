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

function build(assignments: unknown[], sites: { cemeteryId: string }[] = []) {
  const findMany = vi.fn().mockResolvedValue(assignments);
  const svc = new PermissionsService({
    roleAssignment: { findMany },
    scopeAssignment: { findMany: vi.fn().mockResolvedValue(sites) },
    permission: { findUnique: vi.fn() },
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
