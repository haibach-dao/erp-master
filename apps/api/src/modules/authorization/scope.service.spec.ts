import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import type { PermissionsService } from './permissions.service';
import { PolicyEvaluator } from './policy-evaluator';

function build(scope: {
  level: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
  companyIds: string[];
  siteIds?: string[];
}) {
  const permissions = {
    getEffectiveAccess: vi.fn().mockResolvedValue({
      roles: [],
      permissions: [],
      scope: { siteIds: [], unrestricted: scope.level === 'GROUP', ...scope },
    }),
  } as unknown as PermissionsService;
  return new ScopeService(permissions, new PolicyEvaluator());
}

const BOUND_TO_A = { level: 'COMPANY' as const, companyIds: ['co-a'] };
const UNRESTRICTED = { level: 'GROUP' as const, companyIds: [] };

describe('ScopeService.assertCompany — the caller no longer picks their own scope', () => {
  it('allows a company the caller is bound to', async () => {
    await expect(build(BOUND_TO_A).assertCompany('u1', 'co-a')).resolves.toBeUndefined();
  });

  it('REFUSES another company — the cross-company read that used to work', async () => {
    await expect(build(BOUND_TO_A).assertCompany('u1', 'co-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses with 403 rather than returning an empty list', async () => {
    // An empty result would claim "there is nothing here", which is a different and
    // misleading statement, and it hides the attempt from anyone reading the logs.
    await expect(build(BOUND_TO_A).assertCompany('u1', 'co-b')).rejects.toThrow(/Ngoài phạm vi/);
  });

  it('refuses an unbounded query from a company-bound caller', async () => {
    await expect(build(BOUND_TO_A).assertCompany('u1', null)).rejects.toThrow(/chỉ rõ công ty/);
    await expect(build(BOUND_TO_A).assertCompany('u1', '')).rejects.toThrow(/chỉ rõ công ty/);
  });

  it('lets a GROUP caller through for any company, including none', async () => {
    const svc = build(UNRESTRICTED);
    await expect(svc.assertCompany('u1', 'co-a')).resolves.toBeUndefined();
    await expect(svc.assertCompany('u1', 'co-z')).resolves.toBeUndefined();
    await expect(svc.assertCompany('u1', null)).resolves.toBeUndefined();
  });

  it('refuses an unauthenticated caller before consulting any scope', async () => {
    await expect(build(BOUND_TO_A).assertCompany(null, 'co-a')).rejects.toThrow(/Chưa xác thực/);
  });

  it('a caller bound to nothing reaches nothing', async () => {
    const svc = build({ level: 'NONE', companyIds: [] });
    await expect(svc.assertCompany('u1', 'co-a')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ScopeService.visibleCompanyIds — what the picker may offer', () => {
  it('returns the bound companies', async () => {
    await expect(build(BOUND_TO_A).visibleCompanyIds('u1')).resolves.toEqual(['co-a']);
  });

  it('returns null for a GROUP caller, meaning no restriction', async () => {
    await expect(build(UNRESTRICTED).visibleCompanyIds('u1')).resolves.toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(build(BOUND_TO_A).visibleCompanyIds(null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('ScopeService.assertSite — the hub axis', () => {
  const COVERS_ONE = { level: 'SITE' as const, companyIds: ['co-a'], siteIds: ['ct-1'] };

  it('allows a cemetery the caller covers', async () => {
    await expect(build(COVERS_ONE).assertSite('u1', 'ct-1')).resolves.toBeUndefined();
  });

  it('refuses a cemetery the caller does not cover, even inside their own company', async () => {
    await expect(build(COVERS_ONE).assertSite('u1', 'ct-2')).rejects.toThrow(/không phụ trách/);
  });

  it('covering several cemeteries at once is normal, not an exception', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: ['ct-1', 'ct-9'] });
    await expect(svc.assertSite('u1', 'ct-1')).resolves.toBeUndefined();
    await expect(svc.assertSite('u1', 'ct-9')).resolves.toBeUndefined();
  });

  it('assigned to no cemetery reaches none of them — not all of them', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: [] });
    await expect(svc.assertSite('u1', 'ct-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a GROUP caller is unrestricted here too', async () => {
    await expect(build(UNRESTRICTED).assertSite('u1', 'ct-1')).resolves.toBeUndefined();
  });
});

/* The trap this level exists to close: a role that is MEANT to stop at specific
 * cemeteries, whose hub rows have not been created yet. Without a level, an empty site
 * list is indistinguishable from "this role is not site-bound", and the fail-safe and
 * fail-open readings swap places.
 */
describe('ScopeService.listSiteFilter — narrowing list queries', () => {
  it('narrows a site-bound caller to their own cemeteries', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: ['ct-1'] });
    await expect(svc.listSiteFilter('u1')).resolves.toEqual(['ct-1']);
  });

  it('narrows a site-bound caller with no cemeteries to NOTHING, not to everything', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: [] });
    await expect(svc.listSiteFilter('u1')).resolves.toEqual([]);
  });

  it('does not narrow a company-bound caller — they cover their whole company', async () => {
    await expect(build(BOUND_TO_A).listSiteFilter('u1')).resolves.toBeNull();
  });

  it('does not narrow a GROUP caller', async () => {
    await expect(build(UNRESTRICTED).listSiteFilter('u1')).resolves.toBeNull();
  });
});
