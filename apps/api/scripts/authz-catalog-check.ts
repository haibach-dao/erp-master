/* Gác lệch danh mục quyền: mã nguồn nói gì, bảng `authz.permissions` THẬT đang có gì.
 *
 *   pnpm --filter @erp/api check:permissions
 *   DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/authz-catalog-check.ts
 *
 * Chạy SAU mỗi lần triển khai, và trước khi kết luận một sự cố phân quyền là "lỗi cấp
 * quyền". Lệch là thoát 1.
 *
 * VÌ SAO CẦN (đo được 03/09/2026): hai cửa vào bảng này không đối xứng. Cửa XOÁ mã đi qua
 * `prisma migrate deploy`, chạy tự động mỗi lần triển khai. Cửa THÊM mã chỉ đi qua
 * `prisma db seed`, mà không lệnh nào tự gọi (`postinstall` chỉ `prisma generate`). Nên
 * thêm một dòng `p('...')` là một thay đổi triển khai xong mà CSDL không hề biết, và triệu
 * chứng ở màn hình là 403 cho tất cả mọi người — trông y hệt một lỗi cấp quyền.
 *
 * CHỈ ĐỌC. Script này không ghi, không seed, không xoá một dòng nào — nó chỉ nói phải chạy
 * cái gì. Sửa là một hành động có người bấm, không phải tác dụng phụ của một lệnh kiểm.
 *
 * Phép so nằm ở `src/modules/authorization/catalog-drift.ts` (hàm thuần, có test chạy trên
 * CI không cần Postgres); ở đây chỉ có phần lấy dữ liệu thật và phần in.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '../src/modules/authorization/permission-catalog';
import { diffCatalogAgainstDatabase, totalDrift } from '../src/modules/authorization/catalog-drift';
import { loadDotEnv } from './_env';

async function main(): Promise<void> {
  /* `tsx` KHÔNG tự nạp `.env` (API nạp qua `ConfigModule.forRoot()`, script thì không) —
   * thiếu dòng này thì `DATABASE_URL` rỗng và Prisma ném một câu lỗi không nhắc tới `.env`.
   * Phải gọi TRƯỚC khi dựng `PrismaClient`: hằng số đọc biến môi trường lúc khởi tạo. */
  loadDotEnv();

  const prisma = new PrismaClient();
  const database = await prisma.permission.findMany({
    select: { code: true, sensitivity: true, wildcardExempt: true },
    orderBy: { code: 'asc' },
  });

  const drift = diffCatalogAgainstDatabase(PERMISSION_CATALOG, database);

  /* Ai đang CẦM những mã thừa — chỉ hỏi khi có mã thừa, và chỉ để in. Một mã mồ côi không
   * ai cầm là rác; một mã mồ côi đang mở cửa cho hai vai là một quyền còn hiệu lực mà đọc
   * mã nguồn không thấy. Hai việc đó không cùng mức khẩn. */
  const orphanCodes = drift.orphanedInDatabase.map((row) => row.code);
  const orphanGrants =
    orphanCodes.length === 0
      ? []
      : await prisma.rolePermission.findMany({
          where: { permission: { code: { in: orphanCodes } } },
          select: {
            scope: true,
            role: { select: { code: true } },
            permission: { select: { code: true } },
          },
        });

  await prisma.$disconnect();

  console.log('# Gác lệch danh mục quyền');
  console.log(`# mã nguồn: ${PERMISSION_CATALOG.length} mã · CSDL: ${database.length} dòng`);
  console.log(
    '# (hai con số này BẰNG NHAU vẫn có thể lệch — một mã đổi tên là một thiếu + một thừa)\n',
  );

  console.log(
    `## 1. THIẾU MÃ — có trong mã nguồn, KHÔNG có dòng trong CSDL (${drift.missingInDatabase.length})`,
  );
  if (drift.missingInDatabase.length === 0) {
    console.log('   (không có)\n');
  } else {
    for (const def of drift.missingInDatabase) {
      console.log(`   ${def.sensitivity}  ${def.code}`);
    }
    console.log('');
    console.log('   HẬU QUẢ: CHẾT TÍNH NĂNG, không cấp thừa cho ai. `PermissionGuard` tra');
    console.log('   `getPermissionMeta` trên bảng này; không có dòng thì nó ném');
    console.log('   "Mã quyền không có trong danh mục" TRƯỚC khi hỏi ma trận vai — mọi');
    console.log('   người bị chặn, ADMIN cũng vậy. Đừng đọc thành lỗi cấp quyền.');
    console.log('   PHẢI LÀM: chạy seed (chỉ thêm dòng danh mục, KHÔNG cấp cho ai):');
    console.log('       pnpm --filter @erp/api db:seed');
    console.log('   rồi chạy lại lệnh này.\n');
  }

  console.log(
    `## 2. MÃ THỪA — còn dòng trong CSDL, KHÔNG còn trong mã nguồn (${drift.orphanedInDatabase.length})`,
  );
  if (drift.orphanedInDatabase.length === 0) {
    console.log('   (không có)\n');
  } else {
    for (const row of drift.orphanedInDatabase) {
      const holders = orphanGrants.filter((g) => g.permission.code === row.code);
      const who =
        holders.length === 0
          ? 'chưa cấp cho vai nào'
          : `ĐANG CẤP CHO: ${holders.map((g) => `${g.role.code}|${g.scope}`).join(', ')}`;
      console.log(`   ${row.sensitivity}  ${row.code}  — ${who}`);
    }
    console.log('');
    console.log('   HẬU QUẢ ngược hẳn nhóm 1: dòng còn đó nên guard đi tiếp, và');
    console.log('   `authz.role_permissions` vẫn trỏ vào được — mã vẫn CẤP ĐƯỢC từ màn hình');
    console.log('   quản trị và vẫn MỞ CỬA ĐƯỢC, trong khi đọc mã nguồn không thấy nó ở đâu.');
    console.log('   Seed KHÔNG xoá gì, nên chạy seed không sửa được nhóm này.');
    console.log('   PHẢI LÀM: viết một migration xoá, theo đúng nếp hai migration đã có');
    console.log('   (`20260825200000_drop_wildcard_permission`,');
    console.log('    `20260826151000_drop_person_search_permission`) — xoá `role_permissions`');
    console.log('   trỏ vào mã TRƯỚC, rồi mới xoá dòng trong `permissions`.');
    console.log('   Nếu mã vẫn còn cần: thêm lại `p(...)` vào danh mục và giải thích vì sao.\n');
  }

  console.log(
    `## 3. LỆCH SIÊU DỮ LIỆU — cùng mã, khác sensitivity/wildcardExempt (${drift.metadataMismatches.length})`,
  );
  if (drift.metadataMismatches.length === 0) {
    console.log('   (không có)\n');
  } else {
    for (const m of drift.metadataMismatches) {
      console.log(`   ${m.code}  ${m.field}: nguồn=${m.inSource}  CSDL=${m.inDatabase}`);
    }
    console.log('');
    console.log('   HẬU QUẢ: nhóm im lặng nhất — hai bên đều "có mã" nên đếm bao nhiêu cũng');
    console.log('   khớp. `wildcardExempt` lệch là LEO THANG: guard đọc cờ này từ DÒNG CSDL,');
    console.log('   nguồn `true` mà CSDL `false` thì một grant `*` với tới được leaf S3.');
    console.log('   `sensitivity` lệch là RÀ SAI: màn hình ma trận đọc cột này từ CSDL, người');
    console.log('   duyệt nhìn thấy S1 cạnh một mã nguồn đã nâng lên S3.');
    console.log('   PHẢI LÀM: `pnpm --filter @erp/api db:seed` — upsert ghi đè cả hai trường.');
    console.log('   Nếu chạy seed xong vẫn lệch thì có người sửa tay trong CSDL: tìm ra ai.\n');
  }

  if (totalDrift(drift) === 0) {
    console.log('KHÔNG LỆCH: danh mục mã nguồn và bảng `authz.permissions` khớp nhau.');
    return;
  }

  console.log(`!! LỆCH ${totalDrift(drift)} dòng. Xem mục tương ứng ở trên để biết phải làm gì.`);
  process.exitCode = 1;
}

