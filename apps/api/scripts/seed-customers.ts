/* SEED 30 KHÁCH HÀNG để có dữ liệu thật mà thử danh sách / bộ lọc khách hàng.
 *
 *   npx tsx scripts/seed-customers.ts            # chỉ liệt kê, KHÔNG ghi
 *   npx tsx scripts/seed-customers.ts --apply    # ghi thật
 *
 * Mặc định KHÔNG ghi, cùng quy ước với `reset-cemetery-data.ts`: một script ghi dữ liệu
 * chạy nhầm thì dọn tay rất lâu.
 *
 * ==== BỘ DỮ LIỆU (theo yêu cầu 27/08/2026) ====
 *   30 khách hàng cá nhân, tất cả trong MỘT công ty
 *     · 20 người còn sống, trong đó 5 người là CHỦ MỘ (có quyền sử dụng đang hiệu lực)
 *     · 10 người đã mất (có hồ sơ người mất)
 *
 * ==== VÌ SAO GOM VÀO MỘT CÔNG TY ====
 * `Customer.companyId` là trục PHẠM VI của phân quyền. Rải 30 khách ra chín công ty rác
 * thì một người dùng mức COMPANY chỉ thấy vài dòng, và bộ lọc không có gì để lọc. Một công
 * ty = một danh sách đủ dài để nhìn ra bộ lọc đúng hay sai.
 *
 * ==== VÌ SAO PHẢI TẠO HỢP ĐỒNG ====
 * `GraveUsageRight.sourceContractId` là cột **BẮT BUỘC** (không nullable). Trong hệ này,
 * quyền sử dụng mộ KHÔNG tự có — nó SINH RA từ một hợp đồng. Nên "5 người là chủ mộ" tất
 * yếu kéo theo 5 hợp đồng `Active` + 5 dòng `ContractParty` vai OWNER. Nhét thẳng quyền sử
 * dụng với một `sourceContractId` bịa là tạo con trỏ treo ngay từ lúc seed.
 *
 * ==== LUẬT ĐÃ TÔN TRỌNG ====
 *   · người mất CŨNG LÀ khách hàng → mỗi người mất đều có `Customer` trước, `DeceasedPerson` sau
 *   · `grave_usage_rights_active_plot`: một mộ chỉ MỘT quyền `Active` → 5 chủ mộ = 5 mộ khác nhau
 *   · `external_contracts` unique `(companyId, contractNo)`
 *   · `Customer.customerCode` và `Customer.personId` đều unique
 *   · mộ có chủ thì trạng thái chuyển `Allocated` (đúng như `ContractsService.activate` làm)
 *   · CCCD sinh đủ BA cột (hash chống trùng · masked để hiện · cipher để lưu), bằng ĐÚNG
 *     khoá trong `.env` — xem `_env.ts`, sai khoá là app không mở được CCCD
 *
 * ==== CHẠY LẠI ĐƯỢC ====
 * Id sinh theo thứ tự (không dùng `ulid()`, vốn phụ thuộc đồng hồ), và script BỎ QUA khách
 * hàng đã tồn tại. Chạy hai lần không nhân đôi dữ liệu.
 */
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PiiService } from '../src/common/pii/pii.service';
import { requireEncryptionKey } from './_env';
import { activeUsageRight } from '../src/common/lifecycle/active';

requireEncryptionKey();

const prisma = new PrismaClient();
const pii = new PiiService(new ConfigService());

/** Id có thứ tự, dài 26 như ULID — chạy lại cho ra cùng id, dễ đối chiếu hai lần chạy. */
const sid = (prefix: string, n: number): string =>
  `SEED${prefix.toUpperCase()}${String(n).padStart(4, '0')}`.padEnd(26, '0');

function nid(raw: string) {
  return {
    nationalIdHash: pii.hash(raw),
    nationalIdMasked: pii.mask(raw),
    nationalIdCipher: pii.encrypt(raw),
  };
}

const WARDS = [
  'phường Hồng Hải, TP Hạ Long',
  'phường Bãi Cháy, TP Hạ Long',
  'phường Cao Xanh, TP Hạ Long',
  'phường Hà Khánh, TP Hạ Long',
  'phường Cẩm Trung, TP Cẩm Phả',
  'phường Trưng Vương, TP Uông Bí',
  'thị trấn Trới, huyện Hoành Bồ',
  'phường Quang Trung, TP Móng Cái',
];

