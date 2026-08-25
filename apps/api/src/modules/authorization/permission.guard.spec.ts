import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import type { PermissionsService, PermissionMeta } from './permissions.service';
import type { PermissionGrant } from './policy.types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSION_KEY } from './require-permission.decorator';

function context(userId: string | undefined): ExecutionContext {
  const req = userId === undefined ? {} : { user: { userId } };
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function build(opts: {
  required?: string;
  isPublic?: boolean;
  meta?: PermissionMeta | null;
  grants?: PermissionGrant[];
  ruling?: 'ALLOW' | 'DENY' | 'NO_MATCH';
}) {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return opts.isPublic;
      }
      if (key === PERMISSION_KEY) {
        return opts.required;
      }
      return undefined;
    },
  } as unknown as Reflector;

  const permissions = {
    getPermissionMeta: vi.fn().mockResolvedValue(opts.meta ?? null),
    getGrants: vi.fn().mockResolvedValue(opts.grants ?? []),
    evaluateRules: vi.fn().mockResolvedValue(opts.ruling ?? 'NO_MATCH'),
  } as unknown as PermissionsService;

  return new PermissionGuard(reflector, permissions);
}

const S1: PermissionMeta = {
  code: 'cemetery.plot.view',
  sensitivity: 'S1',
  wildcardExempt: false,
};
const S3: PermissionMeta = {
  code: 'crm.person.view_sensitive',
  sensitivity: 'S3',
  wildcardExempt: true,
};

describe('PermissionGuard — deny by default', () => {
  it('refuses a route that declares no permission and is not public', async () => {
    const guard = build({});
    await expect(guard.canActivate(context('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an explicitly public route through with no token at all', async () => {
    const guard = build({ isPublic: true });
    await expect(guard.canActivate(context(undefined))).resolves.toBe(true);
  });

  it('refuses an unauthenticated caller on a gated route', async () => {
    const guard = build({ required: 'cemetery.plot.view', meta: S1 });
    await expect(guard.canActivate(context(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a code that is not in the catalog, instead of quietly matching nothing', async () => {
    const guard = build({
      required: 'cemetery.plot.vieww',
      meta: null,
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/không có trong danh mục/);
  });
});

describe('PermissionGuard — wildcard reach', () => {
  it('a wildcard grant still covers an ordinary leaf', async () => {
    const guard = build({
      required: 'cemetery.plot.view',
      meta: S1,
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    await expect(guard.canActivate(context('u1'))).resolves.toBe(true);
  });

  it('a wildcard grant does NOT reach a wildcard-exempt leaf', async () => {
    const guard = build({
      required: 'crm.person.view_sensitive',
      meta: S3,
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/Thiếu quyền/);
  });

  it('a narrower wildcard is refused on an exempt leaf too', async () => {
    const guard = build({
      required: 'crm.person.view_sensitive',
      meta: S3,
      grants: [{ permission: 'crm.person.*', scope: 'GROUP' }],
    });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/Thiếu quyền/);
  });

  it('naming the exempt leaf works', async () => {
    const guard = build({
      required: 'crm.person.view_sensitive',
      meta: S3,
      grants: [{ permission: 'crm.person.view_sensitive', scope: 'COMPANY' }],
    });
    await expect(guard.canActivate(context('u1'))).resolves.toBe(true);
  });

  it('refuses a caller whose grants simply do not cover the code', async () => {
    const guard = build({
      required: 'cemetery.plot.view',
      meta: S1,
      grants: [{ permission: 'service.catalog.view', scope: 'COMPANY' }],
    });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/Thiếu quyền/);
  });
});

/* Firewall semantics: the ordered rule chain gets first say. A DENY refuses outright; an
 * ALLOW admits without consulting the role matrix; only NO_MATCH falls through to the
 * matrix — and a matrix that grants nothing produces the refusal that IS the implicit
 * "deny all" at the bottom of the chain.
 */
describe('PermissionGuard — ordered rule chain decides first', () => {
  it('a DENY ruling refuses even a caller granted the leaf by name', async () => {
    const guard = build({
      required: 'crm.person.view_sensitive',
      meta: S3,
      grants: [{ permission: 'crm.person.view_sensitive', scope: 'GROUP' }],
      ruling: 'DENY',
    });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/Bị luật truy cập chặn/);
  });

  it('an ALLOW ruling admits a caller the role matrix never granted anything', async () => {
    const guard = build({
      required: 'crm.person.view_sensitive',
      meta: S3,
      grants: [],
      ruling: 'ALLOW',
    });
    await expect(guard.canActivate(context('u1'))).resolves.toBe(true);
  });

  it('NO_MATCH falls through to the role matrix', async () => {
    const granted = build({
      required: 'cemetery.plot.view',
      meta: S1,
      grants: [{ permission: 'cemetery.plot.view', scope: 'COMPANY' }],
      ruling: 'NO_MATCH',
    });
    await expect(granted.canActivate(context('u1'))).resolves.toBe(true);

    const bare = build({
      required: 'cemetery.plot.view',
      meta: S1,
      grants: [],
      ruling: 'NO_MATCH',
    });
    await expect(bare.canActivate(context('u1'))).rejects.toThrow(/Thiếu quyền/);
  });

  it('an unknown code is still refused before the chain can allow it', async () => {
    const guard = build({ required: 'crm.person.nope', meta: null, ruling: 'ALLOW' });
    await expect(guard.canActivate(context('u1'))).rejects.toThrow(/không có trong danh mục/);
  });
});
