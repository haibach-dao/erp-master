import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CardsService } from './cards.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { PermissionsService } from '../authorization/permissions.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { CardFeesService } from './card-fees.service';
import type { Caller } from '../authorization/caller';

/* Caller mang theo MÃ QUYỀN đang thi hành, không chỉ userId — phạm vi được tính theo
 * TỪNG mã, nên truyền thiếu mã là kiểm phạm vi trên một câu hỏi khác câu đang chạy. */
const CALLER_PRINT: Caller = { userId: 'u1', permission: 'cemetery.card.print' };
const CALLER_VIEW: Caller = { userId: 'u1', permission: 'cemetery.card.view' };

const CUSTOMER = 'cus-1';
const PLOT = 'plot-1';

function burial(over: Record<string, unknown> = {}) {
  return {
    id: 'br-1',
    gravePlotId: PLOT,
    status: 'Completed',
    burialDate: new Date('2024-03-01'),
    relationshipToOwner: 'CHILD',
    deceased: {
      dateOfDeath: new Date('2024-02-20'),
      person: { fullName: 'Nguyễn Văn B', dateOfBirth: new Date('1950-01-01') },
    },
    ...over,
  };
}

function build(
  opts: {
    rights?: unknown[];
    burials?: unknown[];
    capacity?: number;
    capacityOverride?: number | null;
    lastPrintNumber?: number | null;
    companyId?: string | null;
    customerMissing?: boolean;
    log?: unknown;
    /** Người gọi có cầm `crm.person.view_sensitive` không — quyết CCCD trên thẻ. */
    holdsSensitive?: boolean;
    /** Hồ sơ chưa nhập CCCD — không có gì để giải mã. */
    noNationalId?: boolean;
  } = {},
) {
  const {
    rights = [
      { id: 'ur-1', gravePlotId: PLOT, status: 'Active', effectiveFrom: new Date('2020-05-01') },
    ],
    burials = [burial()],
    capacity = 4,
    capacityOverride = null,
    lastPrintNumber = null,
    companyId = 'co-1',
    customerMissing = false,
    log = null,
    holdsSensitive = false,
    noNationalId = false,
  } = opts;

  const record = vi.fn().mockResolvedValue(undefined);
  const createLog = vi
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...args.data, id: 'log-new' }),
    );
  const findFirstLog = vi
    .fn()
    .mockResolvedValue(lastPrintNumber === null ? null : { printNumber: lastPrintNumber });

  const prisma = {
    customer: {
      findUnique: vi.fn().mockResolvedValue(
        customerMissing
          ? null
          : {
              id: CUSTOMER,
              customerCode: 'KH-0001',
              companyId,
              orgName: null,
              phone: '0900000000',
              person: {
                fullName: 'Nguyễn Văn A',
                gender: 'MALE',
                dateOfBirth: new Date('1970-07-07'),
                nationalIdCipher: noNationalId ? null : 'iv:tag:enc',
                nationalIdMasked: noNationalId ? null : '079***789',
                nationalIdIssuedOn: new Date('2021-06-15'),
                nationalIdIssuedPlace: 'Cục CSQLHC',
                phone: '0911111111',
                permanentAddress: 'Số 1, Hạ Long',
                religion: 'Phật giáo',
              },
            },
      ),
    },
    graveUsageRight: { findMany: vi.fn().mockResolvedValue(rights) },
    gravePlot: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: PLOT,
          plotCode: 'A-01-05',
          zone: 'Khu A',
          subzone: null,
          block: 'Khối 1',
          row: 'Dãy 5',
          mapX: 12.5,
          mapY: 30,
          capacityOverride,
          cemetery: { name: 'An Lạc Viên' },
          graveType: { name: 'Mộ gia đình', defaultCapacity: capacity },
        },
      ]),
    },
    burialRecord: { findMany: vi.fn().mockResolvedValue(burials) },
    cardPrintLog: {
      findFirst: findFirstLog,
      findUnique: vi.fn().mockResolvedValue(log),
      create: createLog,
      findMany: vi.fn().mockResolvedValue([]),
    },
    graveCardFeeCharge: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        cardPrintLog: { findFirst: findFirstLog, create: createLog },
        graveCardFeeCharge: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    ),
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const decrypt = vi.fn().mockReturnValue('079123456789');
  const holdsForMasking = vi.fn().mockResolvedValue(holdsSensitive);
  /* Biểu phí mock ở đây, không mock ở tầng Prisma: nhóm test này kiểm LUỒNG CẤP THẺ
   * (xem trước không ghi gì, số cấp không nhảy, nhật ký nói đúng CCCD). Phép tính tiền có
   * bộ test riêng ở `card-fees.service.spec.ts` — trộn hai việc vào một mock thì mỗi lần
   * đổi biểu phí lại làm đỏ những test không liên quan tới tiền. */
  const quote = vi.fn().mockResolvedValue({
    scheduleId: 'sch-1',
    effectiveFrom: new Date('2026-01-01'),
    lines: [],
    totalAmount: '0',
  });
  const resolveWaive = vi.fn().mockResolvedValue({ waived: false, waiveReason: null });
  const recordCharges = vi.fn().mockResolvedValue([]);
  const svc = new CardsService(
    prisma,
    { record } as unknown as AuditService,
    { assertCompanyFor } as unknown as ScopeService,
    { decrypt } as unknown as PiiService,
    { holdsForMasking } as unknown as PermissionsService,
    { quote, resolveWaive, recordCharges } as unknown as CardFeesService,
  );
  return {
    svc,
    record,
    createLog,
    assertCompanyFor,
    decrypt,
    holdsForMasking,
    quote,
    resolveWaive,
    recordCharges,
  };
}