interface Seed {
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  birth: string;
  /** Có ngày mất ⇒ người này đã mất. */
  death?: string;
  /** Cố ý để trống một số trường ở vài người — xem chú thích ở `PEOPLE`. */
  sparse?: boolean;
  religion?: string;
}

/* Danh sách chọn để PHỦ CÁC NHÁNH của màn hình, không phải để trông cho nhiều:
 *   · nam/nữ xen kẽ (nhãn quan hệ suy từ giới tính)
 *   · vài người `sparse` chỉ có tên + giới tính + ngày sinh — kiểm màn hình khi trường trống
 *   · tôn giáo/dân tộc có người có người không
 *   · người mất sinh sớm hơn hẳn, và ngày mất LUÔN sau ngày sinh
 * Tên và ngày tháng là hư cấu.
 */
const ALIVE: Seed[] = [
  // 5 người đầu là CHỦ MỘ — đủ trường nhất, vì đây là hồ sơ hay được mở ra nhất.
  { fullName: 'Nguyễn Văn Hùng', gender: 'MALE', birth: '1957-04-18', religion: 'Phật giáo' },
  { fullName: 'Trần Thị Lan', gender: 'FEMALE', birth: '1961-11-02', religion: 'Phật giáo' },
  { fullName: 'Lê Quang Vinh', gender: 'MALE', birth: '1964-07-25', religion: 'Không' },
  { fullName: 'Phạm Thị Hoa', gender: 'FEMALE', birth: '1959-02-09', religion: 'Công giáo' },
  { fullName: 'Hoàng Văn Thắng', gender: 'MALE', birth: '1968-09-14', religion: 'Phật giáo' },
  // 15 người còn sống, KHÔNG đứng tên mộ nào.
  { fullName: 'Đỗ Thị Mai', gender: 'FEMALE', birth: '1972-03-30', religion: 'Phật giáo' },
  { fullName: 'Vũ Đình Khoa', gender: 'MALE', birth: '1980-12-05' },
  { fullName: 'Bùi Thị Ngọc', gender: 'FEMALE', birth: '1975-06-21', religion: 'Phật giáo' },
  { fullName: 'Đặng Văn Tuấn', gender: 'MALE', birth: '1969-01-11' },
  { fullName: 'Ngô Thị Hạnh', gender: 'FEMALE', birth: '1983-08-17', sparse: true },
  { fullName: 'Dương Minh Chiến', gender: 'MALE', birth: '1977-05-03', religion: 'Không' },
  { fullName: 'Lý Thị Thu', gender: 'FEMALE', birth: '1988-10-28' },
  { fullName: 'Trịnh Văn Nam', gender: 'MALE', birth: '1965-04-07', religion: 'Phật giáo' },
  { fullName: 'Phan Thị Yến', gender: 'FEMALE', birth: '1991-07-19', sparse: true },
  { fullName: 'Cao Đức Long', gender: 'MALE', birth: '1973-02-26', religion: 'Công giáo' },
  { fullName: 'Nguyễn Thị Bích', gender: 'FEMALE', birth: '1986-09-08' },
  { fullName: 'Hà Văn Sơn', gender: 'MALE', birth: '1979-11-15', religion: 'Phật giáo' },
  { fullName: 'Tạ Thị Kim', gender: 'FEMALE', birth: '1994-01-23', sparse: true },
  { fullName: 'Mai Xuân Trường', gender: 'MALE', birth: '1970-06-12' },
  { fullName: 'Đinh Thị Nhung', gender: 'FEMALE', birth: '1982-04-04', religion: 'Phật giáo' },
];

const DECEASED: Seed[] = [
  {
    fullName: 'Nguyễn Văn Cẩn',
    gender: 'MALE',
    birth: '1932-05-10',
    death: '2024-03-18',
    religion: 'Phật giáo',
  },
  {
    fullName: 'Trần Thị Tý',
    gender: 'FEMALE',
    birth: '1936-08-22',
    death: '2023-11-05',
    religion: 'Phật giáo',
  },
  { fullName: 'Lê Văn Đệ', gender: 'MALE', birth: '1940-01-30', death: '2025-06-27' },
  {
    fullName: 'Phạm Thị Sen',
    gender: 'FEMALE',
    birth: '1938-12-14',
    death: '2024-09-02',
    religion: 'Phật giáo',
  },
  {
    fullName: 'Hoàng Văn Bảy',
    gender: 'MALE',
    birth: '1945-03-08',
    death: '2026-01-19',
    religion: 'Không',
  },
  {
    fullName: 'Đỗ Thị Vẻ',
    gender: 'FEMALE',
    birth: '1941-07-16',
    death: '2025-02-11',
    sparse: true,
  },
  {
    fullName: 'Vũ Văn Chức',
    gender: 'MALE',
    birth: '1934-10-25',
    death: '2023-05-30',
    religion: 'Phật giáo',
  },
  {
    fullName: 'Bùi Thị Đào',
    gender: 'FEMALE',
    birth: '1947-02-03',
    death: '2026-04-08',
    religion: 'Công giáo',
  },
  { fullName: 'Đặng Văn Rư', gender: 'MALE', birth: '1943-09-19', death: '2024-12-21' },
  {
    fullName: 'Ngô Thị Lành',
    gender: 'FEMALE',
    birth: '1950-06-06',
    death: '2025-10-14',
    religion: 'Phật giáo',
  },
];

