/* Quét phiếu giữ chỗ ĐÃ HẾT HẠN mà vẫn mang trạng thái Active.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/expire-holds.ts [--apply]
 *
 * Mặc định CHỈ LIỆT KÊ, không sửa gì. Phải thêm `--apply` mới ghi — một script dọn dữ
 * liệu mà chạy nhầm là đổi trạng thái hàng loạt, nên mặc định phải là không làm gì.
 *
 * Vì sao script này tồn tại: `expiresAt` chỉ là một con số trong bảng, không có gì tự đổi
 * trạng thái khi nó trôi qua. Worker định kỳ (T09) chưa có, nên trong lúc chờ thì đây là
 * chỗ chạy tay hoặc gắn cron. Endpoint `POST /cemetery/holds/expire-stale` làm cùng việc
 * qua API, có phân quyền; script này dùng khi chưa có tài khoản hoặc đang ở máy CI.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const now = new Date();

  const stale = await prisma.graveHold.findMany({
    where: { status: 'Active', expiresAt: { lt: now } },
    select: { id: true, gravePlotId: true, expiresAt: true, customerId: true },
    orderBy: { expiresAt: 'asc' },
  });

  if (stale.length === 0) {
    console.log('Không có phiếu giữ chỗ nào quá hạn.');
    return;
  }

  const plots = await prisma.gravePlot.findMany({
    where: { id: { in: stale.map((h) => h.gravePlotId) } },
    select: { id: true, plotCode: true, status: true },
  });
  const plotById = new Map(plots.map((p) => [p.id, p]));

  console.log(`${stale.length} phiếu quá hạn:`);
  for (const h of stale) {
    const plot = plotById.get(h.gravePlotId);
    console.log(
      `  ${plot?.plotCode ?? h.gravePlotId} · hết hạn ${h.expiresAt.toISOString()} · mộ đang ${plot?.status ?? '?'}`,
    );
  }

  if (!apply) {
    console.log('\n(chỉ liệt kê — thêm --apply để thực sự dọn)');
    return;
  }

  let released = 0;
  for (const h of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.graveHold.update({
        where: { id: h.id },
        data: { status: 'Expired', releasedAt: now },
      });
      const plot = plotById.get(h.gravePlotId);
      /* Chỉ nhả mộ đang `Held`. Mộ đã sang `Allocated` (có hợp đồng) thì phiếu hết hạn
       * không được kéo nó về trống — hợp đồng thắng phiếu giữ chỗ. */
      if (plot !== undefined && plot.status === 'Held') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Available', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: `EXPIRE${h.id.slice(-19)}`,
            gravePlotId: plot.id,
            fromStatus: 'Held',
            toStatus: 'Available',
            reason: `giữ chỗ hết hạn ${h.expiresAt.toISOString()} (dọn bằng script)`,
            changedBy: null,
          },
        });
        released += 1;
      }
    });
  }
  console.log(`\nĐã đánh dấu hết hạn ${stale.length} phiếu, nhả ${released} phần mộ về trống.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
