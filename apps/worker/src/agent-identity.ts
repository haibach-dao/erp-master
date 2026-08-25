import type { PrismaClient } from '@prisma/client';

/* Danh tính của tiến trình nền.
 *
 * Worker đổi trạng thái lô mộ (giải phóng phiếu giữ chỗ hết hạn). Trước đây nó ghi
 * `changedBy: null` — một đường đổi trạng thái mộ KHÔNG CHỦ THỂ và KHÔNG QUYỀN, nằm hoàn
 * toàn ngoài hệ phân quyền. Không ai trả lời được "ai giải phóng lô mộ này".
 *
 * Ghế máy giải quyết đúng chỗ đó: worker chạy dưới một danh tính có thật, mang đúng
 * những mã quyền nó cần và không hơn.
 *
 * FAIL-CLOSED: thiếu danh tính, hoặc danh tính không mang đủ quyền, thì worker DỪNG chứ
 * không chạy ẩn danh. Chạy tiếp mới là lựa chọn nguy hiểm — nó đưa hệ về đúng trạng thái
 * mà ghế này sinh ra để chấm dứt.
 */
export const SYSTEM_WORKER_EMAIL = 'system-worker@erp.local';

/** Đúng những mã worker cần. Thêm việc cho worker ⇒ thêm mã ở đây VÀ ở ma trận vai. */
export const REQUIRED_CODES = ['cemetery.plot.set_status', 'service.subscription.cancel'];

export interface AgentIdentity {
  userId: string;
  email: string;
  permissions: string[];
}

export async function resolveAgentIdentity(prisma: PrismaClient): Promise<AgentIdentity> {
  const agent = await prisma.user.findUnique({
    where: { email: SYSTEM_WORKER_EMAIL },
    select: { id: true, email: true },
  });
  if (agent === null) {
    throw new Error(
      `Không tìm thấy ghế máy ${SYSTEM_WORKER_EMAIL}. Chạy \`pnpm --filter @erp/api db:seed\` trước. ` +
        'Worker TỪ CHỐI chạy ẩn danh: đổi trạng thái mộ mà không có chủ thể là thứ ghế này sinh ra để chấm dứt.',
    );
  }

  const now = new Date();
  const assignments = await prisma.roleAssignment.findMany({
    where: {
      userId: agent.id,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
  const permissions = [
    ...new Set(assignments.flatMap((a) => a.role.rolePermissions.map((rp) => rp.permission.code))),
  ].sort();

  const missing = REQUIRED_CODES.filter((code) => !permissions.includes(code));
  if (missing.length > 0) {
    throw new Error(
      `Ghế máy ${SYSTEM_WORKER_EMAIL} thiếu quyền: ${missing.join(', ')}. ` +
        'Worker DỪNG thay vì làm việc mà nó không được phép làm.',
    );
  }

  return { userId: agent.id, email: agent.email, permissions };
}
