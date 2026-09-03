import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';

const CUSTOMER = 'cus-1';
const PERSON = 'p1';

type Counts = Partial<{
  rights: number;
  holds: number;
  ownerBurials: number;
  cards: number;
  subscriptions: number;
  parties: number;
  burialsAsDeceased: number;
  relationships: number;
  transactions: number;
}>;

function build(
  opts: { counts?: Counts; deceased?: boolean; missing?: boolean; orgOnly?: boolean } = {},
) {
  const { counts = {}, deceased = false, missing = false, orgOnly = false } = opts;
  const n = (k: keyof Counts): number => counts[k] ?? 0;

  const record = vi.fn().mockResolvedValue(undefined);
  const deleted: string[] = [];
  /* Trả `{ count: 1 }` chứ không trả `{}`: `deleteMany` của Prisma LUÔN trả số dòng, và
   * service dùng con số đó để ghi nhật ký. Mock trả sai hình dạng thì service tính ra `NaN`
   * mà không có gì nổ — nhật ký ghi `NaN` là mất luôn con số cần rà. */
  const del = (name: string) =>
    vi.fn().mockImplementation(() => {
      deleted.push(name);
      return Promise.resolve({ count: 1 });
    });

  /* GỠ con trỏ (nhóm thứ ba của sổ) là `updateMany`, không phải `deleteMany` — nên nó KHÔNG
   * vào mảng `deleted`. Ghi riêng để test khẳng định được là dòng đó còn sống và chỉ mất con
   * trỏ; gộp vào `deleted` là xoá mất chính điều đang cần chứng minh. */
  const detached: { model: string; where: unknown; data: unknown }[] = [];
  const detach = (name: string) =>
    vi.fn().mockImplementation((args: { where: unknown; data: unknown }) => {
      detached.push({ model: name, where: args.where, data: args.data });
      return Promise.resolve({ count: 1 });
    });

  const tx = {
    graveUsageRight: { deleteMany: del('graveUsageRight') },
    graveHold: { deleteMany: del('graveHold') },
    /* Thẻ nhãn XOÁ THEO: nó là siêu dữ liệu của bản ghi, không phải giấy tờ đã trao khách.
     * Khách yêu cầu xoá hồ sơ thì mọi nhãn ta từng gán phải đi cùng; dấu vết ai gắn ai gỡ
     * ở lại nhật ký kiểm toán, chỗ đúng để giữ nó. */
    customerTag: { deleteMany: del('customerTag') },
    /* Hồ sơ an táng đứng ở CẢ HAI nhóm: `deleteMany` dọn hồ sơ ĐÃ HUỶ của người mất này,
     * `updateMany` gỡ con trỏ chủ mộ khỏi hồ sơ đã huỷ của NGƯỜI KHÁC. */
    burialRecord: { deleteMany: del('burialRecord'), updateMany: detach('burialRecord') },
    familyRelationship: { deleteMany: del('familyRelationship') },
    personPhone: { deleteMany: del('personPhone') },
    personAddress: { deleteMany: del('personAddress') },
    personEducation: { deleteMany: del('personEducation') },
    personBankAccount: { deleteMany: del('personBankAccount') },
    deceasedPerson: { deleteMany: del('deceasedPerson') },
    customer: { delete: del('customer'), update: vi.fn().mockResolvedValue({}) },
    person: { delete: del('person'), update: vi.fn().mockResolvedValue({}) },
  };

  const prisma = {
    customer: {
      findUnique: vi.fn().mockResolvedValue(
        missing
          ? null
          : {
              id: CUSTOMER,
              customerCode: 'KH-0001',
              orgName: orgOnly ? 'Công ty X' : null,
              personId: orgOnly ? null : PERSON,
              person: orgOnly ? null : { id: PERSON, fullName: 'Nguyễn Văn A' },
            },
      ),
    },
    /* Rào chắn đi theo SỔ ĐĂNG KÝ, nên mock phải phủ mọi model trong sổ. Thiếu một model
     * là `undefined.count` — và đó chính là cách test này bắt được việc ai đó thêm mục
     * vào sổ mà quên nghĩ tới hậu quả. */
    graveUsageRight: {
      count: vi.fn().mockResolvedValue(n('rights')),
      /* `identify` gọi `findMany` để chỉ đích danh thứ đang chặn. Mock trả nhãn thật để
       * test kiểm được rằng lời từ chối có nêu MÃ MỘ, không chỉ nêu số lượng. */
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: Math.min(n('rights'), 3) }, (_, i) => ({
          gravePlot: { plotCode: `A-0${i + 1}` },
        })),
      ),
    },
    graveHold: { count: vi.fn().mockResolvedValue(n('holds')) },
    burialRecord: {
      /* Hai câu hỏi khác nhau đi qua cùng một `count`, phân biệt bằng hình dạng `where`:
       *   - `ownerCustomerId` -> khách này là CHỦ MỘ trong hồ sơ của người khác
       *   - `deceased`        -> chính khách này ĐÃ ĐƯỢC AN TÁNG (đi qua hồ sơ người mất)
       * Trả cứng một giá trị thì một trong hai câu bị trả lời sai mà test vẫn xanh. */
      count: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'ownerCustomerId' in args.where
            ? n('ownerBurials')
            : 'deceased' in args.where
              ? n('burialsAsDeceased')
              : /* Nhánh thứ ba KHÔNG được im lặng trả 0: một `where` hình dạng lạ nghĩa
                 * là service đã hỏi một câu mock chưa nghĩ tới, và trả 0 là để rào chắn
                 * đó biến mất mà test vẫn xanh. */
                Promise.reject(
                  new Error(`burialRecord.count nhận where lạ: ${JSON.stringify(args.where)}`),
                ),
        ),
      ),
      /* `identify` của sổ theo nhân thân. Trả dữ liệu THẬT về hình dạng (id mộ lỏng, số
       * cốt, trạng thái) để test kiểm được rằng lời từ chối nêu MÃ MỘ và SỐ CỐT — chính là
       * thứ đã thiếu ngày 27/08/2026. */
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: Math.min(n('burialsAsDeceased'), 3) }, (_, i) => ({
          gravePlotId: `plot-${i + 1}`,
          slotNumber: i + 2,
          status: 'Draft',
        })),
      ),
    },
    /* `BurialRecord.gravePlotId` là con trỏ LỎNG (không có quan hệ Prisma), nên `identify`
     * phải hỏi bảng mộ một lượt nữa. Mock tra theo đúng danh sách id được truyền vào —
     * trả cứng thì test vẫn xanh khi service hỏi nhầm id. */
    gravePlot: {
      findMany: vi
        .fn()
        .mockImplementation((args: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            args.where.id.in.map((id) => ({ id, plotCode: `A-${id.replace('plot-', '0')}` })),
          ),
        ),
    },
    cardPrintLog: { count: vi.fn().mockResolvedValue(n('cards')) },
    /* Khoản phí cấp thẻ CHẶN xoá khách: đây là tiền khách đã trả, xoá hồ sơ mà mang theo
     * khoản đã thu là mất khả năng đối chứng với chính người đã trả. `identify` nêu số
     * tiền và ngày để lời từ chối chỉ đích danh, không chỉ đếm. */
    graveCardFeeCharge: {
      count: vi.fn().mockResolvedValue(n('cardFees')),
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: Math.min(n('cardFees'), 3) }, () => ({
          feeAmount: '200000',
          chargedAt: new Date('2026-09-02'),
        })),
      ),
    },
    serviceSubscription: { count: vi.fn().mockResolvedValue(n('subscriptions')) },
    serviceTransaction: { count: vi.fn().mockResolvedValue(n('transactions')) },
    contractParty: {
      count: vi.fn().mockResolvedValue(n('parties')),
      findMany: vi.fn().mockResolvedValue(
        Array.from({ length: Math.min(n('parties'), 3) }, (_, i) => ({
          contract: { contractNo: `HD${i + 1}` },
        })),
      ),
    },
    deceasedPerson: {
      findUnique: vi.fn().mockResolvedValue(deceased ? { id: 'dec-1' } : null),
    },
    familyRelationship: { count: vi.fn().mockResolvedValue(n('relationships')) },
    person: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const svc = new CustomersService(
    prisma,
    {
      hash: () => 'h',
      mask: () => '079***123',
      encrypt: () => 'c',
    } as unknown as PiiService,
    { record } as unknown as AuditService,
    {} as unknown as ScopeService,
  );
  return { svc, record, deleted, detached, tx, prisma };
}

