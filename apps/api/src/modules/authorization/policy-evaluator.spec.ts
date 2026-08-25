import { describe, expect, it } from 'vitest';
import { PolicyEvaluator, permissionMatches } from './policy-evaluator';
import type { AccessRequest, PermissionGrant } from './policy.types';

describe('permissionMatches', () => {
  it('matches exact codes', () => {
    expect(permissionMatches('cemetery.grave.view', 'cemetery.grave.view')).toBe(true);
  });
  it('matches wildcard segments', () => {
    expect(permissionMatches('cemetery.*.view', 'cemetery.grave.view')).toBe(true);
    expect(permissionMatches('cemetery.grave.*', 'cemetery.grave.hold')).toBe(true);
  });
  it('rejects mismatches and different arities', () => {
    expect(permissionMatches('cemetery.grave.view', 'cemetery.grave.hold')).toBe(false);
    expect(permissionMatches('cemetery.grave', 'cemetery.grave.view')).toBe(false);
  });

  it('a wildcard-exempt leaf refuses every wildcard, however narrow', () => {
    const exempt = { wildcardExempt: true };
    expect(permissionMatches('*.*.*', 'crm.person.view_sensitive', exempt)).toBe(false);
    expect(permissionMatches('crm.*.*', 'crm.person.view_sensitive', exempt)).toBe(false);
    expect(permissionMatches('crm.person.*', 'crm.person.view_sensitive', exempt)).toBe(false);
  });

  it('a wildcard-exempt leaf is still reachable by its exact name', () => {
    expect(
      permissionMatches('crm.person.view_sensitive', 'crm.person.view_sensitive', {
        wildcardExempt: true,
      }),
    ).toBe(true);
  });
});

describe('PolicyEvaluator.can', () => {
  const evaluator = new PolicyEvaluator();
  const subject = {
    userId: 'u1',
    departmentId: 'd1',
    companyIds: ['c1'],
    siteIds: ['s1'],
    assignedIds: ['r1'],
  };
  const req = (permission: string, target?: AccessRequest['target']): AccessRequest => ({
    permission,
    subject,
    target,
  });

  it('denies when no grant matches the permission', () => {
    const grants: PermissionGrant[] = [{ permission: 'purchase.request.create', scope: 'COMPANY' }];
    expect(evaluator.can(req('cemetery.grave.view', { companyId: 'c1' }), grants)).toBe(false);
  });

  it('COMPANY grant allows a company the subject holds, denies another', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'COMPANY' }];
    expect(evaluator.can(req('cemetery.grave.view', { companyId: 'c1' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view', { companyId: 'c2' }), grants)).toBe(false);
  });

  it('SITE grant is bounded to the cemeteries the subject covers', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'SITE' }];
    expect(evaluator.can(req('cemetery.grave.view', { siteId: 's1' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view', { siteId: 's2' }), grants)).toBe(false);
  });

  /* GROUP now means NO RECORD RESTRICTION. The previous implementation compared
   * target.groupId to subject.groupId, and since no table in the schema has a group_id
   * column that comparison could only ever be false — wiring the evaluator up would have
   * locked out every top-level role on every endpoint. */
  it('GROUP grant reaches every record, including one with no attributes at all', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'GROUP' }];
    expect(evaluator.can(req('cemetery.grave.view', { companyId: 'c9' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view', {}), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view'), grants)).toBe(true);
  });

  it('a subject bound to nothing reaches nothing', () => {
    const empty = { userId: 'u2', companyIds: [], siteIds: [] };
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'COMPANY' }];
    expect(
      evaluator.can(
        { permission: 'cemetery.grave.view', subject: empty, target: { companyId: 'c1' } },
        grants,
      ),
    ).toBe(false);
  });

  it('DEPARTMENT grant is bounded to the subject department', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'DEPARTMENT' }];
    expect(evaluator.can(req('cemetery.grave.view', { departmentId: 'd1' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view', { departmentId: 'd2' }), grants)).toBe(false);
  });

  it('SELF grant only covers records the subject owns', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.customer.view', scope: 'SELF' }];
    expect(evaluator.can(req('cemetery.customer.view', { ownerId: 'u1' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.customer.view', { ownerId: 'u2' }), grants)).toBe(false);
  });

  it('ASSIGNED grant covers assigned target ids', () => {
    const grants: PermissionGrant[] = [
      { permission: 'cemetery.contract.verify', scope: 'ASSIGNED' },
    ];
    expect(evaluator.can(req('cemetery.contract.verify', { id: 'r1' }), grants)).toBe(true);
    expect(evaluator.can(req('cemetery.contract.verify', { id: 'r2' }), grants)).toBe(false);
  });

  it('missing target attributes never grant access', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'COMPANY' }];
    expect(evaluator.can(req('cemetery.grave.view'), grants)).toBe(false);
    expect(evaluator.can(req('cemetery.grave.view', {}), grants)).toBe(false);
  });

  it('CUSTOM defers to the resolver', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.grave.view', scope: 'CUSTOM' }];
    expect(evaluator.can(req('cemetery.grave.view', { id: 'x' }), grants, () => true)).toBe(true);
    expect(evaluator.can(req('cemetery.grave.view', { id: 'x' }), grants, () => false)).toBe(false);
    expect(evaluator.can(req('cemetery.grave.view', { id: 'x' }), grants)).toBe(false);
  });

  it('wildcard grant + COMPANY scope works end to end', () => {
    const grants: PermissionGrant[] = [{ permission: 'cemetery.*.view', scope: 'COMPANY' }];
    expect(evaluator.can(req('cemetery.grave.view', { companyId: 'c1' }), grants)).toBe(true);
  });
});