/* KHÔNG kiểm được cũng là THOÁT 1, không phải thoát 0.
 *
 * Đây là cổng chặn triển khai, nên "chưa biết" phải chặn giống hệt "có lệch": một cổng im lặng
 * cho qua khi không với tới được CSDL là một cổng sẽ mở đúng vào lúc hạ tầng đang trục trặc —
 * tức đúng lúc nguy cơ lệch cao nhất.
 *
 * Lỗi không nối được CSDL nói gọn một câu: nó là chuyện cấu hình, không phải chuyện phân quyền,
 * và một vệt stack Prisma ở đây làm người đọc đi tìm nhầm chỗ. Mọi lỗi KHÁC in nguyên — không
 * đoán được thì đừng tóm tắt. */
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Can't reach database server") || message.includes('ECONNREFUSED')) {
    console.error('KHÔNG ĐỐI CHIẾU ĐƯỢC: không nối được tới CSDL.');
    /* Lấy đúng DÒNG NÓI VỀ KẾT NỐI, không phải dòng đầu tiên. `message` của Prisma mở đầu bằng
     * một dòng trống rồi tới `Invalid prisma.x() invocation in` — cả hai đều không nói được gì
     * cho người đang đọc, còn dòng có địa chỉ máy chủ mới là dòng chỉ ra phải sửa ở đâu. */
    const reason = message
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) => line.startsWith("Can't reach database server") || line.includes('ECONNREFUSED'),
      );
    console.error(`  ${reason ?? 'không rõ địa chỉ CSDL'}`);
    console.error('  Kiểm `DATABASE_URL` trong `apps/api/.env`, và CSDL đã chạy chưa');
    console.error('  (local: `docker compose up -d postgres`).');
    console.error('  Thoát 1 vì CHƯA BIẾT phải chặn giống như CÓ LỆCH — xem chú thích cuối file.');
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
