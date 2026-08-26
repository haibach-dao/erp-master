/* Huỷ một hợp đồng bằng CHÍNH mã nghiệp vụ của API, chạy trực tiếp trên CSDL.
 *
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/cancel-contract.ts <contractNo> "<lý do>" [--apply]
 *
 * Vì sao có script này: trang hợp đồng nằm sau đăng nhập, và ở môi trường chưa có mật
 * khẩu thì không có cách nào KIỂM xem đường huỷ có chạy thật hay không. Suy luận "mã trông
 * đúng" không phải kiểm.
 *
 * Nó gọi `ContractsService.cancel` — cùng hàm mà endpoint gọi — nên nếu ở đây chạy đúng
 * thì trên web cũng đúng, và nếu ở đây hỏng thì đã tìm ra lỗi trước khi người dùng gặp.
 *
 * KHÔNG áp phân quyền: script chạy bằng `DATABASE_URL`, tức đã ở trong hàng rào máy chủ.
 * Dùng để chẩn đoán và dọn dữ liệu, không phải để phát cho người không có quyền.
 *
 * Mặc định CHỈ XEM. Phải thêm `--apply` mới ghi.
 */
import { PrismaClient } from '@prisma/client';
import { ContractsService } from '../src/modules/contracts/contracts.service';
import { AuditService } from '../src/modules/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ScopeService } from '../src/modules/authorization/scope.service';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const contractNo = process.argv[2];
  const reason = process.argv[3];
  const apply = process.argv.includes('--apply');

  if (contractNo === undefined || reason === undefined) {
    console.error('Cách dùng: tsx scripts/cancel-contract.ts <contractNo> "<lý do>" [--apply]');
    process.exitCode = 1;
    return;
  }

  const contract = await prisma.externalContract.findFirst({
    where: { contractNo },
    select: { id: true, contractNo: true, status: true, gravePlotId: true },
  });
  if (contract === null) {
    console.error(`Không tìm thấy hợp đồng ${contractNo}`);
    process.exitCode = 1;
    return;
  }

  const plot = await prisma.gravePlot.findUnique({
    where: { id: contract.gravePlotId },
    select: { plotCode: true, status: true },
  });
  const rights = await prisma.graveUsageRight.count({
    where: { sourceContractId: contract.id, status: 'Active' },
  });

  console.log(`Hợp đồng ${contract.contractNo}: ${contract.status}`);
  console.log(`  phần mộ ${plot?.plotCode ?? '?'}: ${plot?.status ?? '?'}`);
  console.log(`  quyền sử dụng do hợp đồng này sinh, đang hiệu lực: ${rights}`);

  if (!apply) {
    console.log('\n(chỉ xem — thêm --apply để thực sự huỷ)');
    return;
  }

  const client = prisma as unknown as PrismaService;
  const svc = new ContractsService(
    client,
    new AuditService(client),
    /* Phạm vi đã được bảo đảm bởi việc script này chỉ chạy được khi có DATABASE_URL. */
    { assertCompany: async () => undefined } as unknown as ScopeService,
  );

  await svc.cancel(contract.id, { reason }, null);

  const after = await prisma.externalContract.findUnique({
    where: { id: contract.id },
    select: { status: true },
  });
  const plotAfter = await prisma.gravePlot.findUnique({
    where: { id: contract.gravePlotId },
    select: { plotCode: true, status: true },
  });
  const rightsAfter = await prisma.graveUsageRight.count({
    where: { sourceContractId: contract.id, status: 'Active' },
  });

  console.log(`\nSAU KHI HUỶ:`);
  console.log(`  hợp đồng: ${after?.status ?? '?'}`);
  console.log(`  phần mộ ${plotAfter?.plotCode ?? '?'}: ${plotAfter?.status ?? '?'}`);
  console.log(`  quyền sử dụng còn hiệu lực: ${rightsAfter}`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
