import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CardFeesService } from './card-fees.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { PermissionsService } from '../authorization/permissions.service';

/* Biểu phí cấp thẻ mộ — anh Bách chốt 02/09/2026:
 *   cấp giấy LẦN ĐẦU 200.000đ PHẲNG (không nhân)
 *   mỗi lần IN LẠI  50.000đ × SỐ CỐT CỦA PHẦN MỘ
 *   "lần đầu" neo theo CẶP (khách hàng, phần mộ)
 *
 * Ca chuẩn ở `cả đời một phần mộ đôi` là ca anh Bách TỰ TÍNH ra 400.000đ. Nó ở đây để nếu
 * sau này ai sửa công thức, con số lệch khỏi phép tính của người quyết sẽ đỏ ngay — chứ
 * không lặng lẽ thu sai vài năm.
 */

const CO = 'co-1';
const KH = 'kh-1';

const SCHEDULE = {
  id: 'sch-1',
  companyId: CO,
  cardType: 'GRAVE',
  firstIssueFee: new Prisma.Decimal(200000),
  reprintFeePerRemains: new Prisma.Decimal(50000),
  effectiveFrom: new Date('2026-01-01'),
  decisionRef: null,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

function build(opts: { schedule?: unknown; firstIssued?: string[] } = {}) {
  const prisma = {
    graveCardFeeSchedule: {
      findFirst: vi.fn().mockResolvedValue(opts.schedule === undefined ? SCHEDULE : opts.schedule),
    },
    graveCardFeeCharge: {
      findMany: vi
        .fn()
        .mockResolvedValue((opts.firstIssued ?? []).map((gravePlotId) => ({ gravePlotId }))),
    },
  } as unknown as PrismaService;
  const permissions = { scopeLevelFor: vi.fn().mockResolvedValue('NONE') };
  const svc = new CardFeesService(
    prisma,
    {} as AuditService,
    {} as ScopeService,
    permissions as unknown as PermissionsService,
  );
  return { svc, prisma, permissions };
}

const moDoi = { gravePlotId: 'mo-doi', plotCode: 'MO-DOI-01', capacity: 2 };
const moBa = { gravePlotId: 'mo-ba', plotCode: 'MO-BA-01', capacity: 3 };
const card = (plots: (typeof moDoi)[]) => ({ customerId: KH, companyId: CO, plots });

describe('biểu phí cấp thẻ mộ', () => {
  it('lần đầu thu 200.000 PHẲNG — mộ đôi cũng 200.000, không nhân với số cốt', async () => {
    const { svc } = build();
    const q = await svc.quote(card([moDoi]), new Date('2026-06-01'));
    expect(q.lines[0]?.feeKind).toBe('FIRST_ISSUE');
    expect(q.lines[0]?.remainsCount).toBe(1);
    expect(q.totalAmount).toBe('200000');
  });

  it('lần đầu cho mộ BA vẫn 200.000 — câu "3 cốt là 3 × 200.000" đã bỏ 02/09/2026', async () => {
    const { svc } = build();
    const q = await svc.quote(card([moBa]), new Date('2026-06-01'));
    expect(q.totalAmount).toBe('200000');
  });

  it('in lại thu 50.000 × SỐ CỐT CỦA PHẦN MỘ — mộ đôi 100.000, mộ ba 150.000', async () => {
    const doi = await build({ firstIssued: ['mo-doi'] }).svc.quote(
      card([moDoi]),
      new Date('2029-06-01'),
    );
    expect(doi.lines[0]?.feeKind).toBe('REPRINT');
    expect(doi.lines[0]?.remainsCount).toBe(2);
    expect(doi.totalAmount).toBe('100000');

    const ba = await build({ firstIssued: ['mo-ba'] }).svc.quote(
      card([moBa]),
      new Date('2029-06-01'),
    );
    expect(ba.totalAmount).toBe('150000');
  });

  /* Số cốt là số cốt CỦA PHẦN MỘ, không phải số người đã nằm. Mộ đôi mới chôn một người
   * vẫn nhân 2 — đây đúng chỗ tôi hiểu sai hai lần trước khi anh Bách đưa phép tính. */
  it('in lại nhân theo số cốt của mộ, KHÔNG theo số người đã an táng', async () => {
    const { svc } = build({ firstIssued: ['mo-doi'] });
    const q = await svc.quote(card([moDoi]), new Date('2029-06-01'));
    expect(q.lines[0]?.remainsCount).toBe(2);
  });

  it('cả đời một phần mộ đôi = 400.000 — đúng phép tính anh Bách tự đưa', async () => {
    const lanDau = await build().svc.quote(card([moDoi]), new Date('2026-06-01'));
    const inLai1 = await build({ firstIssued: ['mo-doi'] }).svc.quote(
      card([moDoi]),
      new Date('2029-06-01'),
    );
    const inLai2 = await build({ firstIssued: ['mo-doi'] }).svc.quote(
      card([moDoi]),
      new Date('2034-06-01'),
    );
    const tong = [lanDau, inLai1, inLai2].reduce((s, q) => s + Number(q.totalAmount), 0);
    expect(tong).toBe(400000);
  });

  /* "Lần đầu" neo theo CẶP (khách, mộ). Suy từ số lần cấp thẻ là sai đúng ở ca này. */
  it('khách đã có thẻ mộ A, mua thêm mộ B: A in lại + B lần đầu = 300.000', async () => {
    const { svc } = build({ firstIssued: ['mo-doi'] });
    const q = await svc.quote(card([moDoi, moBa]), new Date('2035-01-01'));
    expect(q.lines.find((l) => l.plotCode === 'MO-DOI-01')?.feeKind).toBe('REPRINT');
    expect(q.lines.find((l) => l.plotCode === 'MO-BA-01')?.feeKind).toBe('FIRST_ISSUE');
    expect(q.totalAmount).toBe('300000');
  });

  it('chưa ban hành biểu phí thì NÉM, không trả 0 — 0đ trên màn hình đọc thành miễn phí', async () => {
    const { svc } = build({ schedule: null });
    await expect(svc.quote(card([moDoi]), new Date())).rejects.toThrow(ConflictException);
  });
});

describe('miễn phí cấp thẻ', () => {
  it('không cầm cemetery.card_fee.waive thì bị từ chối', async () => {
    const { svc } = build();
    await expect(
      svc.resolveWaive({ waive: true, waiveReason: 'COMPANY_FAULT' }, 'u1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('cầm quyền nhưng không nêu lý do thì bị từ chối', async () => {
    const { svc, permissions } = build();
    permissions.scopeLevelFor.mockResolvedValue('COMPANY');
    await expect(svc.resolveWaive({ waive: true }, 'u1')).rejects.toThrow(ConflictException);
  });

  it('cầm quyền và có lý do thì miễn', async () => {
    const { svc, permissions } = build();
    permissions.scopeLevelFor.mockResolvedValue('COMPANY');
    await expect(
      svc.resolveWaive({ waive: true, waiveReason: 'OLD_CARD_RETURNED' }, 'u1'),
    ).resolves.toEqual({ waived: true, waiveReason: 'OLD_CARD_RETURNED' });
  });

  it('không xin miễn thì không hỏi quyền — người thường vẫn cấp thẻ được', async () => {
    const { svc, permissions } = build();
    await expect(svc.resolveWaive({}, 'u1')).resolves.toEqual({
      waived: false,
      waiveReason: null,
    });
    expect(permissions.scopeLevelFor).not.toHaveBeenCalled();
  });

  /* Không biết là ai thì KHÔNG được miễn — cùng nếp fail-closed với lớp che. */
  it('không có người dùng thì không miễn được', async () => {
    const { svc } = build();
    await expect(
      svc.resolveWaive({ waive: true, waiveReason: 'COMPANY_FAULT' }, null),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('miễn phí GHI ĐỦ số tiền, không ghi 0', () => {
  it('dòng phí giữ nguyên feeAmount kèm cờ waived', async () => {
    const { svc } = build();
    const quote = await svc.quote(card([moDoi]), new Date('2026-06-01'));
    const created: unknown[] = [];
    const tx = {
      graveCardFeeCharge: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          created.push(...data);
        }),
      },
    };
    await svc.recordCharges(tx as never, {
      companyId: CO,
      cardPrintLogId: 'log-1',
      customerId: KH,
      quote,
      waived: true,
      waiveReason: 'COMPANY_FAULT',
      chargedBy: 'u1',
    });
    const row = created[0] as { feeAmount: Prisma.Decimal; waived: boolean; waiveReason: string };
    expect(row.feeAmount.toString()).toBe('200000');
    expect(row.waived).toBe(true);
    expect(row.waiveReason).toBe('COMPANY_FAULT');
  });

  it('không miễn thì waiveReason phải là null — ràng buộc CSDL đòi đúng vậy', async () => {
    const { svc } = build();
    const quote = await svc.quote(card([moDoi]), new Date('2026-06-01'));
    const created: unknown[] = [];
    const tx = {
      graveCardFeeCharge: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          created.push(...data);
        }),
      },
    };
    await svc.recordCharges(tx as never, {
      companyId: CO,
      cardPrintLogId: 'log-1',
      customerId: KH,
      quote,
      waived: false,
      waiveReason: 'COMPANY_FAULT',
      chargedBy: 'u1',
    });
    expect((created[0] as { waiveReason: string | null }).waiveReason).toBeNull();
  });
});
