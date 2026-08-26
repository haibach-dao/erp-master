/* Ai đủ điều kiện an táng vào một phần mộ — chạy CHÍNH hàm mà endpoint gọi.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/check-burial-candidates.ts <plotCode>
 *
 * CHỈ ĐỌC. In cả ba tầng để thấy TỪNG điều kiện lọc bớt ai:
 *   1. ai có quan hệ hợp lệ với chủ mộ (+ chính chủ mộ)
 *   2. trong đó ai ĐÃ MẤT
 *   3. trong đó ai CHƯA nằm ở cốt nào  <- đây mới là danh sách hộp thoại hiện
 *
 * Vì sao in cả ba: khi danh sách rỗng, "không ai có quan hệ" và "có quan hệ nhưng chưa ai
 * mất" là hai tình huống khác nhau và người dùng phải làm hai việc khác nhau. Chỉ nhìn kết
 * quả cuối thì hai cái đó giống hệt nhau.
 */
import { PrismaClient } from '@prisma/client';
import { BurialsService } from '../src/modules/burials/burials.service';
import { AuditService } from '../src/modules/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const plotCode = process.argv[2];
  if (plotCode === undefined) {
    console.error('Cách dùng: tsx scripts/check-burial-candidates.ts <plotCode>');
    process.exitCode = 1;
    return;
  }

  /* `plotCode` chỉ DUY NHẤT THEO CÔNG TY (`@@unique([companyId, plotCode])`), nên hai
   * công ty có thể cùng có mộ "A-01-01". `findFirst` sẽ lặng lẽ chọn một cái — và tôi đã
   * mắc đúng bẫy đó: script này bắt mộ này, script gán mộ bắt mộ kia, rồi tôi tưởng hệ
   * cho hai người cùng đứng tên một mộ.
   *
   * Nên: mã trùng thì DỪNG và liệt kê, bắt gọi lại bằng id. Đoán hộ người dùng ở một công
   * cụ chẩn đoán là cách nhanh nhất để chẩn đoán sai. */
  const plots = await prisma.gravePlot.findMany({
    where: { OR: [{ plotCode }, { id: plotCode }] },
    select: {
      id: true,
      plotCode: true,
      status: true,
      cemetery: { select: { name: true, companyId: true } },
    },
  });
  if (plots.length === 0) {
    console.error(`Không tìm thấy phần mộ ${plotCode}`);
    process.exitCode = 1;
    return;
  }
  if (plots.length > 1) {
    console.error(`Mã "${plotCode}" trùng ở ${plots.length} công ty. Gọi lại bằng id:\n`);
    for (const p of plots) {
      console.error(
        `  ${p.id}  ${p.plotCode}  ${p.cemetery.name}  (công ty ${p.cemetery.companyId})`,
      );
    }
    process.exitCode = 1;
    return;
  }
  const plot = plots[0]!;

  const client = prisma as unknown as PrismaService;
  const svc = new BurialsService(client, new AuditService(client));
  const result = await svc.burialCandidates(plot.id);

  console.log(`Phần mộ ${plot.plotCode} (${plot.status})`);
  if (result.blocked !== null) {
    console.log(`  CHẶN: ${result.blocked}`);
    return;
  }
  console.log(`  chủ mộ: ${result.owner?.fullName ?? '?'} (${result.owner?.customerCode ?? '?'})`);

  // Tầng 1 và 2 tra riêng để thấy điều kiện nào lọc bớt ai.
  const ownerPersonId = result.owner?.personId;
  if (ownerPersonId === undefined) return;

  const rels = await prisma.familyRelationship.findMany({
    where: {
      status: 'Confirmed',
      OR: [{ sourcePersonId: ownerPersonId }, { targetPersonId: ownerPersonId }],
    },
    select: { sourcePersonId: true, targetPersonId: true, relationshipType: true },
  });
  const relatedIds = new Set(
    rels.map((r) => (r.sourcePersonId === ownerPersonId ? r.targetPersonId : r.sourcePersonId)),
  );
  relatedIds.add(ownerPersonId);

  const withDeceased = await prisma.deceasedPerson.count({
    where: { personId: { in: [...relatedIds] } },
  });

  console.log(`\n  1. có quan hệ hợp lệ (+ chính chủ mộ) : ${relatedIds.size}`);
  console.log(`  2. trong đó đã mất                    : ${withDeceased}`);
  console.log(
    `  3. trong đó chưa nằm ở cốt nào        : ${result.candidates.length}  <- hộp thoại hiện`,
  );

  /* Ai bị loại và VÌ SAO. Không có phần này thì "0 ứng viên" trông giống hệt nhau ở ba
   * nguyên nhân hoàn toàn khác: chưa ai chết · chưa khai quan hệ · đã nằm ở cốt rồi. Tôi
   * đã mất một lượt đi tìm lỗi chỉ vì con số 0 không tự nói nó là loại 0 nào. */
  const shown = new Set(result.candidates.map((c) => c.deceasedPersonId));
  const allDeceased = await prisma.deceasedPerson.findMany({
    where: { personId: { in: [...relatedIds] } },
    select: {
      id: true,
      person: { select: { fullName: true } },
      /* `BurialRecord` chỉ có CỘT `gravePlotId`, không có quan hệ `gravePlot` — nên phải
       * tra mã mộ ở một lượt riêng bên dưới. */
      burialRecords: {
        where: { status: { in: ['Draft', 'Verified', 'Scheduled', 'Completed'] } },
        select: { slotNumber: true, gravePlotId: true },
      },
    },
  });
  const excluded = allDeceased.filter((d) => !shown.has(d.id));
  const plotIds = excluded.flatMap((d) => d.burialRecords.map((b) => b.gravePlotId));
  const plotCodeById = new Map(
    (
      await prisma.gravePlot.findMany({
        where: { id: { in: plotIds } },
        select: { id: true, plotCode: true },
      })
    ).map((p) => [p.id, p.plotCode]),
  );
  if (excluded.length > 0) {
    console.log('\n  BỊ LOẠI:');
    for (const d of excluded) {
      const at = d.burialRecords[0];
      console.log(
        `    ${d.person.fullName.padEnd(22)} ${
          at === undefined
            ? 'không quy được chiều quan hệ (createBurial cũng sẽ từ chối)'
            : `đã nằm ở ${plotCodeById.get(at.gravePlotId) ?? at.gravePlotId}${at.slotNumber === null ? '' : ` cốt ${at.slotNumber}`}`
        }`,
      );
    }
  }

  if (result.candidates.length === 0) {
    console.log('\n  (không ai đủ điều kiện)');
    return;
  }
  console.log('');
  for (const c of result.candidates) {
    console.log(
      `    ${c.fullName.padEnd(22)} ${(c.customerCode ?? '-').padEnd(14)} ${c.isOwner ? 'CHÍNH CHỦ MỘ' : (c.relationshipType ?? '?')}`,
    );
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
