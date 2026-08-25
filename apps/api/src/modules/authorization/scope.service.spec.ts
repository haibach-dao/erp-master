import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import type { PermissionsService } from './permissions.service';

function build(scope: { unrestricted: boolean; companyIds: string[] }) {
  const permissions = {
    getEffectiveAccess: vi.fn().mockResolvedValue({ roles: [], permissions: [], scope }),
  } as unknown as PermissionsService;
  return new ScopeService(permissions);
}

const BOUND_TO_A = { unrestricted: false, companyIds: ['co-a'] };
const UNRESTRICTED = { unrestricted: true, companyIds: [] };

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
    const svc = build({ unrestricted: false, companyIds: [] });
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