/* Các bảng trỏ tới khách hàng bằng id LỎNG — chỉ `grave_holds` có khoá ngoại. Nghĩa là
 * CSDL sẽ vui vẻ để lại con trỏ treo nếu service không tự đếm. Nhóm test này neo từng chỗ
 * đếm đó lại; thiếu một chỗ là xoá xong mới phát hiện, mà lúc đó dữ liệu đã đi rồi.
 */
describe('xoá khách hàng — chặn khi đã phát sinh nghiệp vụ', () => {
  it.each([
    ['đang đứng tên phần mộ', { rights: 1 }, /đang đứng tên 1 phần mộ \(A-01\)/],
    ['có phiếu giữ chỗ', { holds: 2 }, /2 phiếu giữ chỗ còn hiệu lực/],
    ['là chủ mộ trong hồ sơ an táng', { ownerBurials: 1 }, /chủ mộ trong 1 hồ sơ an táng/],
    /* Siết chặt hơn ngày 27/08/2026: biểu thức cũ `/đã được an táng/` xanh cả khi lời từ
     * chối KHÔNG nói mộ nào — mà đúng chỗ đó là lỗi phải chữa. Nêu đích danh mã mộ, số cốt
     * và trạng thái, vì trạng thái mới cho biết hồ sơ đó có huỷ được hay không. */
    [
      'đã được an táng',
      { burialsAsDeceased: 1 },
      /đã được an táng \(1 hồ sơ\) \(mộ A-01 cốt 2, Draft\)/,
    ],
    ['đã cấp thẻ mộ', { cards: 3 }, /được cấp 3 thẻ quản lý mộ/],
    ['đang dùng dịch vụ', { subscriptions: 1 }, /1 dịch vụ đang dùng/],
    ['có giao dịch thu tiền', { transactions: 2 }, /2 giao dịch thu tiền/],
    ['là bên trong hợp đồng', { parties: 1 }, /bên trong 1 hợp đồng đang hiệu lực \(HD1\)/],
  ])('%s thì chặn', async (_label, counts, pattern) => {
    const { svc, deleted } = build({ counts, deceased: (counts as Counts).burialsAsDeceased! > 0 });

    await expect(svc.deleteCustomer(CUSTOMER, 'u1')).rejects.toThrow(pattern);
    expect(deleted).toEqual([]);
  });

  /* Câu từ chối phải nêu ĐỦ mọi thứ đang chặn. Nêu một cái rồi bắt người dùng dọn xong
   * quay lại nhận cái thứ hai là bắt họ đoán còn bao nhiêu vòng nữa. */
  it('nhiều thứ chặn cùng lúc thì liệt kê ĐỦ, không dừng ở cái đầu tiên', async () => {
    const { svc } = build({ counts: { rights: 1, cards: 2, parties: 1 } });

    await expect(svc.deleteCustomer(CUSTOMER, 'u1')).rejects.toThrow(
      /đang đứng tên 1 phần mộ \(A-01\).*bên trong 1 hợp đồng đang hiệu lực \(HD1\).*được cấp 2 thẻ quản lý mộ/s,
    );
  });

  it('mọi trường hợp chặn đều là 409, không phải 500', async () => {
    const { svc } = build({ counts: { rights: 1 } });
    await expect(svc.deleteCustomer(CUSTOMER, 'u1')).rejects.toThrow(ConflictException);
  });

  it('không tìm thấy khách hàng thì 404', async () => {
    const { svc } = build({ missing: true });
    await expect(svc.deleteCustomer(CUSTOMER, 'u1')).rejects.toThrow(NotFoundException);
  });
});

