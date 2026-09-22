import { describe, expect, it, vi } from 'vitest';
import { CardApprovalsService } from './card-approvals.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* HỘP PHÊ DUYỆT (`listInbox`) — bó theo TỪNG CÔNG TY, không bằng hai trục RỜI.
 *
 * Đường này trước 22/09/2026 KHÔNG CÓ MỘT CA NÀO. Nó được miễn bó theo từng công ty với lý do
 * "`cardIssueApproval` lưu `companyId` của KHÁCH và `cemeteryId` của PHẦN MỘ, hai bản ghi khác
 * nhau" — lý do ấy bị chính thay đổi 19/09 (`4147c5e`) làm sai: `submitForApproval` nay lấy
 * `companyId` từ `buildCard(...).companyId`, tức công ty của PHẦN MỘ.
 *
 * Ca dưới đây neo cái mà hai trục RỜI không bắt được: người giữ MỨC KHÁC NHAU ở hai công ty.
 * `listSiteFilterFor` dựng trên mức RỘNG NHẤT người đó giữ ở bất kỳ đâu, nên COMPANY ở công ty A
 * đè lên SITE ở công ty B và trục nghĩa trang không bao giờ được đặt.
 */

const APPROVER: Caller = { userId: 'u-approver', permission: 'cemetery.card.approve' };

/* Hai công ty, và người duyệt giữ mức KHÁC NHAU ở mỗi nơi:
 *  - cty-A: COMPANY  ⇒ thấy mọi nghĩa trang của A (cem-A1)
 *  - cty-B: SITE     ⇒ chỉ thấy cem-B1, KHÔNG thấy cem-B2 (phân công đã hết hạn)
 * Đây chính là hình dạng `plotScopeFilterFor` trả về. */
const FILTER = [
  { companyId: 'cty-A', cemeteryIds: null },
  { companyId: 'cty-B', cemeteryIds: ['cem-B1'] },
];

const CEMETERIES = [
  { id: 'cem-A1', companyId: 'cty-A' },
  { id: 'cem-B1', companyId: 'cty-B' },
  // PHẢI BỊ LOẠI: công ty B nhưng người duyệt chỉ còn phụ trách B1.
  { id: 'cem-B2', companyId: 'cty-B' },
];

function build(filter: typeof FILTER | null) {
  /* Mock ĐỌC `where` thật, không trả cứng. Trả cứng thì phép lọc đúng và phép lọc sai cho cùng
   * kết quả — test xanh vì lý do SAI, đúng bẫy đã ghi trong chuẩn kỹ thuật. */
  const cemeteryFindMany = vi
    .fn()
    .mockImplementation((args: { where?: { OR?: unknown[]; companyId?: { in: string[] } } }) => {
      const where = args.where ?? {};
      if (where.OR === undefined) {
        // `{}` — không lọc gì, trả tất cả. Đây là nhánh fail-open, ca dưới phải bắt được nó.
        if (where.companyId === undefined) return Promise.resolve(CEMETERIES);
        return Promise.resolve(CEMETERIES.filter((c) => where.companyId!.in.includes(c.companyId)));
      }
      const ors = where.OR as { companyId: string; id?: { in: string[] } }[];
      return Promise.resolve(
        CEMETERIES.filter((c) =>
          ors.some(
            (o) => o.companyId === c.companyId && (o.id === undefined || o.id.in.includes(c.id)),
          ),
        ),
      );
    });

  const approvalFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    cemetery: { findMany: cemeteryFindMany },
    cardIssueApproval: { findMany: approvalFindMany },
  } as unknown as PrismaService;

  const svc = new CardApprovalsService(
    prisma,
    { record: vi.fn() } as unknown as AuditService,
    {
      plotScopeFilterFor: vi.fn().mockResolvedValue(filter),
    } as unknown as ScopeService,
  );
  return { svc, approvalFindMany, cemeteryFindMany };
}

describe('hộp phê duyệt — bó theo TỪNG công ty', () => {
  /* Ca trung tâm. Trên bản cũ (hai trục rời) `listSiteFilterFor` trả `null` vì mức toàn cục là
   * COMPANY, nên `where.cemeteryId` KHÔNG được đặt và `cem-B2` lọt. */
  it('mức khác nhau ở hai công ty: nghĩa trang KHÔNG phụ trách bị loại', async () => {
    const { svc, approvalFindMany } = build(FILTER);

    await svc.listInbox(APPROVER);

    const where = approvalFindMany.mock.calls[0]?.[0]?.where as { cemeteryId?: { in: string[] } };
    expect(where.cemeteryId?.in).toEqual(['cem-A1', 'cem-B1']);
    expect(where.cemeteryId?.in).not.toContain('cem-B2');
  });

  // Vẫn chỉ hồ sơ gửi ĐÍCH DANH người này — bó phạm vi không được làm mất vế đó.
  it('vẫn khoá theo `approverUserId` và chỉ lấy hồ sơ đang chờ', async () => {
    const { svc, approvalFindMany } = build(FILTER);

    await svc.listInbox(APPROVER);

    const where = approvalFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.approverUserId).toBe('u-approver');
    expect(where.state).toBe('SUBMITTED');
  });

  /* `select` TƯỜNG MINH. Bản cũ không có `select` nên trả cả `plotIdsSnapshot` và
   * `quoteSnapshot` — bảng kê từng dòng tiền, cho người chỉ cần thấy một dòng đang chờ. */
  it('KHÔNG trả ảnh chụp báo giá và danh sách mộ', async () => {
    const { svc, approvalFindMany } = build(FILTER);

    await svc.listInbox(APPROVER);

    const select = approvalFindMany.mock.calls[0]?.[0]?.select as Record<string, boolean>;
    expect(select).toBeDefined();
    expect(select.quoteSnapshot).toBeUndefined();
    expect(select.plotIdsSnapshot).toBeUndefined();
  });

  // GROUP (không lọc gì) vẫn phải chạy được — không phải "chặn tất cho chắc".
  it('mức GROUP thì không lọc nghĩa trang', async () => {
    const { svc, approvalFindMany, cemeteryFindMany } = build(null);

    await svc.listInbox(APPROVER);

    expect(cemeteryFindMany).not.toHaveBeenCalled();
    const where = approvalFindMany.mock.calls[0]?.[0]?.where as { cemeteryId?: unknown };
    expect(where.cemeteryId).toBeUndefined();
  });

  it('chưa đăng nhập thì trả rỗng, không hỏi gì', async () => {
    const { svc, approvalFindMany } = build(FILTER);

    await expect(
      svc.listInbox({ userId: null, permission: 'cemetery.card.approve' } as Caller),
    ).resolves.toEqual([]);
    expect(approvalFindMany).not.toHaveBeenCalled();
  });
});
