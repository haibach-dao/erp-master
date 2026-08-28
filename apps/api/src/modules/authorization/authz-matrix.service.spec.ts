import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthzMatrixService } from './authz-matrix.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from './scope.service';
import type { Caller } from './caller';

/* Caller mang MÃ QUYỀN đang thi hành: phạm vi tính theo từng mã, nên truyền thiếu mã là
 * kiểm phạm vi trên một câu hỏi khác câu đang chạy. */
const ASSIGNER: Caller = { userId: 'admin', permission: 'authz.role_assignment.assign' };
const REVOKER: Caller = { userId: 'admin', permission: 'authz.role_assignment.revoke' };
const GRANTER: Caller = { userId: 'admin', permission: 'authz.role_permission.grant' };
const VIEWER: Caller = { userId: 'admin', permission: 'authz.role.view' };

function build(opts: { groupGrant?: boolean; level?: string; visible?: string[] | null } = {}) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
  const record = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-1', code: 'THU_NGAN' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1' }) },
    rolePermission: {
      findFirst: vi.fn().mockResolvedValue(opts.groupGrant === true ? { id: 'rp-1' } : null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'rp-1' }),
      delete: vi.fn().mockResolvedValue({}),
    },
    roleAssignment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create,
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'ra-1',
        userId: 'u1',
        companyId: 'co-1',
        validTo: null,
        role: { code: 'THU_NGAN' },
      }),
      update: vi.fn().mockResolvedValue({ id: 'ra-1', validTo: new Date('2026-08-27') }),
    },
    permission: {
      findUnique: vi.fn().mockResolvedValue({ id: 'perm-1', code: 'crm.customer.view' }),
    },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const visibleCompanyIdsFor = vi
    .fn()
    .mockResolvedValue(opts.visible === undefined ? null : opts.visible);
  const levelFor = vi.fn().mockResolvedValue(opts.level ?? 'GROUP');
  const svc = new AuthzMatrixService(
    prisma,
    { record } as unknown as AuditService,
    { assertCompanyFor, visibleCompanyIdsFor, levelFor } as unknown as ScopeService,
  );
  return { svc, create, record, prisma, assertCompanyFor, visibleCompanyIdsFor, levelFor };
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
    await expect(svc.assignRole({ ...BASE, companyId: null }, ASSIGNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('explains the remedy rather than just refusing', async () => {
    const { svc } = build({ groupGrant: false });
    await expect(svc.assignRole({ ...BASE, companyId: null }, ASSIGNER)).rejects.toThrow(
      /phải chỉ rõ công ty/,
    );
  });

  it('accepts the same role once a company is named', async () => {
    const { svc, create } = build({ groupGrant: false });
    await svc.assignRole({ ...BASE, companyId: 'co-1' }, ASSIGNER);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-1' }) }),
    );
  });

  it('allows no company for a GROUP-scoped role — that one reaches everything anyway', async () => {
    const { svc, create } = build({ groupGrant: true });
    await svc.assignRole({ ...BASE, companyId: null }, ASSIGNER);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });
});

