import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

const CUSTOMER = 'cus-1';
const PERSON = 'p1';
const COMPANY_A = 'cty-A';
const COMPANY_B = 'cty-B';

/* Người gọi dùng cho mọi test xoá: mã quyền đi KÈM người, vì phạm vi tính THEO MÃ. Truyền
 * mỗi `userId` là hỏi phạm vi trên một câu khác câu đang chạy. */
const CALLER: Caller = { userId: 'u1', permission: 'crm.customer.delete' };

/* Phạm vi tính THEO MÃ, nên mỗi đường một người gọi mang đúng mã của đường đó. Dùng chung
 * một `CALLER` cho cả tạo/sửa/xoá là hỏi phạm vi trên một câu khác câu đang chạy — đúng lớp
 * lỗi mà `Caller` sinh ra để dẹp, chỉ khác là lần này nó nằm trong chính test. */
const CALLER_CREATE: Caller = { userId: 'u1', permission: 'crm.customer.create' };
const CALLER_UPDATE: Caller = { userId: 'u1', permission: 'crm.customer.update' };

/* `approvals` và `cardFees` từng THIẾU ở đây trong khi `build()` đã gọi `n('approvals')` và
 * `n('cardFees')` — một lỗi kiểu THẬT (TS2345) nằm im vì `tsconfig.json` loại `*.spec.ts`
 * khỏi `include`. Nằm im nghĩa là hai rào chắn đó không test nào đặt được số lớn hơn 0. */
type Counts = Partial<{
  rights: number;
  holds: number;
  ownerBurials: number;
  cards: number;
  cardFees: number;
  approvals: number;
  subscriptions: number;
  parties: number;
  burialsAsDeceased: number;
  relationships: number;
  transactions: number;
}>;

