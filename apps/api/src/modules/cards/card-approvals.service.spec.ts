import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CardApprovalsService,
  approvalFingerprint,
  type ApprovalSubject,
} from './card-approvals.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
import type { FeeQuote } from './card-fees.service';

/* CỬA PHÊ DUYỆT IN THẺ MỘ — lát 1, anh Bách chốt 05/09/2026.
 *
 * Bộ này kiểm phần SERVICE phải tự lo. Mười hai luật cứng nằm ở CSDL và đã được kiểm bằng
 * `scripts/db-constraint-smoke.ts` chạy THẬT (20/20) — mock Prisma KHÔNG dựng lại được ràng
 * buộc, nên đừng viết test ở đây mà tưởng là đang canh chúng.
 */

const CALLER: Caller = { userId: 'u-sender', permission: 'cemetery.card.submit' };
const APPROVER: Caller = { userId: 'u-approver', permission: 'cemetery.card.approve' };

const QUOTE: FeeQuote = {
  scheduleId: 'sch-1',
  effectiveFrom: new Date('2026-09-01'),
  totalAmount: '300000',
  lines: [
    {
      gravePlotId: 'plot-B',
      plotCode: 'B-02',
      feeKind: 'REPRINT',
      feeScheduleId: 'sch-1',
      unitPrice: '50000',
      remainsCount: 2,
      feeAmount: '100000',
    },
    {
      gravePlotId: 'plot-A',
      plotCode: 'A-01',
      feeKind: 'FIRST_ISSUE',
      feeScheduleId: 'sch-1',
      unitPrice: '200000',
      remainsCount: 1,
      feeAmount: '200000',
    },
  ],
} as unknown as FeeQuote;

const SUBJECT: ApprovalSubject = {
  companyId: 'cty-A',
  cemeteryId: 'cem-1',
  customerId: 'kh-1',
  plotIds: ['plot-A', 'plot-B'],
  quote: QUOTE,
  waived: false,
  waiveReason: null,
};

const ROW = {
  id: 'ap1',
  state: 'SUBMITTED',
  companyId: 'cty-A',
  cemeteryId: 'cem-1',
  customerId: 'kh-1',
  approverUserId: 'u-approver',
  approverSignerId: 'signer-1',
  submittedBy: 'u-sender',
  contentHash: approvalFingerprint(SUBJECT),
  expiresAt: null as Date | null,
  consumedCardPrintLogId: null as string | null,
  quoteTotal: { toString: () => '300000' },
};

type BuildOpts = {
  signer?: unknown;
  existing?: unknown;
  required?: boolean;
  candidates?: unknown[];
  createError?: unknown;
  updateCount?: number;
};

