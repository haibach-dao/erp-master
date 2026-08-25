import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { REQUIRED_CODES, SYSTEM_WORKER_EMAIL, resolveAgentIdentity } from './agent-identity';

function build(opts: { agent?: unknown; codes?: string[] }) {
  const codes = opts.codes ?? REQUIRED_CODES;
  return {
    user: { findUnique: vi.fn().mockResolvedValue(opts.agent) },
    roleAssignment: {
      findMany: vi.fn().mockResolvedValue([
        {
          role: { rolePermissions: codes.map((code) => ({ permission: { code } })) },
        },
      ]),
    },
  } as unknown as PrismaClient;
}

const AGENT = { id: 'agent-1', email: SYSTEM_WORKER_EMAIL };

/* Worker đổi được trạng thái lô mộ, nên nó phải có danh tính và quyền như bất kỳ chủ thể
 * nào khác. Chạy ẩn danh là thứ ghế máy sinh ra để chấm dứt — nên mọi nhánh hỏng ở đây
 * đều phải DỪNG, không được rơi về hành vi cũ.
 */
describe('resolveAgentIdentity — fail-closed', () => {
  it('trả về danh tính khi ghế máy có đủ quyền', async () => {
    const identity = await resolveAgentIdentity(build({ agent: AGENT }));
    expect(identity.userId).toBe('agent-1');
    expect(identity.permissions).toEqual([...REQUIRED_CODES].sort());
  });

  it('DỪNG khi chưa seed ghế máy, và chỉ ra cách khắc phục', async () => {
    await expect(resolveAgentIdentity(build({ agent: null }))).rejects.toThrow(/db:seed/);
  });

  it('DỪNG khi ghế máy thiếu quyền, và nói thiếu mã nào', async () => {
    const prisma = build({ agent: AGENT, codes: ['cemetery.plot.set_status'] });
    await expect(resolveAgentIdentity(prisma)).rejects.toThrow(/service\.subscription\.cancel/);
  });

  it('DỪNG khi ghế máy không được gán vai nào', async () => {
    const prisma = build({ agent: AGENT, codes: [] });
    await expect(resolveAgentIdentity(prisma)).rejects.toThrow(/thiếu quyền/);
  });

  it('chỉ đọc dòng gán vai còn trong hạn — quyền hết hạn thì ghế máy cũng mất', async () => {
    const prisma = build({ agent: AGENT });
    await resolveAgentIdentity(prisma);
    const where = (prisma.roleAssignment.findMany as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(where.where.validFrom).toBeDefined();
    expect(where.where.OR).toEqual([{ validTo: null }, { validTo: { gt: expect.any(Date) } }]);
  });
});