function build(
  opts: {
    counts?: Counts;
    deceased?: boolean;
    missing?: boolean;
    orgOnly?: boolean;
    /** Công ty của hồ sơ khách. `null` = chưa gán — cột này CHO PHÉP NULL; `''` = ô bỏ
     * trống lưu thành chuỗi rỗng, tới được vì DTO không có `@IsNotEmpty` và CSDL không có
     * CHECK. Hai giá trị, MỘT sự thật: không quy được hồ sơ về công ty nào. */
    companyId?: string | null;
    /** Công ty người gọi với tới được. `null` = mức GROUP, không bị chặn ở đâu. */
    allowedCompanies?: string[] | null;
    /** Công ty CÓ THẬT trong `org.companies`. Id ngoài danh sách này là công ty không tồn tại. */
    knownCompanies?: string[];
  } = {},
) {
  const {
    counts = {},
    deceased = false,
    missing = false,
    orgOnly = false,
    companyId = COMPANY_A,
    allowedCompanies = null,
    knownCompanies = [COMPANY_A, COMPANY_B],
  } = opts;
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
    /* Hồ sơ trình duyệt ĐÃ QUYẾT — xoá theo. Hồ sơ ĐANG CHỜ thì CHẶN, và phép chặn đó nằm ở
     * `count` bên dưới chứ không ở đây. */
    cardIssueApproval: { deleteMany: del('cardIssueApproval') },
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

  /* Dòng khách hàng đã GHI ra (đường TẠO). Giữ riêng khỏi `deleted`: một phép chặn ở đường
   * tạo phải chứng minh được là KHÔNG có dòng nào ra đời, chứ không chỉ là ném ngoại lệ. */
  const created: Record<string, unknown>[] = [];

  const prisma = {
    customer: {
      findUnique: vi.fn().mockResolvedValue(
        missing
          ? null
          : {
              id: CUSTOMER,
              customerCode: 'KH-0001',
              companyId,
              orgName: orgOnly ? 'Công ty X' : null,
              personId: orgOnly ? null : PERSON,
              person: orgOnly ? null : { id: PERSON, fullName: 'Nguyễn Văn A' },
            },
      ),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ ...args.data, customerCode: 'KH-0002' });
      }),
      // `findDuplicates` hỏi bảng này khi có điện thoại/email; không trùng ai thì rỗng.
      findMany: vi.fn().mockResolvedValue([]),
    },
    /* Danh mục CÔNG TY (`org.companies`). Trả `null` cho id ngoài `knownCompanies` — công ty
     * đích phải TỒN TẠI, và một mock trả cứng một đối tượng thì phép kiểm đó vô hình. */
    company: {
      findUnique: vi
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(knownCompanies.includes(args.where.id) ? { id: args.where.id } : null),
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
    /* Hồ sơ xin cấp thẻ ĐANG CHỜ duyệt — chặn xoá. Người ký đang được yêu cầu quyết một việc
     * về khách này; xoá lúc đó để lại một dòng trong hộp thư không mở được. */
    cardIssueApproval: { count: vi.fn().mockResolvedValue(n('approvals')) },
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
    person: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: PERSON, fullName: 'Nguyễn Văn A' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  /* Bản nhại `ScopeService.assertCompanyFor` — CHÉP ĐÚNG THỨ TỰ bản thật, không tóm tắt:
   * `loadFor` (`scope.service.ts:133-142`) chạy TRƯỚC, rồi `checkCompany` (`:92-108`).
   *
   * Nhại RỘNG TAY hơn bản thật thì test xanh trên một hàng rào không tồn tại. Nhại CHẶT TAY
   * hơn bản thật còn tệ hơn: nó dựng ra một hàng rào chỉ sống trong test, và cái lỗ bản thật
   * đang có thì không test nào nhìn thấy. Bản cũ ở đây chặt tay đúng một chỗ — nó chặn công
   * ty đích RỖNG ở mọi mức, trong khi bản thật thoát ngay ở `level === 'GROUP'` TRƯỚC khi
   * hỏi `isBlank`. Bốn nhánh dưới đây theo đúng thứ tự bản thật:
   *
   *   1. `userId === null`         -> "Chưa xác thực" (loadFor, dòng đầu).
   *   2. mã quyền rỗng/thiếu       -> từ chối (loadFor). Phạm vi tính THEO MÃ.
   *   3. `level === 'GROUP'`       -> CHO QUA, KỂ CẢ khi công ty đích rỗng. Đây chính là chỗ
   *      service KHÔNG được phép dựa vào: quy hồ sơ về một công ty là việc của service.
   *   4. mức COMPANY + đích rỗng   -> "Phải chỉ rõ công ty…", câu nói về TRUY VẤN DANH SÁCH
   *      chứ không nói gì về hồ sơ đang bị xoá. Nhại đúng câu để test thấy người dùng thật
   *      sự nhận được câu gì.
   */
  const assertCompanyFor = vi.fn(
    (userId: string | null, code: string | null | undefined, target: string | null | undefined) => {
      if (userId === null) {
        return Promise.reject(new ForbiddenException('Chưa xác thực'));
      }
      if (code === null || code === undefined || code === '') {
        return Promise.reject(
          new ForbiddenException(
            'Không xác định được mã quyền đang thi hành — không kiểm được phạm vi',
          ),
        );
      }
      if (allowedCompanies === null) {
        return Promise.resolve();
      }
      if (target === null || target === undefined || target === '') {
        return Promise.reject(
          new ForbiddenException(
            'Phải chỉ rõ công ty: chỉ phạm vi toàn tập đoàn mới được truy vấn không giới hạn',
          ),
        );
      }
      if (!allowedCompanies.includes(target)) {
        return Promise.reject(
          new ForbiddenException('Ngoài phạm vi được gán: công ty này không thuộc quyền của bạn'),
        );
      }
      return Promise.resolve();
    },
  );

  /* `visibleCompanyIdsFor` nhại theo `scope.service.ts:73-79`: `null` nghĩa là KHÔNG bó —
   * tức mức GROUP. Đây là cách DUY NHẤT hỏi được "người này có bị bó không" mà không cần một
   * công ty đích, và đường sửa cần đúng câu đó cho hồ sơ CHƯA GẮN công ty: `assertCompanyFor`
   * thoát ngay ở nhánh GROUP nên nó không bao giờ trả lời được câu này. */
  const visibleCompanyIdsFor = vi.fn(
    (userId: string | null, code: string | null | undefined): Promise<string[] | null> => {
      if (userId === null) {
        return Promise.reject(new ForbiddenException('Chưa xác thực'));
      }
      if (code === null || code === undefined || code === '') {
        return Promise.reject(
          new ForbiddenException(
            'Không xác định được mã quyền đang thi hành — không kiểm được phạm vi',
          ),
        );
      }
      return Promise.resolve(allowedCompanies);
    },
  );

  const svc = new CustomersService(
    prisma,
    {
      hash: () => 'h',
      mask: () => '079***123',
      encrypt: () => 'c',
    } as unknown as PiiService,
    { record } as unknown as AuditService,
    { assertCompanyFor, visibleCompanyIdsFor } as unknown as ScopeService,
  );
  return { svc, record, deleted, created, detached, tx, prisma, assertCompanyFor };
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

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(pattern);
    expect(deleted).toEqual([]);
  });

  /* Câu từ chối phải nêu ĐỦ mọi thứ đang chặn. Nêu một cái rồi bắt người dùng dọn xong
   * quay lại nhận cái thứ hai là bắt họ đoán còn bao nhiêu vòng nữa. */
  it('nhiều thứ chặn cùng lúc thì liệt kê ĐỦ, không dừng ở cái đầu tiên', async () => {
    const { svc } = build({ counts: { rights: 1, cards: 2, parties: 1 } });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(
      /đang đứng tên 1 phần mộ \(A-01\).*bên trong 1 hợp đồng đang hiệu lực \(HD1\).*được cấp 2 thẻ quản lý mộ/s,
    );
  });

  it('mọi trường hợp chặn đều là 409, không phải 500', async () => {
    const { svc } = build({ counts: { rights: 1 } });
    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ConflictException);
  });

  it('không tìm thấy khách hàng thì 404', async () => {
    const { svc } = build({ missing: true });
    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(NotFoundException);
  });
});

