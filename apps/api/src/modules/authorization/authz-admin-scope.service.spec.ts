import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuthzAdminService } from './authz-admin.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from './scope.service';
import type { Caller } from './caller';

/* GÁN / THU HỒI NGHĨA TRANG CHO NGƯỜI KHÁC — `AuthzAdminService` TỚI 17/09/2026 KHÔNG CÓ SPEC.
 *
 * Đây là đường NỚI TẦM VỚI của người khác, nên nó phải bị bó chặt hơn đường thường chứ không
 * lỏng hơn. Chú thích ngay trên `assign` đã cảnh báo đúng điều này — "widening someone else's
 * reach past their own" — nhưng hàm chỉ hỏi TRỤC CÔNG TY.
 *
 * Bảng `Cemetery` có CẢ `companyId` LẪN chính `id` là trục nghĩa trang, nên hỏi được cả hai.
 * Một lượt soi độc lập bắt được chỗ này sau khi `assertSiteFor` đã gộp vào `assertPlotFor`.
 */

const CEM_A1 = 'nt-a1';
const CO_A = 'co-a';
const TARGET = 'nguoi-duoc-gan';

const ASSIGNER: Caller = { userId: 'u1', permission: 'authz.scope_assignment.assign' };
const REVOKER: Caller = { userId: 'u1', permission: 'authz.scope_assignment.revoke' };

function build(over: { cemetery?: { companyId: string } | null } = {}) {
  const { cemetery = { companyId: CO_A } } = over;

  const prisma = {
    cemetery: { findUnique: vi.fn().mockResolvedValue(cemetery) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: TARGET }) },
    scopeAssignment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'sa-1', userId: TARGET, cemeteryId: CEM_A1 }),
      findUnique: vi.fn().mockResolvedValue({ id: 'sa-1' }),
      upsert: vi.fn().mockResolvedValue({ id: 'sa-1' }),
      create: vi.fn().mockResolvedValue({ id: 'sa-1' }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1', validTo: new Date('2026-09-17') }),
    },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const svc = new AuthzAdminService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
  );
  return { svc, prisma, assertCompanyFor, assertPlotFor };
}

describe('gán nghĩa trang cho người khác — bó CẢ HAI TRỤC, vì đây là đường nới tầm với', () => {
  it('hỏi phạm vi trên cả công ty lẫn chính nghĩa trang đang gán', async () => {
    const { svc, assertPlotFor } = build();
    await svc.assign(TARGET, CEM_A1, ASSIGNER).catch(() => undefined);
    expect(assertPlotFor).toHaveBeenCalledWith(ASSIGNER.userId, ASSIGNER.permission, CO_A, CEM_A1);
  });

  /* THU HỒI cũng là đổi tầm với của người khác. Bỏ sót chiều này thì người mức SITE gỡ được
   * nghĩa trang họ không phụ trách khỏi tay đồng nghiệp — phá hoại chỉ cần một chiều. */
  it('THU HỒI cũng hỏi cả hai trục', async () => {
    const { svc, assertPlotFor } = build();
    await svc.revoke(TARGET, CEM_A1, REVOKER).catch(() => undefined);
    expect(assertPlotFor).toHaveBeenCalledWith(REVOKER.userId, REVOKER.permission, CO_A, CEM_A1);
  });

  it('nghĩa trang không tồn tại thì 404, không hỏi phạm vi trên một chỗ trống', async () => {
    const { svc, assertPlotFor } = build({ cemetery: null });
    await expect(svc.assign(TARGET, CEM_A1, ASSIGNER)).rejects.toBeInstanceOf(NotFoundException);
    expect(assertPlotFor).not.toHaveBeenCalled();
  });
});
