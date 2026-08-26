import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BurialsService } from './burials.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const OWNER_PERSON = 'person-owner';
const DECEASED_PERSON = 'person-deceased';
const OWNER_CUSTOMER = 'cus-owner';
const PLOT = 'plot-1';
const DECEASED = 'dec-1';

type Rel = {
  sourcePersonId: string;
  targetPersonId: string;
  relationshipType: string;
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

function rel(over: Partial<Rel> = {}): Rel {
  return {
    sourcePersonId: DECEASED_PERSON,
    targetPersonId: OWNER_PERSON,
    relationshipType: 'CHILD',
    status: 'Confirmed',
    effectiveFrom: null,
    effectiveTo: null,
    ...over,
  };
}

/* Bộ lọc này lặp lại ĐÚNG ngữ nghĩa mà service yêu cầu ở tầng truy vấn: đúng chiều, đã
 * `Confirmed`, và còn hiệu lực tại thời điểm gọi. Cho mock tự lọc thay vì trả cứng — trả
 * cứng thì test vẫn xanh khi service quên mất điều kiện `status` hoặc khoảng hiệu lực,
 * mà đó chính là hai điều kiện đáng test nhất. */
function fakeFindFirst(rows: Rel[]) {
  return vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    const now = new Date();
    const hit = rows.find(
      (r) =>
        r.sourcePersonId === w.sourcePersonId &&
        r.targetPersonId === w.targetPersonId &&
        r.status === w.status &&
        (r.effectiveFrom === null || r.effectiveFrom <= now) &&
        (r.effectiveTo === null || r.effectiveTo >= now),
    );
    return Promise.resolve(hit ?? null);
  });
}

function build(
  opts: {
    rels?: Rel[];
    capacity?: number;
    activeBurials?: number;
    plotStatus?: string;
    usageRight?: unknown;
    ownerPersonId?: string | null;
    reciprocalOf?: Record<string, string>;
    deceasedMissing?: boolean;
    takenSlot?: number | null;
    alreadyBuriedAt?: string | null;
  } = {},
) {
  const {
    rels = [rel()],
    capacity = 2,
    activeBurials = 0,
    plotStatus = 'Allocated',
    usageRight = { id: 'ur-1', holderCustomerId: OWNER_CUSTOMER, status: 'Active' },
    ownerPersonId = OWNER_PERSON,
    reciprocalOf = { PARENT: 'CHILD', CHILD: 'PARENT', SPOUSE: 'SPOUSE' },
    deceasedMissing = false,
    takenSlot = null,
    alreadyBuriedAt = null,
  } = opts;

  const record = vi.fn().mockResolvedValue(undefined);
  const create = vi
    .fn()
    .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));

  const prisma = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({
        id: PLOT,
        status: plotStatus,
        capacityOverride: null,
        graveType: { defaultCapacity: capacity },
      }),
    },
    burialRecord: {
      count: vi.fn().mockResolvedValue(activeBurials),
      create,
      /* Hai câu hỏi khác nhau đi qua CÙNG một `findFirst`:
       *   - "cốt này có ai chưa"        -> `where` có `slotNumber`
       *   - "người này đã nằm đâu chưa" -> `where` có `deceasedPersonId`, không có slot
       * Phân biệt bằng hình dạng `where`; trả cứng một giá trị thì một trong hai câu hỏi
       * sẽ được trả lời sai mà test vẫn xanh. */
      findFirst: vi
        .fn()
        .mockImplementation(
          (args: { where: { slotNumber?: number; deceasedPersonId?: string } }) => {
            if (args.where.deceasedPersonId !== undefined && args.where.slotNumber === undefined) {
              return Promise.resolve(
                alreadyBuriedAt === null
                  ? null
                  : { id: 'br-cu', slotNumber: 2, gravePlotId: alreadyBuriedAt },
              );
            }
            return Promise.resolve(
              takenSlot !== null && args.where.slotNumber === takenSlot
                ? { id: 'br-cu', deceased: { person: { fullName: 'Người Đã Nằm' } } }
                : null,
            );
          },
        ),
    },
    graveUsageRight: { findFirst: vi.fn().mockResolvedValue(usageRight) },
    customer: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          ownerPersonId === undefined ? null : { id: OWNER_CUSTOMER, personId: ownerPersonId },
        ),
    },
    deceasedPerson: {
      findUnique: vi.fn().mockResolvedValue(deceasedMissing ? null : { personId: DECEASED_PERSON }),
    },
    familyRelationship: { findFirst: fakeFindFirst(rels) },
    relationshipType: {
      findUnique: vi.fn().mockImplementation((args: { where: { code: string } }) => {
        const reciprocalCode = reciprocalOf[args.where.code];
        return Promise.resolve(reciprocalCode === undefined ? null : { reciprocalCode });
      }),
    },
  } as unknown as PrismaService;

  const svc = new BurialsService(prisma, { record } as unknown as AuditService);
  return { svc, record, create };
}

