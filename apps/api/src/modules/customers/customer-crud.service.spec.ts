import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';

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
}>;

function build(
  opts: { counts?: Counts; deceased?: boolean; missing?: boolean; orgOnly?: boolean } = {},
) {
  const { counts = {}, deceased = false, missing = false, orgOnly = false } = opts;
  const n = (k: keyof Counts): number => counts[k] ?? 0;

  const record = vi.fn().mockResolvedValue(undefined);
  const deleted: string[] = [];
  const del = (name: string) =>
    vi.fn().mockImplementation(() => {
      deleted.push(name);
      return Promise.resolve({});
    });

  const tx = {
    graveUsageRight: { deleteMany: del('graveUsageRight') },
    graveHold: { deleteMany: del('graveHold') },
    familyRelationship: { deleteMany: del('familyRelationship') },
    personPhone: { deleteMany: del('personPhone') },
    personAddress: { deleteMany: del('personAddress') },
    personEducation: { deleteMany: del('personEducation') },
    personBankAccount: { deleteMany: del('personBankAccount') },
    deceasedPerson: { delete: del('deceasedPerson') },
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
    graveUsageRight: { count: vi.fn().mockResolvedValue(n('rights')) },
    graveHold: { count: vi.fn().mockResolvedValue(n('holds')) },
    burialRecord: {
      count: vi
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            'ownerCustomerId' in args.where ? n('ownerBurials') : n('burialsAsDeceased'),
          ),
        ),
    },
    cardPrintLog: { count: vi.fn().mockResolvedValue(n('cards')) },
    serviceSubscription: { count: vi.fn().mockResolvedValue(n('subscriptions')) },
    contractParty: { count: vi.fn().mockResolvedValue(n('parties')) },
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
  );
  return { svc, record, deleted, tx, prisma };
}

/* Sáu bảng trỏ tới khách hàng bằng id LỎNG — chỉ `grave_holds` có khoá ngoại. Nghĩa là
 * CSDL sẽ vui vẻ để lại con trỏ treo nếu service không tự đếm. Nhóm test này neo từng chỗ
 * đếm đó lại; thiếu một chỗ là xoá xong mới phát hiện, mà lúc đó dữ liệu đã đi rồi.
 */
describe('xoá khách hàng — chặn khi đã phát sinh nghiệp vụ', () => {
  it.each([
    ['đang đứng tên phần mộ', { rights: 1 }, /đang đứng tên 1 phần mộ/],
    ['có phiếu giữ chỗ', { holds: 2 }, /2 phiếu giữ chỗ/],
    ['là chủ mộ trong hồ sơ an táng', { ownerBurials: 1 }, /chủ mộ trong 1 hồ sơ an táng/],
    ['đã được an táng', { burialsAsDeceased: 1 }, /đã được an táng/],
    ['đã cấp thẻ mộ', { cards: 3 }, /3 lần cấp thẻ mộ/],
    ['đã đăng ký dịch vụ', { subscriptions: 1 }, /1 dịch vụ đã đăng ký/],
    ['là bên trong hợp đồng', { parties: 1 }, /bên trong 1 hợp đồng/],
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
      /đang đứng tên 1 phần mộ.*2 lần cấp thẻ mộ.*bên trong 1 hợp đồng/,
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

    expect(deleted).toEqual(['graveUsageRight', 'graveHold', 'customer']);
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
