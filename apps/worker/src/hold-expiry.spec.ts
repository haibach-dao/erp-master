import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { expireHolds } from './hold-expiry';
import type { AgentIdentity } from './agent-identity';

const AGENT: AgentIdentity = {
  userId: 'agent-1',
  email: 'system-worker@erp.local',
  permissions: ['cemetery.plot.set_status', 'service.subscription.cancel'],
};

function build(opts: { plotStatus?: string; holdStatus?: string } = {}) {
  const tx = {
    graveHold: {
      findUnique: vi.fn().mockResolvedValue({ id: 'h1', status: opts.holdStatus ?? 'Active' }),
      update: vi.fn().mockResolvedValue({}),
    },
    gravePlot: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'plot-1', companyId: 'co-1', status: opts.plotStatus ?? 'Held' }),
      update: vi.fn().mockResolvedValue({}),
    },
    gravePlotStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    auditEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    graveHold: {
      findMany: vi.fn().mockResolvedValue([{ id: 'h1', gravePlotId: 'plot-1' }]),
    },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

/* Giải phóng lô mộ là một hành vi nghiệp vụ, nên nó phải có CHỦ THỂ và để lại VẾT.
 * Trước đây nó ghi `changedBy: null` và không phát audit — không ai trả lời được "ai
 * giải phóng lô mộ này".
 */
describe('expireHolds — lô mộ được giải phóng bởi một danh tính có thật', () => {
  it('ghi changedBy là ghế máy, không phải null', async () => {
    const { prisma, tx } = build();
    await expireHolds(prisma, AGENT);
    expect(tx.gravePlotStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changedBy: 'agent-1' }) }),
    );
  });

  it('phát audit với actorType AGENT, trong CÙNG transaction đổi trạng thái mộ', async () => {
    const { prisma, tx } = build();
    await expireHolds(prisma, AGENT);
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: 'AGENT',
          actorId: 'agent-1',
          action: 'GRAVE.HOLD_EXPIRED',
          companyId: 'co-1',
          source: 'JOB',
        }),
      }),
    );
    // Cùng client `tx` cho cả hai việc: không có cửa nào để lô mộ được giải phóng mà
    // nhật ký không có dòng nào.
    expect(tx.gravePlot.update).toHaveBeenCalled();
  });

  it('không đổi gì khi phiếu giữ chỗ đã không còn Active — idempotent', async () => {
    const { prisma, tx } = build({ holdStatus: 'Released' });
    await expireHolds(prisma, AGENT);
    expect(tx.gravePlot.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('không chạm lô mộ đã sang trạng thái khác, và không phát audit sai sự thật', async () => {
    const { prisma, tx } = build({ plotStatus: 'Allocated' });
    await expireHolds(prisma, AGENT);
    expect(tx.gravePlot.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