const dto = { gravePlotId: PLOT, deceasedPersonId: DECEASED };

describe('an táng — phải có quan hệ với chủ mộ', () => {
  it('chụp lại đúng mã quan hệ khi người mất là con của chủ mộ', async () => {
    const { svc, create } = build({ rels: [rel({ relationshipType: 'CHILD' })] });

    const burial = (await svc.createBurial(dto, 'u1')) as Record<string, unknown>;

    expect(burial.relationshipToOwner).toBe('CHILD');
    expect(burial.ownerCustomerId).toBe(OWNER_CUSTOMER);
    expect(create).toHaveBeenCalledOnce();
  });

  it('chủ mộ tự an táng vào mộ mình đứng tên thì ghi SELF', async () => {
    // Không có dòng quan hệ nào — căn cứ là chính danh tính, không phải quan hệ nhân thân.
    const { svc, create } = build({ rels: [], ownerPersonId: DECEASED_PERSON });

    const burial = (await svc.createBurial(dto, 'u1')) as Record<string, unknown>;

    expect(burial.relationshipToOwner).toBe('SELF');
    expect(create).toHaveBeenCalledOnce();
  });

  it('chỉ có dòng chiều ngược thì quy về chiều thuận qua danh mục', async () => {
    // Dữ liệu nhập từ hệ cũ: chỉ có "chủ mộ là CHA của người mất", thiếu dòng đối ứng.
    const { svc, create } = build({
      rels: [
        rel({
          sourcePersonId: OWNER_PERSON,
          targetPersonId: DECEASED_PERSON,
          relationshipType: 'PARENT',
        }),
      ],
    });

    const burial = (await svc.createBurial(dto, 'u1')) as Record<string, unknown>;

    // PARENT (chủ→mất) quy thành CHILD (mất→chủ). Suy từ reciprocalCode, không tự đặt.
    expect(burial.relationshipToOwner).toBe('CHILD');
    expect(create).toHaveBeenCalledOnce();
  });

  it('không có quan hệ nào thì chặn, không tạo hồ sơ', async () => {
    const { svc, create } = build({ rels: [] });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('quan hệ mới khai, chưa xác nhận thì KHÔNG đủ căn cứ đặt cốt', async () => {
    const { svc, create } = build({ rels: [rel({ status: 'Pending' })] });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('quan hệ đã hết hiệu lực thì chặn', async () => {
    const { svc, create } = build({
      rels: [rel({ effectiveTo: new Date('2020-01-01') })],
    });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('mộ chưa có chủ đứng tên thì chặn — không có gì để đối chiếu quan hệ', async () => {
    const { svc, create } = build({ usageRight: null });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('mộ do khách hàng TỔ CHỨC đứng tên thì chặn thay vì lặng lẽ bỏ qua luật', async () => {
    const { svc, create } = build({ ownerPersonId: null });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('không tìm thấy hồ sơ người mất thì báo 404, không tạo hồ sơ', async () => {
    const { svc, create } = build({ deceasedMissing: true });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('an táng — một phần mộ chứa nhiều cốt', () => {
  it('cho phép đặt cốt thứ hai khi sức chứa là 2', async () => {
    const { svc, create } = build({ capacity: 2, activeBurials: 1 });

    await svc.createBurial(dto, 'u1');

    expect(create).toHaveBeenCalledOnce();
  });

  it('chặn khi đã kín sức chứa, và chặn TRƯỚC khi xét quan hệ', async () => {
    const { svc, create } = build({ capacity: 2, activeBurials: 2 });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(/Vượt sức chứa mộ \(2\/2\)/);
    expect(create).not.toHaveBeenCalled();
  });

  it('mộ chưa được phân bổ hợp đồng thì chưa an táng được', async () => {
    const { svc, create } = build({ plotStatus: 'Available' });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('an táng — dấu vết kiểm toán', () => {
  it('ghi audit kèm chủ mộ và quan hệ, để hồ sơ kể được căn cứ lúc đó', async () => {
    const { svc, record } = build({ rels: [rel({ relationshipType: 'SPOUSE' })] });

    await svc.createBurial(dto, 'u1');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BURIAL.CREATED',
        afterData: expect.objectContaining({
          ownerCustomerId: OWNER_CUSTOMER,
          relationshipToOwner: 'SPOUSE',
        }),
      }),
    );
  });
});

/* "Số lượng người mất không được nhiều hơn phần cốt" — luật chủ doanh nghiệp nêu
 * 26/08/2026. Sức chứa đã chặn TỔNG số; nhóm dưới đây chặn VỊ TRÍ: đúng một người trong
 * một cốt, và không có cốt nằm ngoài sức chứa.
 */
describe('an táng — chọn cốt trong phần mộ', () => {
  it('ghi đúng số cốt vào hồ sơ', async () => {
    const { svc, create } = build({ capacity: 4 });

    const burial = (await svc.createBurial({ ...dto, slotNumber: 3 }, 'u1')) as Record<
      string,
      unknown
    >;

    expect(burial.slotNumber).toBe(3);
    expect(create).toHaveBeenCalledOnce();
  });

  it('không chọn cốt vẫn tạo được — hồ sơ chưa xác định vị trí là chuyện có thật', async () => {
    const { svc, create } = build();

    const burial = (await svc.createBurial(dto, 'u1')) as Record<string, unknown>;

    expect(burial.slotNumber).toBeNull();
    expect(create).toHaveBeenCalledOnce();
  });

  it('cốt vượt sức chứa thì chặn, câu lỗi nói rõ mộ có mấy cốt', async () => {
    const { svc, create } = build({ capacity: 2 });

    await expect(svc.createBurial({ ...dto, slotNumber: 3 }, 'u1')).rejects.toThrow(/chỉ có 2 cốt/);
    expect(create).not.toHaveBeenCalled();
  });

  it('cốt đã có người thì chặn, và nói tên người đang nằm ở đó', async () => {
    const { svc, create } = build({ capacity: 4, takenSlot: 2 });

    await expect(svc.createBurial({ ...dto, slotNumber: 2 }, 'u1')).rejects.toThrow(
      /Cốt số 2 đã có Người Đã Nằm/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('cốt khác trong cùng mộ vẫn nhận được', async () => {
    const { svc, create } = build({ capacity: 4, takenSlot: 2 });

    await svc.createBurial({ ...dto, slotNumber: 3 }, 'u1');

    expect(create).toHaveBeenCalledOnce();
  });

  it('audit ghi cả số cốt — hồ sơ phải kể được người này nằm ở đâu', async () => {
    const { svc, record } = build({ capacity: 4 });

    await svc.createBurial({ ...dto, slotNumber: 1 }, 'u1');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        afterData: expect.objectContaining({ slotNumber: 1 }),
      }),
    );
  });
});

/* NGƯỜI MẤT CŨNG LÀ KHÁCH HÀNG (chủ doanh nghiệp chốt 26/08/2026).
 *
 * Hệ trước đó dựng theo giả định ngược lại, và hậu quả đo được: 3 người đã an táng nhưng
 * màn hình khách hàng không bao giờ thấy họ. Ép ở service chứ không chỉ ở giao diện —
 * quy ước chỉ sống ở giao diện là quy ước sẽ bị đường khác đi vòng qua.
 */
describe('hồ sơ người mất — phải là khách hàng trước', () => {
  function buildDeceased(over: { person?: unknown; existing?: unknown } = {}) {
    const create = vi
      .fn()
      .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
    const update = vi
      .fn()
      .mockImplementation((args: { data: unknown }) =>
        Promise.resolve({ id: 'dec-1', ...args.data }),
      );
    const prisma = {
      person: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            over.person === undefined
              ? { id: 'p1', fullName: 'Nguyễn Văn A', customer: { id: 'cus-1' } }
              : over.person,
          ),
      },
      deceasedPerson: {
        findUnique: vi.fn().mockResolvedValue(over.existing ?? null),
        create,
        update,
      },
    } as unknown as PrismaService;
    const svc = new BurialsService(prisma, { record: vi.fn() } as unknown as AuditService);
    return { svc, create, update };
  }

  it('người ĐÃ là khách hàng thì lập được hồ sơ người mất', async () => {
    const { svc, create } = buildDeceased();

    await svc.createDeceased({ personId: 'p1', dateOfDeath: '2026-01-15' });

    expect(create).toHaveBeenCalledOnce();
  });

  it('người CHƯA là khách hàng thì chặn, câu lỗi bảo lập hồ sơ khách hàng trước', async () => {
    const { svc, create } = buildDeceased({
      person: { id: 'p1', fullName: 'Nguyễn Văn A', customer: null },
    });

    await expect(svc.createDeceased({ personId: 'p1' })).rejects.toThrow(
      /chưa có hồ sơ khách hàng/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('không tìm thấy nhân thân thì 404', async () => {
    const { svc } = buildDeceased({ person: null });

    await expect(svc.createDeceased({ personId: 'khong-co' })).rejects.toThrow(NotFoundException);
  });

  /* Màn hình an táng gọi hàm này mỗi lần đặt cốt, và một người có thể được an táng vào mộ
   * thứ hai. Ném lỗi trùng ở đó là chặn một việc hợp lệ. */
  it('đã có hồ sơ người mất thì cập nhật, không ném lỗi trùng', async () => {
    const { svc, create, update } = buildDeceased({ existing: { id: 'dec-1' } });

    await svc.createDeceased({ personId: 'p1', dateOfDeath: '2026-02-01' });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});

/* MỘT NGƯỜI CHỈ NẰM Ở MỘT CHỖ.
 *
 * Trước đây không có kiểm này: cùng một hồ sơ người mất gán được vào hai phần mộ khác
 * nhau và không gì báo. Sức chứa chặn theo TỪNG mộ nên nó không thấy người này đã nằm ở
 * mộ bên cạnh — đúng loại lỗi chỉ lộ ra khi dữ liệu đã nhiều.
 */
describe('an táng — không an táng một người hai lần', () => {
  it('người đã nằm ở mộ khác thì chặn, và NÓI RÕ đang nằm ở đâu', async () => {
    const { svc, create } = build({ alreadyBuriedAt: 'plot-khac' });

    await expect(svc.createBurial(dto, 'u1')).rejects.toThrow(
      /đã được an táng ở phần mộ.*cốt 2.*Huỷ hồ sơ an táng cũ/s,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('người chưa nằm ở đâu thì an táng được', async () => {
    const { svc, create } = build({ alreadyBuriedAt: null });

    await svc.createBurial(dto, 'u1');

    expect(create).toHaveBeenCalledOnce();
  });
});

/* ===================== DANH SÁCH ỨNG VIÊN AN TÁNG =====================
 *
 * Ba điều kiện: đã mất · có quan hệ với chủ mộ (hoặc chính là chủ mộ) · chưa nằm ở cốt nào.
 *
 * Mock ở đây TỰ LỌC theo `where` mà service truyền xuống, không trả cứng. Trả cứng thì test
 * vẫn xanh khi service bỏ quên một điều kiện — mà bỏ quên điều kiện chính là cái hỏng đang
 * cần chặn: trước đây hộp thoại liệt kê MỌI khách hàng rồi để server từ chối.
 */
const BURIED_PERSON = 'person-buried';
const STRANGER_PERSON = 'person-stranger';

type Dec = { id: string; personId: string; fullName: string; buried: boolean; code: string };

const DEC_POOL: Dec[] = [
  { id: 'dec-1', personId: DECEASED_PERSON, fullName: 'Con Đã Mất', buried: false, code: 'KH-002' },
  { id: 'dec-2', personId: BURIED_PERSON, fullName: 'Đã Nằm Cốt', buried: true, code: 'KH-003' },
  { id: 'dec-3', personId: STRANGER_PERSON, fullName: 'Người Lạ', buried: false, code: 'KH-004' },
];

function buildCandidates(
  opts: {
    rels?: Rel[];
    usageRight?: unknown;
    ownerPerson?: { id: string; fullName: string } | null;
    ownerDeceased?: boolean;
  } = {},
) {
  const {
    rels = [rel()],
    usageRight = { id: 'ur-1', holderCustomerId: OWNER_CUSTOMER, status: 'Active' },
    ownerPerson = { id: OWNER_PERSON, fullName: 'Chủ Mộ' },
    ownerDeceased = false,
  } = opts;

  const pool = ownerDeceased
    ? [
        ...DEC_POOL,
        {
          id: 'dec-own',
          personId: OWNER_PERSON,
          fullName: 'Chủ Mộ',
          buried: false,
          code: 'KH-001',
        },
      ]
    : DEC_POOL;

  const prisma = {
    graveUsageRight: { findFirst: vi.fn().mockResolvedValue(usageRight) },
    customer: {
      findUnique: vi.fn().mockResolvedValue({
        id: OWNER_CUSTOMER,
        customerCode: 'KH-001',
        orgName: null,
        person: ownerPerson,
      }),
    },
    familyRelationship: {
      findMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        const w = args.where;
        const now = new Date();
        const ownerIds = Array.isArray(w.OR)
          ? (w.OR as Record<string, string>[]).flatMap((o) => Object.values(o))
          : [];
        return Promise.resolve(
          rels.filter((r) => {
            // Quên `status` -> quan hệ chưa xác nhận lọt vào danh sách.
            if (typeof w.status === 'string' && r.status !== w.status) return false;
            // Quên khoảng hiệu lực -> quan hệ đã huỷ vẫn lọt vào.
            if (w.AND !== undefined) {
              if (r.effectiveFrom !== null && r.effectiveFrom > now) return false;
              if (r.effectiveTo !== null && r.effectiveTo < now) return false;
            }
            // Chỉ lấy MỘT chiều -> mất nửa số người có quan hệ thật.
            if (
              ownerIds.length > 0 &&
              !ownerIds.includes(r.sourcePersonId) &&
              !ownerIds.includes(r.targetPersonId)
            ) {
              return false;
            }
            return true;
          }),
        );
      }),
    },
    deceasedPerson: {
      findMany: vi
        .fn()
        .mockImplementation(
          (args: { where: { personId: { in: string[] }; burialRecords?: unknown } }) => {
            const ids = new Set(args.where.personId.in);
            // Quên `burialRecords: none` -> người đã nằm ở cốt vẫn được mời chọn lại.
            const excludeBuried = args.where.burialRecords !== undefined;
            return Promise.resolve(
              pool
                .filter((d) => ids.has(d.personId) && (!excludeBuried || !d.buried))
                .map((d) => ({
                  id: d.id,
                  dateOfDeath: new Date('2026-02-14'),
                  person: {
                    id: d.personId,
                    fullName: d.fullName,
                    gender: 'FEMALE',
                    dateOfBirth: null,
                    customer: { id: `cus-${d.id}`, customerCode: d.code },
                  },
                })),
            );
          },
        ),
    },
  } as unknown as PrismaService;

  return new BurialsService(prisma, { record: vi.fn() } as unknown as AuditService);
}

const names = (r: { candidates: { fullName: string }[] }) => r.candidates.map((c) => c.fullName);

describe('danh sách ứng viên an táng', () => {
  it('người đã mất có quan hệ với chủ mộ thì được chọn', async () => {
    const r = await buildCandidates().burialCandidates(PLOT);
    expect(r.blocked).toBeNull();
    expect(names(r)).toEqual(['Con Đã Mất']);
    expect(r.candidates[0]?.relationshipType).toBe('CHILD');
  });

  it('người KHÔNG có quan hệ với chủ mộ thì không được chọn, dù đã mất', async () => {
    // `Người Lạ` đã mất và chưa nằm ở đâu — chỉ thiếu mỗi quan hệ.
    const r = await buildCandidates().burialCandidates(PLOT);
    expect(names(r)).not.toContain('Người Lạ');
  });

  it('người có quan hệ nhưng CÒN SỐNG thì không được chọn', async () => {
    const r = await buildCandidates({
      rels: [rel({ sourcePersonId: 'person-alive' })],
    }).burialCandidates(PLOT);
    expect(r.candidates).toHaveLength(0);
  });

  it('người ĐÃ nằm ở cốt khác thì không được chọn lại', async () => {
    const r = await buildCandidates({
      rels: [rel({ sourcePersonId: BURIED_PERSON })],
    }).burialCandidates(PLOT);
    expect(names(r)).not.toContain('Đã Nằm Cốt');
    expect(r.candidates).toHaveLength(0);
  });

  it('quan hệ CHƯA xác nhận thì không tính', async () => {
    const r = await buildCandidates({
      rels: [rel({ status: 'Pending' })],
    }).burialCandidates(PLOT);
    expect(r.candidates).toHaveLength(0);
  });

  it('quan hệ đã HẾT hiệu lực thì không tính', async () => {
    const r = await buildCandidates({
      rels: [rel({ effectiveTo: new Date('2020-01-01') })],
    }).burialCandidates(PLOT);
    expect(r.candidates).toHaveLength(0);
  });

  it('lấy quan hệ theo CẢ HAI chiều — chủ mộ đứng ở vế nào cũng được', async () => {
    const nguoc = await buildCandidates({
      rels: [rel({ sourcePersonId: OWNER_PERSON, targetPersonId: DECEASED_PERSON })],
    }).burialCandidates(PLOT);
    expect(names(nguoc)).toEqual(['Con Đã Mất']);
  });

  it('chính chủ mộ đã mất thì tự an táng được, đánh dấu SELF', async () => {
    const r = await buildCandidates({ ownerDeceased: true }).burialCandidates(PLOT);
    const self = r.candidates.find((c) => c.isOwner);
    expect(self?.fullName).toBe('Chủ Mộ');
    expect(self?.relationshipType).toBe('SELF');
  });

  it('mộ chưa có chủ thì trả LÝ DO, không phải danh sách rỗng suông', async () => {
    const r = await buildCandidates({ usageRight: null }).burialCandidates(PLOT);
    expect(r.blocked).toMatch(/chưa có chủ/);
    expect(r.candidates).toHaveLength(0);
  });

  it('mộ do tổ chức đứng tên thì trả lý do — chưa có quy tắc nhân thân', async () => {
    const r = await buildCandidates({ ownerPerson: null }).burialCandidates(PLOT);
    expect(r.blocked).toMatch(/tổ chức/);
  });
});