describe('xoá khách hàng — khi sạch thì dọn hết, không để lại mảnh', () => {
  it('xoá cả bảng phụ, quan hệ, hồ sơ khách và nhân thân', async () => {
    const { svc, deleted } = build({ deceased: true });

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(deleted).toEqual([
      /* Dòng lịch sử (quyền đã thu hồi, phiếu đã hết hạn) không CHẶN xoá nhưng phải đi
         cùng — để lại thì thành con trỏ treo, vì hai bảng đó không có khoá ngoại. */
      'graveUsageRight',
      'graveHold',
      'customerTag',
      /* Hồ sơ an táng ĐÃ HUỶ của chính người này. PHẢI đứng trước `deceasedPerson`: khoá
         ngoại giữa hai bảng là ON DELETE RESTRICT, sai thứ tự là `P2003`. Đây là thứ tự
         khai trong `PERSON_CASCADE_REFERENCES`, và test này khoá nó lại. */
      'burialRecord',
      /* HAI lần: sổ khai riêng cột `sourcePersonId` và cột `targetPersonId`, mỗi cột một
         mệnh đề chính xác thay vì một `OR` — để đổi tên một cột là đỏ test đối chiếu. */
      'familyRelationship',
      'familyRelationship',
      'personPhone',
      'personAddress',
      'personEducation',
      'personBankAccount',
      'deceasedPerson',
      'customer',
      'person',
    ]);
  });

  /* Xoá Customer mà để lại Person là tạo ra đúng cái lệch đã phải đi vá bằng migration:
   * một nhân thân không gắn khách hàng nào. */
  it('xoá luôn nhân thân, không để lại hồ sơ mồ côi', async () => {
    const { svc, deleted } = build();

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(deleted).toContain('person');
  });

  it('khách tổ chức không có nhân thân thì chỉ xoá hồ sơ khách', async () => {
    const { svc, deleted } = build({ orgOnly: true });

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(deleted).toEqual(['graveUsageRight', 'graveHold', 'customerTag', 'customer']);
  });

  /* Xoá người này rút họ khỏi cây gia đình của người kia. Nói ra con số thay vì lặng lẽ
   * xoá — người bấm nút cần biết mình vừa động vào hồ sơ của ai nữa. */
  it('báo số quan hệ đã xoá theo', async () => {
    const { svc, record } = build({ counts: { relationships: 3 } });

    const res = await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(res.deletedRelationships).toBe(3);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER.DELETED',
        beforeData: expect.objectContaining({ deletedRelationships: 3 }),
      }),
    );
  });
});