/* Lỗi đắt nhất của bản hệ cũ: mở thẻ ra xem cũng ghi một dòng nhật ký, nên bấm Hủy ở hộp
 * thoại in vẫn làm "Lần cấp" nhảy. Số đó in trên giấy và khách dùng để đối chứng, nên nó
 * sai là hồ sơ sai. Đây là nhóm test giữ cho lỗi đó không quay lại.
 */
describe('thẻ mộ — xem trước KHÔNG phải là cấp thẻ', () => {
  it('xem trước không ghi dòng nhật ký nào', async () => {
    const { svc, createLog, record } = build();

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as Record<string, unknown>;

    expect(createLog).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(card.issued).toBe(false);
  });

  it('xem trước báo số DỰ KIẾN, không phải số đã cấp', async () => {
    const { svc } = build({ lastPrintNumber: 2 });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as Record<string, unknown>;

    expect(card.nextPrintNumber).toBe(3);
    expect(card.printNumber).toBeUndefined();
  });

  it('cấp thẻ mới ghi nhật ký và phát audit', async () => {
    const { svc, createLog, record } = build({ lastPrintNumber: 1 });

    const card = (await svc.issue(
      CUSTOMER,
      { printReason: 'Đổi thông tin' },
      CALLER_PRINT,
    )) as Record<string, unknown>;

    expect(card.printNumber).toBe(2);
    expect(card.issued).toBe(true);
    expect(createLog).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'GRAVE_CARD.ISSUED' }));
  });

  it('lần cấp đầu tiên là 1', async () => {
    const { svc } = build({ lastPrintNumber: null });

    const card = (await svc.issue(CUSTOMER, {}, CALLER_PRINT)) as Record<string, unknown>;

    expect(card.printNumber).toBe(1);
  });

  it('in lại đọc đúng số cũ, KHÔNG sinh số mới', async () => {
    const { svc, createLog } = build({
      log: {
        id: 'log-7',
        customerId: CUSTOMER,
        companyId: 'co-1',
        printNumber: 2,
        approvedBy: 'Trần Văn C',
        approvedTitle: 'PHÓ GIÁM ĐỐC',
      },
    });

    const card = (await svc.reprint('log-7', CALLER_VIEW)) as Record<string, unknown>;

    expect(card.printNumber).toBe(2);
    expect(card.reprint).toBe(true);
    expect(card.approvedBy).toBe('Trần Văn C');
    expect(createLog).not.toHaveBeenCalled();
  });

  it('in lại một lần cấp không tồn tại thì 404', async () => {
    const { svc } = build({ log: null });

    await expect(svc.reprint('khong-co', CALLER_VIEW)).rejects.toThrow(NotFoundException);
  });
});

