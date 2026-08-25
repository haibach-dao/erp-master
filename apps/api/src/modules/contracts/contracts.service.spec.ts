import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';

const AUTHOR = 'user-author';
const MANAGER = 'user-manager';

function contract(over: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    companyId: 'co-1',
    contractNo: 'HD-001',
    gravePlotId: 'plot-1',
    contractFileId: 'file-1',
    status: 'Verified',
    signedAt: new Date('2026-01-01'),
    validTo: new Date('2056-01-01'),
    totalAmount: 250_000_000,
    createdBy: AUTHOR,
    verifiedBy: null,
    parties: [{ id: 'p1', customerId: 'cus-1', role: 'OWNER' }],
    ...over,
  };
}

function build(row: unknown) {
  const record = vi.fn().mockResolvedValue(undefined);
  const update = vi
    .fn()
    .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
  // Giao dịch thật: cho activate chạy TRỌN VẸN thay vì để nó nổ ở $transaction rồi
  // khẳng định "không nổ vì lý do X" — một khẳng định như thế xanh cả khi hỏng chỗ khác.
  const tx = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({ id: 'plot-1', status: 'Available' }),
      update: vi.fn().mockResolvedValue({}),
    },
    externalContract: { update: vi.fn().mockResolvedValue({ id: 'ct-1', status: 'Active' }) },
    gravePlotStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    graveUsageRight: { create: vi.fn().mockResolvedValue({ id: 'ur-1' }) },
  };
  const prisma = {
    externalContract: { findUnique: vi.fn().mockResolvedValue(row), update },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const svc = new ContractsService(
    prisma,
    { record } as unknown as AuditService,
    { assertCompany: vi.fn() } as unknown as ScopeService,
  );
  return { svc, record, update, tx };
}

/* Số bước phụ thuộc NGƯỜI LÀM, không phụ thuộc bản ghi (G0-Q10). Ai cầm quyền cho hiệu
 * lực thì đi thẳng; ai không cầm thì không gọi được endpoint và phải qua tay người khác.
 */
describe('verify — người soạn không tự thẩm định hợp đồng của mình', () => {
  it('CHẶN khi người thẩm định chính là người soạn', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await expect(svc.verify('ct-1', AUTHOR)).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('nói rõ vì sao chặn, không chỉ báo lỗi trạng thái', async () => {
    const { svc } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await expect(svc.verify('ct-1', AUTHOR)).rejects.toThrow(/không được tự thẩm định/);
  });

  it('cho qua khi là người khác', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await svc.verify('ct-1', MANAGER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Verified', verifiedBy: MANAGER }),
      }),
    );
  });

  it('không chặn hợp đồng cũ chưa biết ai soạn — không biết thì không khẳng định trùng người', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: null }));
    await svc.verify('ct-1', AUTHOR);
    expect(update).toHaveBeenCalled();
  });
});

describe('activate — đi thẳng được, nhưng phải để lại vết', () => {
  it('cho hiệu lực THẲNG từ Uploaded, bỏ bước thẩm định', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded' }));
    await svc.activate('ct-1', MANAGER);
    expect(tx.externalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Active', activatedBy: MANAGER }),
      }),
    );
  });

  it('ghi audit nói RÕ là đã bỏ bước thẩm định', async () => {
    const { svc, record } = build(contract({ status: 'Uploaded' }));
    await svc.activate('ct-1', MANAGER);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTRACT.ACTIVATED',
        reason: expect.stringContaining('bỏ bước thẩm định'),
        afterData: expect.objectContaining({ skippedVerification: true, fromStatus: 'Uploaded' }),
      }),
    );
  });

  it('đường đi đủ bốn bước thì KHÔNG bị đánh dấu là bỏ bước', async () => {
    const { svc, record } = build(contract({ status: 'Verified', verifiedBy: MANAGER }));
    await svc.activate('ct-1', 'user-director');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: null,
        afterData: expect.objectContaining({ skippedVerification: false }),
      }),
    );
  });

  it('người soạn tự cho hiệu lực là ĐƯỢC PHÉP — chủ doanh nghiệp đã quyết', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await svc.activate('ct-1', AUTHOR);
    expect(tx.externalContract.update).toHaveBeenCalled();
  });

  it('vẫn CHẶN trạng thái không thể cho hiệu lực', async () => {
    const { svc, tx } = build(contract({ status: 'Cancelled' }));
    await expect(svc.activate('ct-1', MANAGER)).rejects.toThrow(/Không thể cho hiệu lực/);
    expect(tx.externalContract.update).not.toHaveBeenCalled();
  });

  it('vẫn CHẶN khi thiếu dữ liệu bắt buộc, dù người gọi có quyền', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded', totalAmount: null, validTo: null }));
    await expect(svc.activate('ct-1', MANAGER)).rejects.toThrow(/Thiếu/);
    expect(tx.externalContract.update).not.toHaveBeenCalled();
  });

  it('vẫn CHẶN khi lô mộ đã được phân bổ cho hợp đồng khác', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded' }));
    tx.gravePlot.findUnique.mockResolvedValue({ id: 'plot-1', status: 'Allocated' });
    await expect(svc.activate('ct-1', MANAGER)).rejects.toThrow(/không phân bổ được/);
  });
});