/* Hai đường ghi SINH RA ngày 27/08/2026 cùng với trạng thái `Cancelled` của hồ sơ an táng.
 *
 * Cả hai đều động vào dữ liệu người bấm nút KHÔNG nhìn thấy, nên cả hai đều phải có test
 * riêng — không có test thì lần refactor sau chúng biến mất trong im lặng.
 */
describe('xoá khách hàng — hệ quả của việc HUỶ hồ sơ an táng', () => {
  /* Hồ sơ an táng đã huỷ KHÔNG chặn xoá (nó rơi khỏi `activeBurial()`), nhưng nếu để lại
   * thì `deceased_persons` không xoá được: khoá ngoại là ON DELETE RESTRICT. Trước khi có
   * trạng thái `Cancelled`, tình huống này KHÔNG tồn tại — mọi hồ sơ luôn còn hiệu lực nên
   * rào chắn giữ hết. Thêm một trạng thái rơi ra ngoài bộ lọc là mở đúng ngõ cụt này. */
  it('hồ sơ an táng đã huỷ được dọn TRƯỚC hồ sơ người mất, không để nổ khoá ngoại', async () => {
    const { svc, deleted } = build({ deceased: true });

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(deleted).toContain('burialRecord');
    expect(deleted.indexOf('burialRecord')).toBeLessThan(deleted.indexOf('deceasedPerson'));
  });

  /* Hồ sơ an táng đã huỷ của NGƯỜI KHÁC, mà khách đang bị xoá từng là chủ mộ: dòng đó
   * KHÔNG phải của họ, nên gỡ con trỏ chứ không xoá. Xoá là xoá lịch sử của người khác;
   * để nguyên là để lại con trỏ treo (cột này không có khoá ngoại). */
  it('con trỏ chủ mộ trên hồ sơ của NGƯỜI KHÁC bị GỠ, không bị xoá', async () => {
    const { svc, deleted, detached } = build();

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(detached).toContainEqual({
      model: 'burialRecord',
      where: { ownerCustomerId: CUSTOMER },
      data: { ownerCustomerId: null },
    });
    // Và đúng là GỠ chứ không phải xoá: không có lần `deleteMany` nào cho cùng mục đích.
    expect(deleted.filter((d) => d === 'burialRecord')).toHaveLength(1);
  });

  /* Ghi mà không đếm là ghi không rà lại được. Hai con số này là bằng chứng duy nhất cho
   * thấy một lần xoá khách hàng đã động tới hồ sơ an táng nào. */
  it('nhật ký đếm cả hồ sơ an táng đã dọn lẫn con trỏ đã gỡ', async () => {
    const { svc, record } = build({ deceased: true });

    const res = await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(res.deletedCancelledBurials).toBe(1);
    expect(res.detachedBurialOwners).toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER.DELETED',
        beforeData: expect.objectContaining({
          deletedCancelledBurials: 1,
          detachedBurialOwners: 1,
        }),
      }),
    );
  });
});

