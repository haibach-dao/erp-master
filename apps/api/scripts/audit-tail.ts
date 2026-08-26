/* In N dòng nhật ký kiểm toán gần nhất, ĐÃ đổi id thành tên — đúng như trang web hiện.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/audit-tail.ts [số dòng]
 *
 * Vì sao cần: trang `/audit` nằm sau đăng nhập, nên khi gỡ lỗi hiển thị mà chưa có tài
 * khoản (hoặc đang ở máy CI) thì không có cách nào nhìn thấy kết quả. Script này đi cùng
 * đường phân giải nhãn với API — cùng `audit-labels.ts` — nên nó không phải bản mô phỏng
 * "gần giống": nếu ở đây nhãn ra sai thì trên web cũng sai.
 *
 * CHỈ ĐỌC. Không ghi gì, không cần quyền — nó chạy bằng DATABASE_URL, tức là đã ở trong
 * hàng rào của máy chủ. Vì vậy nó KHÔNG áp lớp che: dùng nó để chẩn đoán, đừng dùng nó
 * để đưa nhật ký cho người không có `audit.event.view`.
 */
import { PrismaClient } from '@prisma/client';
import {
  entityLabelFor,
  entityTypeLabel,
  resolveActorLabels,
  resolveEntityLabels,
} from '../src/modules/audit/audit-labels';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

const two = (n: number): string => String(n).padStart(2, '0');

/* Cùng định dạng với `lib/audit.ts` phía web: dd/MM/yyyy HH:mm:ss theo múi giờ MÁY ĐANG
 * CHẠY. Cột thứ hai in mốc ISO tuyệt đối để đối chiếu với log máy chủ. */
function localTime(d: Date): string {
  return (
    `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  );
}

async function main(): Promise<void> {
  const take = Number(process.argv[2] ?? 20);
  const rows = await prisma.auditEvent.findMany({ orderBy: { occurredAt: 'desc' }, take });
  if (rows.length === 0) {
    console.log('Nhật ký rỗng.');
    return;
  }

  const client = prisma as unknown as PrismaService;
  const [actors, entities] = await Promise.all([
    resolveActorLabels(client, rows),
    resolveEntityLabels(client, rows),
  ]);

  console.log(
    `${'THỜI ĐIỂM'.padEnd(20)}| ${'AI'.padEnd(26)}| ${'HÀNH ĐỘNG'.padEnd(32)}| ${'LOẠI'.padEnd(18)}| ĐỐI TƯỢNG`,
  );
  console.log('-'.repeat(130));
  for (const r of rows) {
    const actor =
      r.actorId === null
        ? `(${r.actorType})`
        : (actors.get(r.actorId) ?? `(không tra ra) ${r.actorId.slice(-8)}`);
    console.log(
      `${localTime(r.occurredAt).padEnd(20)}| ${actor.padEnd(26)}| ${r.action.padEnd(32)}| ` +
        `${entityTypeLabel(r.entityType).padEnd(18)}| ${entityLabelFor(entities, r.entityType, r.entityId)}`,
    );
  }
  console.log(
    `\n${rows.length} dòng · múi giờ máy: UTC${new Date().getTimezoneOffset() <= 0 ? '+' : '-'}${Math.abs(new Date().getTimezoneOffset() / 60)}`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