describe('assignRole — the rest of the guardrails', () => {
  it('requires a reason: "why does this person hold this" is what the trail must answer', async () => {
    const { svc, create } = build({ groupGrant: true });
    await expect(
      svc.assignRole({ ...BASE, reason: '   ', companyId: null }, ASSIGNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('audits the grant with the reason attached', async () => {
    const { svc, record } = build({ groupGrant: true });
    await svc.assignRole({ ...BASE, companyId: null }, ASSIGNER);
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
    await expect(prismaless.assignRole({ ...BASE }, ASSIGNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/* LEO THANG QUYỀN — lỗ tệ nhất, vì ai vá được quyền của mình thì mọi rào khác thành trang trí.
 *
 * `Role` KHÔNG có `companyId`: vai là TOÀN CỤC. Nên có HAI câu hỏi khác nhau ở module này:
 *
 *   - Sửa NỘI DUNG vai (thêm/bớt mã quyền)  -> đổi quyền của mọi người giữ vai, ở mọi công
 *     ty. Không có công ty nào để hỏi; câu đúng là "người sửa có ở mức GROUP không".
 *   - GÁN / THU HỒI vai cho một người        -> có `companyId`, nên bó theo công ty.
 *
 * Quyết định đã chốt của chủ doanh nghiệp: ADMIN LEO THANG ĐƯỢC (gán ADMIN cho người khác,
 * sửa nội dung vai), đánh đổi lấy audit đầy đủ. Nhóm test này KHÔNG bàn lại điều đó — nó
 * neo rằng ADMIN mức GROUP vẫn đi qua, và chỉ người KHÔNG ở mức GROUP bị chặn.
 */
describe('leo thang quyền — sửa NỘI DUNG vai chỉ dành cho mức GROUP', () => {
  it('mức GROUP thêm được mã quyền cho vai — quyết định "ADMIN leo thang được" giữ nguyên', async () => {
    const { svc, record } = build({ level: 'GROUP' });

    await svc.grant('THU_NGAN', 'crm.customer.view', 'COMPANY', GRANTER);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTHZ.PERMISSION_GRANTED', actorId: 'admin' }),
    );
  });

  it('mức COMPANY thì KHÔNG sửa được nội dung vai — vai không thuộc công ty nào', async () => {
    const { svc, record } = build({ level: 'COMPANY' });

    await expect(
      svc.grant('THU_NGAN', 'crm.customer.view', 'COMPANY', GRANTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(record).not.toHaveBeenCalled();
  });

  it('câu lỗi nói RÕ vì sao, không chỉ "thiếu quyền"', async () => {
    const { svc } = build({ level: 'SITE' });

    await expect(svc.grant('THU_NGAN', 'crm.customer.view', 'COMPANY', GRANTER)).rejects.toThrow(
      /tác động tới MỌI công ty/,
    );
  });

  it('BỚT mã quyền cũng cùng luật — hai chiều, không chỉ chiều thêm', async () => {
    const { svc } = build({ level: 'COMPANY' });

    await expect(svc.revoke('THU_NGAN', 'crm.customer.view', GRANTER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /* Phép kiểm đặt TRƯỚC phép kiểm `isScope`: kiểm cú pháp trước thì người ngoài phạm vi
   * dò được mã phạm vi nào hợp lệ qua câu lỗi khác nhau. */
  it('ngoài phạm vi thì trả 403, KHÔNG rò phạm vi nào hợp lệ qua câu lỗi 400', async () => {
    const { svc } = build({ level: 'COMPANY' });

    await expect(
      svc.grant('THU_NGAN', 'crm.customer.view', 'PHAM_VI_SAI', GRANTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('không xác định được mã quyền đang thi hành thì TỪ CHỐI, không rơi về mức rộng nhất', async () => {
    const { svc, levelFor } = build();

    await expect(
      svc.grant('THU_NGAN', 'crm.customer.view', 'COMPANY', { userId: 'admin', permission: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(levelFor).not.toHaveBeenCalled();
  });
});

describe('leo thang quyền — gán và thu hồi vai bó theo công ty', () => {
  it('gán vai hỏi phạm vi theo companyId ĐƯỢC GÁN, kèm mã quyền', async () => {
    const { svc, assertCompanyFor } = build({ groupGrant: false });

    await svc.assignRole({ ...BASE, companyId: 'co-1' }, ASSIGNER);

    expect(assertCompanyFor).toHaveBeenCalledWith('admin', 'authz.role_assignment.assign', 'co-1');
  });

  it('ngoài phạm vi thì KHÔNG tạo dòng gán vai nào', async () => {
    const { svc, create, assertCompanyFor } = build({ groupGrant: false });
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.assignRole({ ...BASE, companyId: 'co-9' }, ASSIGNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  /* Thiếu chiều thu hồi là admin công ty A tước được vai của người ở công ty B — phá hoại
   * thì cũng chỉ cần một chiều là đủ. */
  it('THU HỒI vai cũng bó, theo companyId của dòng gán', async () => {
    const { svc, assertCompanyFor } = build();

    await svc.revokeRole('ra-1', REVOKER);

    expect(assertCompanyFor).toHaveBeenCalledWith('admin', 'authz.role_assignment.revoke', 'co-1');
  });

  it('ngoài phạm vi thì KHÔNG thu hồi được', async () => {
    const { svc, prisma, assertCompanyFor } = build();
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.revokeRole('ra-1', REVOKER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roleAssignment.update).not.toHaveBeenCalled();
  });
});

/* Danh sách vai một người đang giữ là BẢN ĐỒ quyền — đúng thứ người muốn leo thang đọc
 * trước. Nên nó bó theo công ty người gọi thấy được.
 */
describe('leo thang quyền — bản đồ vai bó theo công ty người gọi thấy', () => {
  it('người mức GROUP thấy tất cả, không lọc gì', async () => {
    const { svc, prisma } = build({ visible: null });

    await svc.listAssignments({ userId: 'u1' }, VIEWER);

    expect(prisma.roleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  /* Dòng `companyId = null` là vai gán TOÀN TẬP ĐOÀN. Nó không thuộc công ty nào nên không
   * lọt qua phép lọc `in` — đúng: kể cho admin công ty A rằng người kia giữ một vai vượt
   * trên họ là đã đưa nửa tấm bản đồ. */
  it('người bó ở công ty chỉ thấy dòng của công ty đó — vai toàn tập đoàn KHÔNG lọt', async () => {
    const { svc, prisma } = build({ visible: ['co-1'] });

    await svc.listAssignments({ userId: 'u1' }, VIEWER);

    expect(prisma.roleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', companyId: { in: ['co-1'] } } }),
    );
  });

  /* Chiều NGƯỢC bó theo ĐÚNG phép lọc công ty như chiều xuôi. Nếu chỉ bó một chiều thì
   * người bó ở công ty A hỏi "ai đang giữ vai ADMIN" là đọc được cả người ở công ty B —
   * cùng tấm bản đồ, chỉ vào bằng cửa khác. */
  it('tra theo VAI cũng bó theo công ty người gọi thấy', async () => {
    const { svc, prisma } = build({ visible: ['co-1'] });

    await svc.listAssignments({ roleCode: 'ADMIN' }, VIEWER);

    expect(prisma.roleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { code: 'ADMIN' }, companyId: { in: ['co-1'] } },
      }),
    );
  });

  /* Không lọc gì thì thành "liệt kê bản đồ quyền của mọi người" — một câu chưa ai hỏi,
   * trả lời bằng đúng thứ dữ liệu nhạy nhất. Chặn ở service chứ không chỉ ở giao diện. */
  it('không lọc theo gì cả thì từ chối, không liệt kê toàn bộ', async () => {
    const { svc, prisma } = build({ visible: null });

    await expect(svc.listAssignments({}, VIEWER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.roleAssignment.findMany).not.toHaveBeenCalled();
  });
});