/* ===================== PHẠM VI CÔNG TY =====================
 *
 * Tới 09/09/2026 đường này KHÔNG kiểm phạm vi một dòng nào: controller không nhận `@Req`,
 * service xoá theo id. Gate `crm.customer.delete` trả lời "có được xoá khách hàng không",
 * nó KHÔNG trả lời "xoá được khách hàng NÀO" — nên người ở công ty A xoá HẲN khách của công
 * ty B, và chiều đó không đảo ngược được.
 *
 * Ba câu hỏi, ba test: khác công ty thì chặn · cùng công ty thì chạy · CHƯA GÁN công ty thì
 * chặn. Câu thứ ba là câu dễ làm hỏng nhất: `Customer.companyId` CHO PHÉP NULL, nên viết
 * "có công ty thì kiểm, null thì cho qua" là biến mọi hồ sơ bỏ trống ô công ty thành cửa mở
 * — mà ô đó ai tạo khách cũng bỏ trống được.
 */
describe('xoá khách hàng — bó theo công ty của chính hồ sơ', () => {
  it('người mức COMPANY ở công ty A KHÔNG xoá được khách của công ty B', async () => {
    const { svc, deleted } = build({ companyId: COMPANY_B, allowedCompanies: [COMPANY_A] });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ForbiddenException);
    // Chặn TRƯỚC khi động vào dữ liệu, không phải chặn sau khi đã xoá xong một nửa.
    expect(deleted).toEqual([]);
  });

  it('cùng công ty thì vẫn xoá được — bó phạm vi không được chặn việc thật', async () => {
    const { svc, deleted } = build({ companyId: COMPANY_A, allowedCompanies: [COMPANY_A] });

    await svc.deleteCustomer(CUSTOMER, CALLER);

    expect(deleted).toContain('customer');
  });

  /* Hỏi phạm vi theo ĐÚNG MÃ QUYỀN đang thi hành, và theo công ty của BẢN GHI. Hai thứ này
   * đều có thể lệch trong im lặng: gõ tay một mã khác thì phạm vi tính theo mã không chạy,
   * còn lấy công ty từ nơi khác bản ghi thì người gọi tự chọn phạm vi của mình. */
  it('hỏi phạm vi theo mã quyền đang chạy và theo công ty của BẢN GHI', async () => {
    const { svc, assertCompanyFor } = build({
      companyId: COMPANY_B,
      allowedCompanies: [COMPANY_A],
    });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ForbiddenException);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.customer.delete', COMPANY_B);
  });

  /* HỒ SƠ CHƯA GÁN CÔNG TY — TỪ CHỐI, kể cả người mức GROUP.
   *
   * Không có công ty thì không quy được hồ sơ này về phạm vi nào, và đây là chiều KHÔNG ĐẢO
   * NGƯỢC. Cùng nếp với `assertPersonInScope` ở đường đọc CCCD: quy không ra neo thì chặn,
   * không phải cho qua. Người mức GROUP cũng chặn — `assertCompanyFor` thoát ngay ở dòng
   * đầu cho GROUP, nên nếu chỉ dựa vào nó thì hồ sơ trống ô công ty lại xoá được bởi đúng
   * những người đang cầm mã `crm.customer.delete` hôm nay.
   */
  it.each([
    ['mức COMPANY', [COMPANY_A] as string[] | null],
    ['mức GROUP', null as string[] | null],
  ])('khách CHƯA GÁN công ty thì %s cũng bị từ chối, kèm lý do tiếng Việt', async (_l, allowed) => {
    const { svc, deleted } = build({ companyId: null, allowedCompanies: allowed });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(
      /chưa được gắn công ty nên không xác định được phạm vi/,
    );
    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ForbiddenException);
    expect(deleted).toEqual([]);
  });

  /* Ô CÔNG TY BỎ TRỐNG THÀNH CHUỖI RỖNG — cùng một sự thật với `null`, và tới được THẬT:
   * DTO chỉ `@IsOptional() @IsString()` (KHÔNG `@IsNotEmpty`, `customers.dto.ts:85` và
   * `:214`), `createCustomer` ghi thẳng `dto.companyId ?? null` nên `''` được lưu nguyên
   * chữ rỗng, và bảng `customers` không có một CHECK nào trên `company_id` (đếm ở CSDL
   * 09/09/2026: 0 dòng). Nghĩa là hàng rào duy nhất đứng giữa là câu điều kiện trong
   * service này.
   *
   * Mức GROUP là ca chí mạng, không phải ca phụ: `assertCompanyFor` thoát NGAY ở nhánh
   * GROUP TRƯỚC khi hỏi công ty đích có rỗng không, nên hồ sơ rỗng ô công ty rơi thẳng
   * xuống lệnh xoá — chiều KHÔNG ĐẢO NGƯỢC. Mức COMPANY thì có bị chặn, nhưng chặn bởi
   * câu "Phải chỉ rõ công ty…" nói về truy vấn danh sách, không nói gì về hồ sơ đang xoá.
   * Cả hai mức phải nhận cùng MỘT lý do, và là lý do của chính đường xoá này.
   */
  it.each([
    ['mức COMPANY', [COMPANY_A] as string[] | null],
    ['mức GROUP', null as string[] | null],
  ])(
    'ô công ty là CHUỖI RỖNG thì %s cũng bị từ chối, cùng lý do với chưa gán',
    async (_l, allowed) => {
      const { svc, deleted } = build({ companyId: '', allowedCompanies: allowed });

      await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(
        /chưa được gắn công ty nên không xác định được phạm vi/,
      );
      await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ForbiddenException);
      expect(deleted).toEqual([]);
    },
  );

  /* TOÀN KHOẢNG TRẮNG cũng là trống — thêm 10/09/2026, sau khi một lượt soi độc lập chỉ ra
   * `notBlank` chỉ so `!== ''` nên `'   '` lọt qua.
   *
   * Ca này KHÔNG trùng ca chuỗi rỗng ở trên: `''` bị chặn bởi phép so cũ, còn `'   '` thì
   * không — nó đi thẳng xuống `assertCompanyFor`, nơi người mức GROUP đi qua tuốt, và hồ sơ
   * bị XOÁ HẲN. `@Transform(trim)` ở DTO không đỡ được ca này vì dòng dữ liệu đã nằm sẵn
   * trong CSDL: cột `company_id` vẫn NULLABLE và không có CHECK nào.
   *
   * Mức GROUP là ca chí mạng, nên nó phải có mặt ở đây chứ không chỉ mức COMPANY. */
  it.each([
    ['mức COMPANY', [COMPANY_A] as string[] | null],
    ['mức GROUP', null as string[] | null],
  ])('ô công ty TOÀN KHOẢNG TRẮNG thì %s cũng bị từ chối', async (_l, allowed) => {
    const { svc, deleted } = build({ companyId: '   ', allowedCompanies: allowed });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(
      /chưa được gắn công ty nên không xác định được phạm vi/,
    );
    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(ForbiddenException);
    expect(deleted).toEqual([]);
  });

  /* MỘT PHÉP CHẶN PHẢI CHỈ SANG MỘT LỐI CÓ THẬT.
   *
   * Tới 09/09/2026 câu từ chối bảo "gán công ty cho hồ sơ trước khi xoá" trong khi KHÔNG có
   * đường nào gán được: `UpdateCustomerDto` không khai `companyId`, và `updateCustomer` chỉ
   * ghi type/orgName/phone/email. Người đọc đi tìm một cái ô không tồn tại rồi kết luận là
   * hệ báo sai. Lượt này mở đường đó ra, nên câu phải chỉ đúng chỗ đi. */
  it('lời từ chối chỉ sang lối CÓ THẬT: màn Hồ sơ khách hàng, nút Sửa', async () => {
    const { svc } = build({ companyId: null, allowedCompanies: null });

    await expect(svc.deleteCustomer(CUSTOMER, CALLER)).rejects.toThrow(
      /Hồ sơ khách hàng[\s\S]*Sửa/,
    );
  });
});