describe('thẻ mộ — nội dung in ra', () => {
  it('chừa đủ dòng trống theo sức chứa của phần mộ', async () => {
    // Sức chứa 4, đã an táng 1 => thẻ phải chừa 3 dòng trống.
    const { svc } = build({ capacity: 4, burials: [burial()] });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as { plots: Record<string, unknown>[] };

    expect(card.plots[0].capacity).toBe(4);
    expect(card.plots[0].emptySlots).toBe(3);
  });

  it('sức chứa ghi đè trên phần mộ thắng mặc định của loại mộ', async () => {
    const { svc } = build({ capacity: 4, capacityOverride: 2, burials: [burial()] });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as { plots: Record<string, unknown>[] };

    expect(card.plots[0].capacity).toBe(2);
    expect(card.plots[0].emptySlots).toBe(1);
  });

  it('mộ đã kín thì không chừa dòng âm', async () => {
    const { svc } = build({
      capacity: 1,
      burials: [burial(), burial({ id: 'br-2' })],
    });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as { plots: Record<string, unknown>[] };

    expect(card.plots[0].emptySlots).toBe(0);
  });

  it('in quan hệ đã CHỤP LẠI lúc an táng, không tra lại quan hệ hiện tại', async () => {
    const { svc } = build({ burials: [burial({ relationshipToOwner: 'SPOUSE' })] });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as {
      plots: { occupants: Record<string, unknown>[] }[];
    };

    expect(card.plots[0].occupants[0].relationshipToOwner).toBe('SPOUSE');
  });

  /* Đổi 28/08/2026. Test cũ khẳng định thẻ KHÔNG bao giờ mang bản rõ, và nó khẳng định
   * đúng cái lỗi: service đọc cột `nationalIdMasked` nên thẻ ra bản che với MỌI người,
   * kể cả người cầm S3. Chủ doanh nghiệp quyết thẻ phải in được số đầy đủ, nên đường đi
   * bây giờ là: service trả BẢN RÕ, `MaskingInterceptor` che lại nếu người gọi không cầm
   * `crm.person.view_sensitive`. Việc che không còn nằm trong service — nên ở đây chỉ
   * kiểm service giao đúng bản rõ, và kiểm việc che ở `masking-invariants`. */
  it('trả CCCD BẢN RÕ và để lớp che quyết — service không tự che', async () => {
    const { svc, decrypt } = build();

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as { owner: Record<string, unknown> };

    expect(card.owner.nationalId).toBe('079123456789');
    expect(decrypt).toHaveBeenCalledWith('iv:tag:enc');
    expect(card.owner).not.toHaveProperty('nationalIdMasked');
  });

  it('người chưa có CCCD trong hồ sơ thì không gọi giải mã', async () => {
    const { svc, decrypt } = build({ noNationalId: true });

    const card = (await svc.preview(CUSTOMER, CALLER_VIEW)) as { owner: Record<string, unknown> };

    expect(card.owner.nationalId).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe('thẻ mộ — chặn trước khi cấp', () => {
  it('khách chưa đứng tên mộ nào thì không cấp thẻ', async () => {
    const { svc, createLog } = build({ rights: [] });

    await expect(svc.issue(CUSTOMER, {}, CALLER_PRINT)).rejects.toThrow(ConflictException);
    expect(createLog).not.toHaveBeenCalled();
  });

  it('khách chưa gắn công ty quản lý thì không cấp thẻ', async () => {
    const { svc, createLog } = build({ companyId: null });

    await expect(svc.issue(CUSTOMER, {}, CALLER_PRINT)).rejects.toThrow(ConflictException);
    expect(createLog).not.toHaveBeenCalled();
  });

  it('không tìm thấy khách thì 404', async () => {
    const { svc } = build({ customerMissing: true });

    await expect(svc.preview(CUSTOMER, CALLER_VIEW)).rejects.toThrow(NotFoundException);
  });

  it('kiểm phạm vi công ty TRƯỚC khi dựng thẻ', async () => {
    const { svc, assertCompanyFor } = build();

    await svc.preview(CUSTOMER, CALLER_VIEW);

    /* Ba tham số, và tham số GIỮA là thứ đáng kiểm nhất: mã quyền đang thi hành. Thiếu nó
     * thì phạm vi được tính ở mức rộng nhất của người gọi — đúng lớp lỗi vừa vá. */
    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'cemetery.card.view', 'co-1');
  });
});

/* Mỗi tờ thẻ mang số CCCD thật là một bản sao dữ liệu cá nhân RỜI KHỎI HỆ — không thu hồi
 * được. NĐ 13/2023 đòi biết ai đưa dữ liệu của một người ra ngoài và lúc nào, nên nhật ký
 * phải phân biệt được thẻ có số thật với thẻ có số đã che. */
describe('thẻ mộ — nhật ký nói rõ thẻ có mang CCCD đầy đủ hay không', () => {
  it('người cầm view_sensitive: ghi FULL', async () => {
    const { svc, record } = build({ holdsSensitive: true });

    await svc.issue(CUSTOMER, {}, CALLER_PRINT);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE_CARD.ISSUED',
        afterData: expect.objectContaining({ nationalIdOnCard: 'FULL' }),
      }),
    );
  });

  it('người không cầm view_sensitive: ghi MASKED', async () => {
    const { svc, record } = build({ holdsSensitive: false });

    await svc.issue(CUSTOMER, {}, CALLER_PRINT);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE_CARD.ISSUED',
        afterData: expect.objectContaining({ nationalIdOnCard: 'MASKED' }),
      }),
    );
  });

  /* In lại cũng đẩy ra một tờ giấy nữa, nên cũng phải ghi. Bỏ sót chỗ này thì đếm được
   * số LẦN CẤP có số thật mà không đếm được số TỜ có số thật. */
  it('in lại cũng ghi, vì in lại cũng đẩy ra một tờ giấy nữa', async () => {
    const { svc, record } = build({
      holdsSensitive: true,
      log: { id: 'log-1', customerId: CUSTOMER, companyId: 'co-1', printNumber: 2 },
    });

    await svc.reprint('log-1', CALLER_VIEW);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE_CARD.REPRINTED',
        afterData: expect.objectContaining({ nationalIdOnCard: 'FULL' }),
      }),
    );
  });

  /* Hỏi ĐÚNG mã đang mở khoá lớp che. Hỏi mã khác thì nhật ký nói một đằng, tờ giấy in
   * một nẻo — và không ai phát hiện được vì cả hai đều "chạy đúng". */
  it('hỏi đúng mã crm.person.view_sensitive, không phải mã nào khác', async () => {
    const { svc, holdsForMasking } = build();

    await svc.issue(CUSTOMER, {}, CALLER_PRINT);

    expect(holdsForMasking).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive');
  });

  /* Ca biên: request không mang người dùng. Ghi MASKED và ĐỪNG hỏi — cùng nếp fail closed
   * với lớp che, vốn cũng che khi không biết người gọi là ai. */
  it('không biết người gọi là ai thì ghi MASKED, không hỏi quyền', async () => {
    const { svc, record, holdsForMasking } = build({ holdsSensitive: true });

    await svc.issue(CUSTOMER, {}, { userId: null, permission: 'cemetery.card.print' });

    expect(holdsForMasking).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        afterData: expect.objectContaining({ nationalIdOnCard: 'MASKED' }),
      }),
    );
  });
});