/** Số chủ mộ — 5 người ĐẦU trong `ALIVE`. */
const OWNER_COUNT = 5;

interface Target {
  companyId: string;
  cemeteryId: string;
  graveTypeId: string;
  plots: { id: string; plotCode: string }[];
}

/* Chọn công ty có NHIỀU MỘ NHẤT, và bổ sung mộ nếu chưa đủ chỗ cho 5 chủ mộ.
 *
 * Bổ sung mộ là việc CÓ CÂN NHẮC: chú thích trong `reset-cemetery-data.ts` nói phần mộ là
 * "tài sản có thật ngoài đời", nên script đó giữ lại chứ không xoá. Ở đây ta THÊM, không
 * xoá, chỉ thêm đúng số còn thiếu, và đặt mã có tiền tố `MO-SEED-` để mộ do máy sinh không
 * lẫn vào mộ đã đo đạc thật — lý do đầy đủ ở chỗ đặt mã bên dưới.
 */
async function resolveTarget(apply: boolean): Promise<Target> {
  const grouped = await prisma.gravePlot.groupBy({
    by: ['companyId'],
    _count: { _all: true },
    orderBy: { _count: { companyId: 'desc' } },
  });
  const best = grouped[0];
  if (best === undefined) throw new Error('Chưa có phần mộ nào — seed hạ tầng nghĩa trang trước');
  const companyId = best.companyId;

  const cemetery = await prisma.cemetery.findFirst({ where: { companyId } });
  if (cemetery === null) throw new Error(`Công ty ${companyId} không có nghĩa trang`);
  const graveType = await prisma.graveType.findFirst({ where: { companyId } });
  if (graveType === null) throw new Error(`Công ty ${companyId} không có loại mộ`);

  /* Chỉ nhận mộ CHƯA có quyền sử dụng đang hiệu lực. Đếm mộ `Available` là chưa đủ: trạng
   * thái mộ và quyền sử dụng là hai bảng khác nhau và có thể lệch nhau. Hỏi đúng bảng ép
   * ràng buộc (`grave_usage_rights_active_plot`) thì không lệch được. */
  const taken = await prisma.graveUsageRight.findMany({
    where: { ...activeUsageRight },
    select: { gravePlotId: true, holderCustomerId: true },
  });
  const takenIds = new Set(taken.map((t) => t.gravePlotId));
  /* Mộ mà CHÍNH các chủ mộ do script này tạo đang đứng tên thì coi như ĐÃ CÓ, không phải đi
   * tìm mộ khác. Bỏ bước này là chạy lần thứ hai sẽ thấy cả 5 mộ đều "đã có chủ", kết luận
   * là thiếu 5 mộ, rồi đẻ thêm 5 mộ nữa — và va `P2002` trên id cố định. Đã cắn thật ở lần
   * chạy thứ hai, 27/08/2026: script "chạy lại được" mà chưa ai chạy lại lần nào. */
  const oursPlotIds = new Set(
    taken.filter((t) => t.holderCustomerId.startsWith('SEEDC30')).map((t) => t.gravePlotId),
  );
  const inCompany = await prisma.gravePlot.findMany({
    where: { companyId },
    orderBy: { plotCode: 'asc' },
  });
  const ours = inCompany
    .filter((p) => oursPlotIds.has(p.id))
    .map((p) => ({ id: p.id, plotCode: p.plotCode }));
  const free = inCompany
    .filter((p) => !takenIds.has(p.id))
    .map((p) => ({ id: p.id, plotCode: p.plotCode }));
  const usable = [...ours, ...free];

  const missing = OWNER_COUNT - usable.length;
  if (missing <= 0) {
    return {
      companyId,
      cemeteryId: cemetery.id,
      graveTypeId: graveType.id,
      plots: usable.slice(0, OWNER_COUNT),
    };
  }

  console.log(`  thiếu ${missing} phần mộ trống cho ${OWNER_COUNT} chủ mộ → sẽ TẠO THÊM`);
  const created: { id: string; plotCode: string }[] = [];
  for (let i = 0; i < missing; i += 1) {
    /* Mã mộ mang tiền tố `MO-SEED-` để nó TỰ KHAI là do script sinh.
     *
     * Cố ý KHÔNG nối tiếp cách đánh số sẵn có của công ty (`P1`, `P2`, `A-01-01`…): mộ là
     * tài sản có thật ngoài đời, được đo đạc và đánh số theo mặt bằng. Một mộ do seed đẻ ra
     * mà đội lốt `P4` thì sáu tháng sau không ai phân biệt được nó với mộ thật, và sẽ có
     * người đi tìm nó ngoài thực địa. Tiền tố xấu là CHỦ ĐÍCH. */
    const plotCode = `MO-SEED-${String(i + 1).padStart(2, '0')}`;
    const plotId = sid('plt', i + 1);
    created.push({ id: plotId, plotCode });
    if (!apply) continue;
    /* Tạo NẾU chưa có. Mã mộ chỉ duy nhất theo công ty, còn id thì cố định — nên `create`
     * trần sẽ va `P2002` ngay khi script chạy lần thứ hai. */
    const exists = await prisma.gravePlot.findUnique({ where: { id: plotId } });
    if (exists !== null) continue;
    await prisma.gravePlot.create({
      data: {
        id: plotId,
        companyId,
        cemeteryId: cemetery.id,
        graveTypeId: graveType.id,
        plotCode,
        zone: 'A',
        block: '01',
        status: 'Available',
      },
    });
  }
  return {
    companyId,
    cemeteryId: cemetery.id,
    graveTypeId: graveType.id,
    plots: [...usable, ...created].slice(0, OWNER_COUNT),
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const existing = await prisma.customer.count({
    where: { customerCode: { startsWith: 'KH-2026-' } },
  });
  console.log(`Đã có ${existing} khách hàng mã KH-2026-* trong CSDL.`);

  const target = await resolveTarget(apply);
  console.log(`Công ty đích: ${target.companyId}`);
  console.log(`Nghĩa trang : ${target.cemeteryId}`);
  console.log(
    `Mộ cho chủ mộ: ${target.plots.map((p) => p.plotCode).join(', ')} (${target.plots.length}/${OWNER_COUNT})`,
  );
  console.log(
    `\nSẼ TẠO: ${ALIVE.length} người còn sống (${OWNER_COUNT} là chủ mộ) + ${DECEASED.length} người đã mất = ${ALIVE.length + DECEASED.length} khách hàng`,
  );
  console.log(`        ${OWNER_COUNT} hợp đồng + ${OWNER_COUNT} quyền sử dụng mộ`);

  if (!apply) {
    console.log('\n(chỉ liệt kê — thêm --apply để ghi thật)');
    return;
  }
  if (target.plots.length < OWNER_COUNT) {
    throw new Error(`Chỉ có ${target.plots.length} mộ trống, cần ${OWNER_COUNT}`);
  }

  const all = [...ALIVE, ...DECEASED];
  let made = 0;
  let skipped = 0;

  for (const [i, s] of all.entries()) {
    const n = i + 1;
    const customerCode = `KH-2026-${String(n).padStart(3, '0')}`;
    const already = await prisma.customer.findUnique({ where: { customerCode } });
    if (already !== null) {
      skipped += 1;
      continue;
    }

    const personId = sid('p30', n);
    const phone = `09${String(31000000 + n).padStart(8, '0')}`;
    const ward = WARDS[i % WARDS.length]!;

    await prisma.person.create({
      data: {
        id: personId,
        fullName: s.fullName,
        gender: s.gender,
        dateOfBirth: new Date(s.birth),
        /* `sparse` = chỉ có tên/giới tính/ngày sinh. Không phải cho đủ số: màn hình phải
         * đọc được cả hồ sơ thiếu, và bộ dữ liệu toàn hồ sơ đầy đủ thì không bao giờ chạm
         * vào nhánh đó. */
        ...(s.sparse === true
          ? {}
          : {
              placeOfBirth: ward.split(', ')[1] ?? 'Quảng Ninh',
              ...nid(`0${String(22000000000 + n).padStart(11, '0')}`),
              nationalIdIssuedOn: new Date('2021-06-15'),
              nationalIdIssuedPlace: 'Cục CSQLHC về TTXH',
              phone,
              permanentAddress: `Số ${n * 3}, ${ward}`,
              contactAddress: `Số ${n * 3}, ${ward}`,
              ethnicity: 'Kinh',
              ...(s.religion !== undefined ? { religion: s.religion } : {}),
            }),
      },
    });

    /* Hồ sơ KHÁCH HÀNG trước, hồ sơ NGƯỜI MẤT sau — đúng thứ tự mà `createDeceased` ép:
     * người mất cũng là khách hàng, không phải một loại hồ sơ riêng. */
    await prisma.customer.create({
      data: {
        id: sid('c30', n),
        personId,
        customerCode,
        type: 'INDIVIDUAL',
        companyId: target.companyId,
        ...(s.sparse === true ? {} : { phone }),
      },
    });

    if (s.death !== undefined) {
      await prisma.deceasedPerson.create({
        data: { id: sid('d30', n), personId, dateOfDeath: new Date(s.death) },
      });
    }
    made += 1;
  }

  // ---- 5 chủ mộ: hợp đồng → quyền sử dụng → mộ chuyển Allocated ----
  let rights = 0;
  for (let k = 0; k < OWNER_COUNT; k += 1) {
    const n = k + 1;
    const plot = target.plots[k]!;
    const customerId = sid('c30', n);
    const contractId = sid('ct30', n);
    const contractNo = `HD-2026-${String(n).padStart(3, '0')}`;

    const has = await prisma.graveUsageRight.findFirst({
      where: { gravePlotId: plot.id, ...activeUsageRight },
    });
    if (has !== null) continue;

    await prisma.externalContract.create({
      data: {
        id: contractId,
        companyId: target.companyId,
        contractNo,
        gravePlotId: plot.id,
        /* `Active` — hợp đồng ĐÃ cho hiệu lực, vì quyền sử dụng chỉ sinh ra từ hợp đồng
         * hiệu lực. Seed một hợp đồng `Draft` rồi treo quyền vào nó là dựng sẵn dữ liệu
         * mâu thuẫn với chính luật của hệ. */
        status: 'Active',
        sourceType: 'SEED',
        signedAt: new Date('2026-01-15'),
        totalAmount: 45_000_000,
      },
    });
    await prisma.contractParty.create({
      data: { id: sid('cp30', n), contractId, customerId, role: 'OWNER' },
    });
    await prisma.graveUsageRight.create({
      data: {
        id: sid('ur30', n),
        gravePlotId: plot.id,
        holderCustomerId: customerId,
        sourceContractId: contractId,
        status: 'Active',
        effectiveFrom: new Date('2026-01-15'),
      },
    });
    /* Mộ có chủ thì `Allocated` — đúng việc `ContractsService.activate` làm. Bỏ bước này
     * là để trạng thái mộ nói khác quyền sử dụng, đúng lớp lỗi `common/lifecycle` chữa. */
    await prisma.gravePlot.update({
      where: { id: plot.id },
      data: { status: 'Allocated', version: { increment: 1 } },
    });
    rights += 1;
  }

  console.log(
    `\nĐÃ TẠO ${made} khách hàng (bỏ qua ${skipped} mã đã có), ${rights} quyền sử dụng mộ.`,
  );

  // ---- tự kiểm lại, không tin vào việc mình vừa chạy ----
  const scope = { customerCode: { startsWith: 'KH-2026-' } };
  const total = await prisma.customer.count({ where: scope });
  const dead = await prisma.customer.count({
    where: { ...scope, person: { deceased: { isNot: null } } },
  });
  const owners = await prisma.graveUsageRight.count({
    where: { ...activeUsageRight, holderCustomerId: { startsWith: 'SEEDC30' } },
  });
  console.log('\nKIỂM LẠI:');
  console.log(`  tổng khách hàng KH-2026-*  ${total}  (mong đợi 30)`);
  console.log(`  đã mất                     ${dead}  (mong đợi 10)`);
  console.log(`  còn sống                   ${total - dead}  (mong đợi 20)`);
  console.log(`  chủ mộ (quyền Active)      ${owners}  (mong đợi 5)`);
  const ok = total === 30 && dead === 10 && owners === OWNER_COUNT;
  console.log(ok ? '\n=> ĐÚNG yêu cầu.' : '\n=> LỆCH so với yêu cầu, xem lại.');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