describe('xoá khách hàng — khi sạch thì dọn hết, không để lại mảnh', () => {
  it('xoá cả bảng phụ, quan hệ, hồ sơ khách và nhân thân', async () => {
    const { svc, deleted } = build({ deceased: true });

    await svc.deleteCustomer(CUSTOMER, CALLER);

    expect(deleted).toEqual([
      /* Dòng lịch sử (quyền đã thu hồi, phiếu đã hết hạn) không CHẶN xoá nhưng phải đi
         cùng — để lại thì thành con trỏ treo, vì hai bảng đó không có khoá ngoại. */
      'graveUsageRight',
      'graveHold',
      'customerTag',
      'cardIssueApproval',
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

    await svc.deleteCustomer(CUSTOMER, CALLER);

    expect(deleted).toContain('person');
  });

  it('khách tổ chức không có nhân thân thì chỉ xoá hồ sơ khách', async () => {
    const { svc, deleted } = build({ orgOnly: true });

    await svc.deleteCustomer(CUSTOMER, CALLER);

    expect(deleted).toEqual([
      'graveUsageRight',
      'graveHold',
      'customerTag',
      'cardIssueApproval',
      'customer',
    ]);
  });

  /* Xoá người này rút họ khỏi cây gia đình của người kia. Nói ra con số thay vì lặng lẽ
   * xoá — người bấm nút cần biết mình vừa động vào hồ sơ của ai nữa. */
  it('báo số quan hệ đã xoá theo', async () => {
    const { svc, record } = build({ counts: { relationships: 3 } });

    const res = await svc.deleteCustomer(CUSTOMER, CALLER);

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

    await svc.deleteCustomer(CUSTOMER, CALLER);

    expect(deleted).toContain('burialRecord');
    expect(deleted.indexOf('burialRecord')).toBeLessThan(deleted.indexOf('deceasedPerson'));
  });

  /* Hồ sơ an táng đã huỷ của NGƯỜI KHÁC, mà khách đang bị xoá từng là chủ mộ: dòng đó
   * KHÔNG phải của họ, nên gỡ con trỏ chứ không xoá. Xoá là xoá lịch sử của người khác;
   * để nguyên là để lại con trỏ treo (cột này không có khoá ngoại). */
  it('con trỏ chủ mộ trên hồ sơ của NGƯỜI KHÁC bị GỠ, không bị xoá', async () => {
    const { svc, deleted, detached } = build();

    await svc.deleteCustomer(CUSTOMER, CALLER);

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

    const res = await svc.deleteCustomer(CUSTOMER, CALLER);

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

    await svc.updateCustomer(CUSTOMER, { person: { nationalId: '079123456789' } }, CALLER_UPDATE);

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

    await svc.updateCustomer(CUSTOMER, { person: { religion: '' } }, CALLER_UPDATE);

    expect(tx.person.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ religion: null }) }),
    );
  });

  it('không gửi trường nào thì không đụng tới nhân thân', async () => {
    const { svc, tx } = build();

    await svc.updateCustomer(CUSTOMER, { phone: '0900000000' }, CALLER_UPDATE);

    expect(tx.person.update).not.toHaveBeenCalled();
  });

  /* Audit ghi TÊN trường đã đổi, KHÔNG ghi giá trị: nhật ký đọc được bằng mã quyền khác
   * với mã mở khoá CCCD, chép giá trị vào đó là mở cửa sau vòng qua lớp che. */
  it('audit ghi tên trường đã đổi, KHÔNG ghi giá trị CCCD', async () => {
    const { svc, record } = build();

    await svc.updateCustomer(CUSTOMER, { person: { nationalId: '079123456789' } }, CALLER_UPDATE);

    const call = record.mock.calls[0]?.[0] as { afterData: Record<string, unknown> };
    expect(call.afterData.changedPersonFields).toContain('nationalIdHash');
    expect(JSON.stringify(call.afterData)).not.toContain('079123456789');
  });

  it('sửa nhân thân của khách TỔ CHỨC thì báo lỗi rõ ràng', async () => {
    const { svc } = build({ orgOnly: true });

    await expect(
      svc.updateCustomer(CUSTOMER, { person: { fullName: 'X' } }, CALLER_UPDATE),
    ).rejects.toThrow(/tổ chức/);
  });

  it('không tìm thấy khách hàng thì 404', async () => {
    const { svc } = build({ missing: true });
    await expect(svc.updateCustomer(CUSTOMER, { phone: '1' }, CALLER_UPDATE)).rejects.toThrow(
      NotFoundException,
    );
  });
});