describe('sửa khách hàng', () => {
  it('sửa CCCD thì sinh lại CẢ BA cột, không sửa lẻ một cột', async () => {
    const { svc, tx } = build();

    await svc.updateCustomer(CUSTOMER, { person: { nationalId: '079123456789' } }, 'u1');

    expect(tx.person.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nationalIdHash: 'h',
          nationalIdMasked: '079***123',
          nationalIdCipher: 'c',
        }),
      }),
    );
  });

  /* "Không gửi" khác "gửi chuỗi rỗng": không gửi = giữ nguyên, rỗng = XOÁ giá trị. Không
   * phân biệt được thì không có cách nào xoá một giá trị đã nhập sai. */
  it('gửi chuỗi rỗng thì XOÁ giá trị, không ghi chuỗi rỗng', async () => {
    const { svc, tx } = build();

    await svc.updateCustomer(CUSTOMER, { person: { religion: '' } }, 'u1');

    expect(tx.person.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ religion: null }) }),
    );
  });

  it('không gửi trường nào thì không đụng tới nhân thân', async () => {
    const { svc, tx } = build();

    await svc.updateCustomer(CUSTOMER, { phone: '0900000000' }, 'u1');

    expect(tx.person.update).not.toHaveBeenCalled();
  });

  /* Audit ghi TÊN trường đã đổi, KHÔNG ghi giá trị: nhật ký đọc được bằng mã quyền khác
   * với mã mở khoá CCCD, chép giá trị vào đó là mở cửa sau vòng qua lớp che. */
  it('audit ghi tên trường đã đổi, KHÔNG ghi giá trị CCCD', async () => {
    const { svc, record } = build();

    await svc.updateCustomer(CUSTOMER, { person: { nationalId: '079123456789' } }, 'u1');

    const call = record.mock.calls[0]?.[0] as { afterData: Record<string, unknown> };
    expect(call.afterData.changedPersonFields).toContain('nationalIdHash');
    expect(JSON.stringify(call.afterData)).not.toContain('079123456789');
  });

  it('sửa nhân thân của khách TỔ CHỨC thì báo lỗi rõ ràng', async () => {
    const { svc } = build({ orgOnly: true });

    await expect(svc.updateCustomer(CUSTOMER, { person: { fullName: 'X' } }, 'u1')).rejects.toThrow(
      /tổ chức/,
    );
  });

  it('không tìm thấy khách hàng thì 404', async () => {
    const { svc } = build({ missing: true });
    await expect(svc.updateCustomer(CUSTOMER, { phone: '1' }, 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

/* HAI LỖI ĐÃ XẢY RA THẬT (26/08/2026, chủ doanh nghiệp phát hiện).
 *
 * Người dùng thu hồi phần mộ, màn hình báo "chưa đứng tên phần mộ nào", nhưng bấm xoá thì
 * bị từ chối "đang đứng tên 1 phần mộ". Hai câu trả lời trái nhau cho cùng một câu hỏi,
 * vì rào chắn đếm MỌI dòng bất kể trạng thái.
 *
 * Cùng lúc, một phiếu giữ chỗ hết hạn từ 7 tiếng trước vẫn mang trạng thái `Active` (chưa
 * có ai quét hết hạn), và cũng chặn xoá dù nó chẳng giữ gì nữa.
 */
describe('xoá khách hàng — chỉ đếm thứ CÒN HIỆU LỰC', () => {
  it('quyền sử dụng đã THU HỒI thì không chặn xoá', async () => {
    const { svc, prisma, deleted } = build();

    await svc.deleteCustomer(CUSTOMER, 'u1');

    // Rào chắn phải hỏi kèm status, không đếm suông theo chủ sở hữu.
    expect(
      (prisma as unknown as { graveUsageRight: { count: ReturnType<typeof vi.fn> } })
        .graveUsageRight.count,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'Active' }) }),
    );
    expect(deleted).toContain('customer');
  });

  it('phiếu giữ chỗ đã HẾT HẠN thì không chặn, dù trạng thái vẫn Active', async () => {
    const { svc, prisma } = build();

    await svc.deleteCustomer(CUSTOMER, 'u1');

    const call = (prisma as unknown as { graveHold: { count: ReturnType<typeof vi.fn> } }).graveHold
      .count.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.status).toBe('Active');
    // Lọc theo NGÀY HẾT HẠN, không chỉ theo trạng thái.
    expect(call.where.expiresAt).toBeDefined();
  });

  it('hồ sơ an táng đã HUỶ thì không chặn xoá', async () => {
    const { svc, prisma } = build();

    await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(
      (prisma as unknown as { burialRecord: { count: ReturnType<typeof vi.fn> } }).burialRecord
        .count,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: expect.any(Array) } }),
      }),
    );
  });

  it('báo số quyền và phiếu lịch sử đã xoá theo', async () => {
    const { svc } = build();

    const res = await svc.deleteCustomer(CUSTOMER, 'u1');

    expect(res).toHaveProperty('deletedUsageRights');
    expect(res).toHaveProperty('deletedHolds');
  });
});