function build(opts: BuildOpts = {}) {
  const create = vi.fn();
  if (opts.createError === undefined) create.mockResolvedValue({ id: 'ap1', state: 'SUBMITTED' });
  else create.mockRejectedValue(opts.createError);

  const updateMany = vi.fn().mockResolvedValue({ count: opts.updateCount ?? 1 });
  const findUnique = vi.fn().mockResolvedValue(opts.existing === undefined ? ROW : opts.existing);
  const findMany = vi.fn().mockResolvedValue(opts.candidates ?? []);

  const prisma = {
    cardIssueApproval: { create, updateMany, findUnique, findMany },
    cardSigner: {
      findUnique: vi.fn().mockResolvedValue(
        opts.signer === undefined
          ? {
              id: 'signer-1',
              userId: 'u-approver',
              cemeteryId: 'cem-1',
              status: 'Active',
              fullName: 'Nguyễn Văn Quản',
            }
          : opts.signer,
      ),
    },
    cardApprovalSetting: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.required === undefined ? null : { companyId: 'cty-A', required: opts.required },
        ),
      upsert: vi.fn().mockResolvedValue({ companyId: 'cty-A', required: true }),
    },
  } as unknown as PrismaService & {
    cardIssueApproval: {
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const listSiteFilterFor = vi.fn().mockResolvedValue(null);
  const visibleCompanyIdsFor = vi.fn().mockResolvedValue(null);
  const scope = {
    assertCompanyFor,
    assertSiteFor,
    listSiteFilterFor,
    visibleCompanyIdsFor,
  } as unknown as ScopeService;

  const record = vi.fn().mockResolvedValue(undefined);
  const svc = new CardApprovalsService(prisma, { record } as unknown as AuditService, scope);
  return { svc, prisma, record, assertCompanyFor, assertSiteFor };
}

describe('vân tay nội dung hồ sơ trình duyệt', () => {
  /* `quote()` dựng `lines` bằng `card.plots.map` và KHÔNG sắp lại. Không tự sort thì cùng một
   * bộ mộ vào theo thứ tự khác sẽ ra hai vân tay khác nhau — và hồ sơ vừa duyệt xong tự nhiên
   * báo "nội dung đã đổi", một lỗi không ai lần ra được. */
  it('KHÔNG đổi khi thứ tự phần mộ đảo — lines phải được sắp trước khi băm', () => {
    const reversed = {
      ...SUBJECT,
      quote: { ...QUOTE, lines: [...QUOTE.lines].reverse() } as FeeQuote,
    };
    expect(approvalFingerprint(reversed)).toBe(approvalFingerprint(SUBJECT));
  });

  /* CA BẮT LỖI ĐẮT NHẤT. `FeeQuote` KHÔNG chứa cờ miễn phí — nó sinh ở `resolveWaive`, một hàm
   * khác hẳn. Băm chỉ từ `quote()` thì "có miễn" và "không miễn" ra CÙNG một vân tay: người ký
   * gật một hồ sơ THU ĐỦ TIỀN, người gửi cấp ra một tờ thẻ MIỄN PHÍ, và không gì báo. */
  it('ĐỔI khi cờ miễn phí đổi — dù bản báo giá y hệt', () => {
    const waived = { ...SUBJECT, waived: true, waiveReason: 'COMPANY_FAULT' as never };
    expect(approvalFingerprint(waived)).not.toBe(approvalFingerprint(SUBJECT));
  });

  /* Bậc giá đọc trạng thái bảng phí: giữa lúc gửi duyệt và lúc cấp, nếu một lần cấp KHÁC đã thu
   * FIRST_ISSUE cho cùng cặp (khách, mộ), tính lại ra REPRINT × số cốt thay vì 200k phẳng. Bộ
   * mộ y nguyên, số tiền đổi hẳn — nên vân tay phải phủ `feeKind` của TỪNG dòng. */
  it('ĐỔI khi bậc giá của một phần mộ đổi — dù bộ mộ y nguyên', () => {
    const lines = QUOTE.lines.map((l) =>
      l.gravePlotId === 'plot-A' ? { ...l, feeKind: 'REPRINT' } : l,
    );
    const drifted = { ...SUBJECT, quote: { ...QUOTE, lines } as unknown as FeeQuote };
    expect(approvalFingerprint(drifted)).not.toBe(approvalFingerprint(SUBJECT));
  });

  it('ĐỔI khi biểu phí đổi — bảng giá có thể đổi dưới chân hồ sơ', () => {
    const other = { ...SUBJECT, quote: { ...QUOTE, scheduleId: 'sch-2' } as FeeQuote };
    expect(approvalFingerprint(other)).not.toBe(approvalFingerprint(SUBJECT));
  });
});

describe('cửa phê duyệt in thẻ mộ', () => {
  /* ---------- Cờ bật theo công ty ---------- */

  /* Đây là thứ giữ cho lát 1 ship được MỘT MÌNH. Lát 2 mới có màn hình gửi/duyệt; nếu cửa chặn
   * ngay từ lúc triển khai thì không ai cấp được thẻ và cũng không ai gửi duyệt được — đúng lỗi
   * "tính năng không ai dùng được" của lát 0. */
  it('công ty CHƯA bật cờ thì cửa trả null — đường cấp thẻ chạy y như trước', async () => {
    const { svc, prisma } = build();
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).resolves.toBeNull();
    expect(prisma.cardIssueApproval.findMany).not.toHaveBeenCalled();
  });

  it('công ty ĐÃ bật cờ mà khách chưa có hồ sơ nào thì chặn, và bảo đi gửi duyệt', async () => {
    const { svc } = build({ required: true, candidates: [] });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).rejects.toThrow(/Gửi duyệt/);
  });

  /* ---------- Cửa chặn nêu ĐÚNG MỘT nguyên nhân ---------- */

  it.each([
    [{ state: 'SUBMITTED' }, /đang chờ người ký duyệt/],
    [{ state: 'REJECTED' }, /đã bị từ chối/],
    [{ state: 'RETURNED' }, /trả lại để sửa/],
  ])('nêu đúng nguyên nhân cho trạng thái %o', async (patch, expected) => {
    const { svc } = build({
      required: true,
      candidates: [{ ...ROW, ...patch, expiresAt: null, consumedCardPrintLogId: null }],
    });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).rejects.toThrow(expected);
  });

  it('phê duyệt ĐÃ DÙNG rồi thì nói rõ mỗi phê duyệt chỉ cấp được một lần', async () => {
    const { svc } = build({
      required: true,
      candidates: [
        {
          ...ROW,
          state: 'APPROVED',
          expiresAt: new Date(Date.now() + 3600_000),
          consumedCardPrintLogId: 'log-1',
        },
      ],
    });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).rejects.toThrow(/chỉ cấp được một lần/);
  });

  it('phê duyệt QUÁ HẠN thì nói rõ là quá hạn, không nói "chưa có hồ sơ"', async () => {
    const { svc } = build({
      required: true,
      candidates: [
        {
          ...ROW,
          state: 'APPROVED',
          expiresAt: new Date(Date.now() - 3600_000),
          consumedCardPrintLogId: null,
        },
      ],
    });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).rejects.toThrow(/quá hạn/);
  });

  /* ---------- VÂN TAY: thứ thật sự giữ tiền đúng ---------- */

  it('nội dung đổi sau khi duyệt thì CHẶN, dù phê duyệt còn hạn và chưa dùng', async () => {
    const { svc } = build({
      required: true,
      candidates: [
        {
          ...ROW,
          state: 'APPROVED',
          contentHash: 'mot-van-tay-khac',
          expiresAt: new Date(Date.now() + 3600_000),
          consumedCardPrintLogId: null,
        },
      ],
    });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).rejects.toThrow(/Nội dung đã đổi/);
  });

  it('vân tay khớp và còn hạn thì cho qua, trả về đúng hồ sơ', async () => {
    const usable = {
      ...ROW,
      state: 'APPROVED',
      expiresAt: new Date(Date.now() + 3600_000),
      consumedCardPrintLogId: null,
    };
    const { svc } = build({ required: true, candidates: [usable] });
    await expect(svc.assertApproved(SUBJECT, 'u-issuer')).resolves.toMatchObject({ id: 'ap1' });
  });

  /* Ràng buộc CSDL chỉ chặn "duyệt hồ sơ của CHÍNH MÌNH". Ca này khác: duyệt xong rồi tự tay
   * cấp luôn — một người đi trọn cả hai đầu. Không chặn thì cửa phê duyệt thành hình thức. */
  it('người ĐÃ DUYỆT không tự cấp thẻ được', async () => {
    const usable = {
      ...ROW,
      state: 'APPROVED',
      expiresAt: new Date(Date.now() + 3600_000),
      consumedCardPrintLogId: null,
    };
    const { svc } = build({ required: true, candidates: [usable] });
    await expect(svc.assertApproved(SUBJECT, 'u-approver')).rejects.toThrow(
      /không tự cấp thẻ được/,
    );
  });

  /* ---------- TIÊU phê duyệt ---------- */

  it('tiêu phê duyệt bằng compare-and-set: điều kiện nằm trong WHERE, không phải câu if', async () => {
    const { svc, prisma } = build();
    const tx = prisma as unknown as Parameters<typeof svc.consume>[0];
    await svc.consume(tx, 'ap1', 'log-1');
    const arg = prisma.cardIssueApproval.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({
      id: 'ap1',
      state: 'APPROVED',
      consumedCardPrintLogId: null,
    });
  });

  it('tiêu trượt (ai đó vừa tiêu trước) thì NÉM để cuộn ngược cả lần cấp', async () => {
    const { svc, prisma } = build({ updateCount: 0 });
    const tx = prisma as unknown as Parameters<typeof svc.consume>[0];
    await expect(svc.consume(tx, 'ap1', 'log-1')).rejects.toThrow(/chỉ cấp được một lần/);
  });

  /* ---------- GỬI ---------- */

  it('không gửi hồ sơ cho CHÍNH MÌNH duyệt — chặn ngay lúc gửi, không đợi tới lúc duyệt', async () => {
    const { svc, prisma } = build({
      signer: {
        id: 'signer-1',
        userId: 'u-sender',
        cemeteryId: 'cem-1',
        status: 'Active',
        fullName: 'Tự Mình',
      },
    });
    await expect(svc.create(SUBJECT, 'signer-1', CALLER)).rejects.toThrow(/cho chính mình/);
    expect(prisma.cardIssueApproval.create).not.toHaveBeenCalled();
  });

  it('người ký đã NGỪNG DÙNG thì từ chối ngay — không tạo hồ sơ chết', async () => {
    const { svc, prisma } = build({
      signer: {
        id: 'signer-1',
        userId: 'u-approver',
        cemeteryId: 'cem-1',
        status: 'Retired',
        fullName: 'Đã Nghỉ',
      },
    });
    await expect(svc.create(SUBJECT, 'signer-1', CALLER)).rejects.toThrow(/đã ngừng dùng/);
    expect(prisma.cardIssueApproval.create).not.toHaveBeenCalled();
  });

  it('người ký của nghĩa trang KHÁC thì từ chối', async () => {
    const { svc } = build({
      signer: {
        id: 'signer-1',
        userId: 'u-approver',
        cemeteryId: 'cem-KHAC',
        status: 'Active',
        fullName: 'Người Khác',
      },
    });
    await expect(svc.create(SUBJECT, 'signer-1', CALLER)).rejects.toThrow(
      /không phụ trách nghĩa trang/,
    );
  });

  it('không tìm thấy người ký thì 404', async () => {
    const { svc } = build({ signer: null });
    await expect(svc.create(SUBJECT, 'khong-co', CALLER)).rejects.toThrow(NotFoundException);
  });

  /* Bài học lát 0: `assertSiteFor` MỘT MÌNH không chặn được người mức COMPANY — `checkSite`
   * thoát ngay khi mức là GROUP *hoặc COMPANY*. Phải gọi CẶP. */
  it('bó CẢ HAI TRỤC lúc gửi — công ty và nghĩa trang', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build();
    await svc.create(SUBJECT, 'signer-1', CALLER);
    expect(assertCompanyFor).toHaveBeenCalledWith(CALLER.userId, CALLER.permission, 'cty-A');
    expect(assertSiteFor).toHaveBeenCalledWith(CALLER.userId, CALLER.permission, 'cem-1');
  });

  it('khách đã có hồ sơ đang chờ thì trả câu tiếng Việt, không để lộ P2002', async () => {
    const { Prisma } = await import('@prisma/client');
    const { svc } = build({
      createError: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6',
        meta: { target: 'card_issue_approvals_one_open' },
      }),
    });
    await expect(svc.create(SUBJECT, 'signer-1', CALLER)).rejects.toThrow(
      /đã có một hồ sơ đang chờ duyệt/,
    );
  });

  /* ---------- QUYẾT ---------- */

  it('chỉ ĐÚNG người được gửi mới quyết được — hồ sơ chụp NGƯỜI', async () => {
    const { svc } = build({ existing: { ...ROW, approverUserId: 'u-ai-do-khac' } });
    await expect(svc.decide('ap1', 'APPROVED', undefined, APPROVER)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(svc.decide('ap1', 'APPROVED', undefined, APPROVER)).rejects.toThrow(
      /gửi cho người ký khác/,
    );
  });

  it('không duyệt hồ sơ do chính mình gửi', async () => {
    const { svc } = build({ existing: { ...ROW, submittedBy: 'u-approver' } });
    await expect(svc.decide('ap1', 'APPROVED', undefined, APPROVER)).rejects.toThrow(
      /chính mình gửi/,
    );
  });

  it('hồ sơ đã quyết rồi thì không quyết lại', async () => {
    const { svc } = build({ existing: { ...ROW, state: 'APPROVED' } });
    await expect(svc.decide('ap1', 'REJECTED', 'khong dong y', APPROVER)).rejects.toThrow(
      /không còn chờ duyệt/,
    );
  });

  it.each([['REJECTED'], ['RETURNED']] as const)('%s mà không nêu lý do thì chặn', async (next) => {
    const { svc } = build();
    await expect(svc.decide('ap1', next, 'ok', APPROVER)).rejects.toThrow(ConflictException);
    await expect(svc.decide('ap1', next, 'ok', APPROVER)).rejects.toThrow(/phải nêu lý do/);
  });

  it('DUYỆT thì đặt hạn dùng; TỪ CHỐI thì không', async () => {
    const { svc, prisma } = build();
    await svc.decide('ap1', 'APPROVED', undefined, APPROVER);
    const ok = prisma.cardIssueApproval.updateMany.mock.calls[0]?.[0] as {
      data: { expiresAt: Date | null };
    };
    expect(ok.data.expiresAt).toBeInstanceOf(Date);

    const b = build();
    await b.svc.decide('ap1', 'REJECTED', 'thieu giay to', APPROVER);
    const no = b.prisma.cardIssueApproval.updateMany.mock.calls[0]?.[0] as {
      data: { expiresAt: Date | null };
    };
    expect(no.data.expiresAt).toBeNull();
  });

  it('quyết bằng compare-and-set — hai người ký bấm cùng lúc thì một người thua', async () => {
    const { svc, prisma } = build();
    await svc.decide('ap1', 'APPROVED', undefined, APPROVER);
    const arg = prisma.cardIssueApproval.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({ id: 'ap1', state: 'SUBMITTED' });

    const loser = build({ updateCount: 0 });
    await expect(loser.svc.decide('ap1', 'APPROVED', undefined, APPROVER)).rejects.toThrow(
      /cùng lúc/,
    );
  });

  /* ---------- HUỶ ---------- */

  it('chỉ NGƯỜI GỬI mới huỷ được hồ sơ của mình', async () => {
    const { svc } = build();
    await expect(svc.cancel('ap1', APPROVER)).rejects.toThrow(/Chỉ người gửi/);
  });

  it('người gửi huỷ được hồ sơ đang chờ — lối thoát khi người ký đã ngừng dùng', async () => {
    const { svc } = build();
    await expect(svc.cancel('ap1', CALLER)).resolves.toMatchObject({ state: 'CANCELLED' });
  });
});