/* ===================== TẠO KHÁCH: CÔNG TY LÀ BẮT BUỘC =====================
 *
 * QUYẾT ĐỊNH CỦA ANH BÁCH, 09/09/2026: bắt buộc chọn công ty khi TẠO khách, và mở đường SỬA
 * công ty về sau. Ép ở DTO + SERVICE + MÀN HÌNH, KHÔNG đụng tới cột — quyết định 27/08/2026
 * GIỮ `cemetery.customers.company_id` cho phép NULL ở tầng CSDL vẫn nguyên. Hai quyết định
 * không đá nhau: cột vẫn nhận NULL cho 0 dòng lịch sử, nhưng không đường ghi nào sinh thêm.
 *
 * Và bắt buộc thôi CHƯA ĐỦ. Một ô công ty bắt buộc mà không kiểm phạm vi là mời người ở công
 * ty A gõ id công ty B vào — hồ sơ ra đời ngay trong nhà người khác, và kể từ giây đó mọi
 * hàng rào bó theo `companyId` đều tính nó là của B.
 */
describe('tạo khách hàng — công ty bắt buộc và phải trong phạm vi', () => {
  it('tạo khách cho công ty NGOÀI phạm vi thì 403, và KHÔNG có dòng nào ra đời', async () => {
    const { svc, created } = build({ allowedCompanies: [COMPANY_A] });

    await expect(
      svc.createCustomer(
        { type: 'ORGANIZATION', orgName: 'Cty X', companyId: COMPANY_B },
        CALLER_CREATE,
      ),
    ).rejects.toThrow(ForbiddenException);

    // Chặn TRƯỚC khi ghi. Chặn sau khi đã ghi thì hồ sơ vẫn nằm trong nhà người khác.
    expect(created).toEqual([]);
  });

  it('hỏi phạm vi theo ĐÚNG mã quyền đang chạy và theo công ty TRONG payload', async () => {
    const { svc, assertCompanyFor } = build({ allowedCompanies: [COMPANY_A] });

    await expect(
      svc.createCustomer(
        { type: 'ORGANIZATION', orgName: 'Cty X', companyId: COMPANY_B },
        CALLER_CREATE,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.customer.create', COMPANY_B);
  });

  /* Công ty đích phải TỒN TẠI. Người mức GROUP đi qua `assertCompanyFor` không vướng gì, nên
   * nếu không tra danh mục thì một id gõ sai sẽ tạo ra hồ sơ neo vào một công ty ma — và hồ
   * sơ đó vô hình với MỌI màn hình bó theo công ty, kể cả với chính người vừa tạo nó. */
  it('công ty KHÔNG TỒN TẠI thì từ chối kèm câu tiếng Việt, không ghi dòng nào', async () => {
    const { svc, created } = build({ allowedCompanies: null });

    await expect(
      svc.createCustomer(
        { type: 'ORGANIZATION', orgName: 'Cty X', companyId: 'cty-ma' },
        CALLER_CREATE,
      ),
    ).rejects.toThrow(/[Kk]hông tìm thấy công ty/);
    expect(created).toEqual([]);
  });

  it('trong phạm vi thì ghi ĐÚNG công ty, không ghi null', async () => {
    const { svc, created } = build({ allowedCompanies: [COMPANY_A] });

    await svc.createCustomer(
      { type: 'ORGANIZATION', orgName: 'Cty X', companyId: COMPANY_A },
      CALLER_CREATE,
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.companyId).toBe(COMPANY_A);
  });
});

/* ===================== ĐỔI CÔNG TY = CHUYỂN HỒ SƠ SANG NHÀ KHÁC =====================
 *
 * HAI ĐẦU, không một. Phải hỏi phạm vi trên công ty HIỆN TẠI của bản ghi (được động vào hồ
 * sơ này không) VÀ trên công ty ĐÍCH (được đặt nó vào đó không).
 *
 * Thiếu vế ĐẦU: người ở công ty B kéo hồ sơ của công ty A về mình — họ với tới đích (B là
 * của họ), và không ai hỏi họ có được đụng vào hồ sơ đang nằm ở A hay không.
 * Thiếu vế SAU: người ở công ty A đẩy hồ sơ của mình sang B — mất luôn khỏi tầm nhìn của
 * chính công ty A, và không ai ở B yêu cầu điều đó.
 *
 * Cả hai chiều đều là mất quyền kiểm soát một hồ sơ, chỉ khác ai là người mất.
 */
describe('sửa khách hàng — đổi công ty phải bó CẢ HAI đầu', () => {
  it('không với tới công ty ĐÍCH thì 403, và không ghi gì', async () => {
    const { svc, tx } = build({ companyId: COMPANY_A, allowedCompanies: [COMPANY_A] });

    await expect(
      svc.updateCustomer(CUSTOMER, { companyId: COMPANY_B }, CALLER_UPDATE),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('không với tới công ty HIỆN TẠI thì 403, dù đích nằm trong phạm vi', async () => {
    const { svc, tx } = build({ companyId: COMPANY_A, allowedCompanies: [COMPANY_B] });

    await expect(
      svc.updateCustomer(CUSTOMER, { companyId: COMPANY_B }, CALLER_UPDATE),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('hỏi phạm vi trên CẢ HAI công ty, bằng đúng mã quyền đang chạy', async () => {
    const { svc, assertCompanyFor } = build({
      companyId: COMPANY_A,
      allowedCompanies: [COMPANY_A, COMPANY_B],
    });

    await svc.updateCustomer(CUSTOMER, { companyId: COMPANY_B }, CALLER_UPDATE);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.customer.update', COMPANY_A);
    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.customer.update', COMPANY_B);
  });

  it('với tới cả hai đầu thì ghi cột công ty và có dòng audit RIÊNG kèm before/after', async () => {
    const { svc, tx, record } = build({
      companyId: COMPANY_A,
      allowedCompanies: [COMPANY_A, COMPANY_B],
    });

    await svc.updateCustomer(CUSTOMER, { companyId: COMPANY_B }, CALLER_UPDATE);

    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_B }) }),
    );
    /* Dòng audit RIÊNG, không lẫn vào `CUSTOMER.UPDATED`. `CUSTOMER.UPDATED` chỉ ghi TÊN
     * trường đã đổi — đọc lại nó chỉ biết "công ty có đổi", không biết đổi TỪ đâu SANG đâu,
     * mà đúng hai giá trị đó mới là thứ cần để lần lại một hồ sơ đi lạc. */
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER.COMPANY_CHANGED',
        entityType: 'customer',
        entityId: CUSTOMER,
        beforeData: expect.objectContaining({ companyId: COMPANY_A }),
        afterData: expect.objectContaining({ companyId: COMPANY_B }),
      }),
    );
  });

  it('đổi sang công ty KHÔNG TỒN TẠI thì từ chối, không ghi gì', async () => {
    const { svc, tx } = build({ companyId: COMPANY_A, allowedCompanies: null });

    await expect(
      svc.updateCustomer(CUSTOMER, { companyId: 'cty-ma' }, CALLER_UPDATE),
    ).rejects.toThrow(/[Kk]hông tìm thấy công ty/);

    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  /* Ô công ty ở màn SỬA KHÔNG theo nếp "rỗng = xoá giá trị" của các trường khác trong cùng
   * DTO. Rỗng ở đây là dựng lại đúng hồ sơ mồ côi mà lượt này sinh ra để dẹp — và người mức
   * GROUP thì `assertCompanyFor` cho qua tuốt, nên không có hàng rào nào phía sau. */
  it('gửi công ty là CHUỖI RỖNG thì 400, không gỡ công ty của hồ sơ ra', async () => {
    const { svc, tx } = build({ companyId: COMPANY_A, allowedCompanies: null });

    await expect(svc.updateCustomer(CUSTOMER, { companyId: '' }, CALLER_UPDATE)).rejects.toThrow(
      BadRequestException,
    );

    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('KHÔNG gửi companyId thì không đụng cột công ty và không ghi audit đổi công ty', async () => {
    const { svc, tx, record } = build({ companyId: COMPANY_A, allowedCompanies: [COMPANY_A] });

    await svc.updateCustomer(CUSTOMER, { phone: '0900000000' }, CALLER_UPDATE);

    const data = (tx.customer.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('companyId');
    expect(record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER.COMPANY_CHANGED' }),
    );
  });

  /* HỒ SƠ CHƯA GẮN CÔNG TY — đây là ca mà cả lượt này sinh ra để chữa được, nên nó phải GÁN
   * ĐƯỢC, không phải bị chặn cứng. Nhưng gán cho ai thì phải hỏi: không có công ty hiện tại
   * thì không quy được hồ sơ về phạm vi nào, nên chỉ người KHÔNG bị bó (mức GROUP) mới nhận
   * nó về được. Người mức COMPANY nhận nó về là tự cấp cho mình một hồ sơ chưa từng thuộc
   * về ai — cùng lớp lỗi với "thiếu vế đầu" ở trên, chỉ khác là vế đầu trống. */
  it('hồ sơ CHƯA GẮN công ty: mức GROUP gán được', async () => {
    const { svc, tx } = build({ companyId: null, allowedCompanies: null });

    await svc.updateCustomer(CUSTOMER, { companyId: COMPANY_A }, CALLER_UPDATE);

    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_A }) }),
    );
  });

  it.each([
    ['chưa gán (NULL)', null as string | null],
    ['ô bỏ trống (chuỗi rỗng)', '' as string | null],
  ])('hồ sơ %s: mức COMPANY bị từ chối, kèm lý do tiếng Việt', async (_l, current) => {
    const { svc, tx } = build({ companyId: current, allowedCompanies: [COMPANY_A] });

    await expect(
      svc.updateCustomer(CUSTOMER, { companyId: COMPANY_A }, CALLER_UPDATE),
    ).rejects.toThrow(/chưa được gắn công ty/);
    await expect(
      svc.updateCustomer(CUSTOMER, { companyId: COMPANY_A }, CALLER_UPDATE),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.customer.update).not.toHaveBeenCalled();
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

    await svc.deleteCustomer(CUSTOMER, CALLER);

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

    await svc.deleteCustomer(CUSTOMER, CALLER);

    const call = (prisma as unknown as { graveHold: { count: ReturnType<typeof vi.fn> } }).graveHold
      .count.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.status).toBe('Active');
    // Lọc theo NGÀY HẾT HẠN, không chỉ theo trạng thái.
    expect(call.where.expiresAt).toBeDefined();
  });

  it('hồ sơ an táng đã HUỶ thì không chặn xoá', async () => {
    const { svc, prisma } = build();

    await svc.deleteCustomer(CUSTOMER, CALLER);

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

    const res = await svc.deleteCustomer(CUSTOMER, CALLER);

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
