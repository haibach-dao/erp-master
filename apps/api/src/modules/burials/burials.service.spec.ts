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
      /* Cốt đã có người hay chưa. Trả `null` = còn trống, trừ khi test khai `takenSlot`. */
      findFirst: vi
        .fn()
        .mockImplementation((args: { where: { slotNumber?: number } }) =>
          Promise.resolve(
            takenSlot !== null && args.where.slotNumber === takenSlot
              ? { id: 'br-cu', deceased: { person: { fullName: 'Người Đã Nằm' } } }
              : null,
          ),
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