/* ===================== CHẤM DỨT QUAN HỆ NHÂN THÂN =====================
 *
 * Chấm dứt hai lần từng ghi đè `effectiveTo` sang ngày HÔM NAY — tức là sửa lại quá khứ.
 * Quan hệ chấm dứt từ tháng trước bỗng thành chấm dứt hôm nay, và câu hỏi "lúc an táng thì
 * quan hệ còn hiệu lực không" bị trả lời sai. Hồ sơ an táng dựa vào đúng câu trả lời đó.
 */
function buildRel(status: string, reciprocalId: string | null = 'rel-b') {
  const updates: { id: string; effectiveTo: Date | null }[] = [];
  const prisma = {
    familyRelationship: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'rel-a',
        status,
        reciprocalRelationshipId: reciprocalId,
        effectiveTo: status === 'Ended' ? new Date('2026-01-15') : null,
      }),
      update: vi
        .fn()
        .mockImplementation((args: { where: { id: string }; data: { effectiveTo: Date } }) => {
          updates.push({ id: args.where.id, effectiveTo: args.data.effectiveTo });
          return Promise.resolve({ id: args.where.id });
        }),
    },
    $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  const svc = new CustomersService(
    prisma,
    {} as unknown as PiiService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    {} as unknown as ScopeService,
  );
  return { svc, updates };
}

describe('chấm dứt quan hệ nhân thân', () => {
  it('chấm dứt quan hệ đang hiệu lực thì đóng cả hai chiều', async () => {
    const { svc, updates } = buildRel('Confirmed');

    await svc.endRelationship('rel-a', 'u1');

    expect(updates.map((u) => u.id).sort()).toEqual(['rel-a', 'rel-b']);
  });

  it('quan hệ ĐÃ chấm dứt thì từ chối, KHÔNG ghi đè ngày chấm dứt cũ', async () => {
    const { svc, updates } = buildRel('Ended');

    await expect(svc.endRelationship('rel-a', 'u1')).rejects.toThrow(ConflictException);
    // Không có lệnh ghi nào chạy — ngày chấm dứt tháng trước vẫn nguyên.
    expect(updates).toHaveLength(0);
  });
});
