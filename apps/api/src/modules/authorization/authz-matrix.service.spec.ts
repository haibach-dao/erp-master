import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthzMatrixService } from './authz-matrix.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

function build(opts: { groupGrant?: boolean } = {}) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
  const record = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-1', code: 'THU_NGAN' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1' }) },
    rolePermission: {
      findFirst: vi.fn().mockResolvedValue(opts.groupGrant === true ? { id: 'rp-1' } : null),
    },
    roleAssignment: { findFirst: vi.fn().mockResolvedValue(null), create },
  } as unknown as PrismaService;

  const svc = new AuthzMatrixService(prisma, { record } as unknown as AuditService);
  return { svc, create, record };
}

const BASE = { userId: 'u1', roleCode: 'THU_NGAN', reason: 'nhân sự mới' };

/* A role assignment with no company, on a role that is bounded by company, grants
 * nothing at all: the person shows up holding a role while every request is refused.
 * It used to be creatable, and the only defence was a script somebody had to remember
 * to run before deploying. These tests hold the state unrepresentable instead.
 */
describe('assignRole — refuses an assignment that would grant nothing', () => {
  it('refuses a company-bounded role with no company', async () => {
    const { svc, create } = build({ groupGrant: false });
    await expect(svc.assignRole({ ...BASE, companyId: null }, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('explains the remedy rather than just refusing', async () => {
    const { svc } = build({ groupGrant: false });
    await expect(svc.assignRole({ ...BASE, companyId: null }, 'admin')).rejects.toThrow(
      /phải chỉ rõ công ty/,
    );
  });

  it('accepts the same role once a company is named', async () => {
    const { svc, create } = build({ groupGrant: false });
    await svc.assignRole({ ...BASE, companyId: 'co-1' }, 'admin');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-1' }) }),
    );
  });

  it('allows no company for a GROUP-scoped role — that one reaches everything anyway', async () => {
    const { svc, create } = build({ groupGrant: true });
    await svc.assignRole({ ...BASE, companyId: null }, 'admin');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });
});

describe('assignRole — the rest of the guardrails', () => {
  it('requires a reason: "why does this person hold this" is what the trail must answer', async () => {
    const { svc, create } = build({ groupGrant: true });
    await expect(
      svc.assignRole({ ...BASE, reason: '   ', companyId: null }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('audits the grant with the reason attached', async () => {
    const { svc, record } = build({ groupGrant: true });
    await svc.assignRole({ ...BASE, companyId: null }, 'admin');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTHZ.ROLE_ASSIGNED',
        actorId: 'admin',
        reason: 'nhân sự mới',
      }),
    );
  });

  it('refuses an unknown role before touching anything', async () => {
    const { svc } = build();
    const prismaless = new AuthzMatrixService(
      { role: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );
    expect(svc).toBeDefined();
    await expect(prismaless.assignRole({ ...BASE }, 'admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
