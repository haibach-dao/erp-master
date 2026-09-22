import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* GẮN MỘT NHÂN THÂN CÓ SẴN VÀO KHÁCH HÀNG MỚI — ai được phép?
 *
 * `createCustomer` kiểm phạm vi trên `dto.companyId` (công ty của hồ sơ SẮP TẠO) nhưng tới
 * 16/09/2026 không kiểm gì trên `dto.personId`. Hai trường đó trả lời hai câu khác nhau:
 * "hồ sơ này thuộc nhà ai" và "nhân thân này vốn là người của nhà ai".
 *
 * VÌ SAO NGUY HIỂM: `Customer` chính là NEO mà `assertPersonInScope` tin để quyết ai được mở
 * CCCD đầy đủ. Gắn được một nhân thân của công ty B vào một khách hàng của công ty A là tự
 * cấp cho mình cái neo đó — từ giây sau, `revealNationalId` quy nhân thân ấy về công ty A và
 * cho qua. Không phải leo thang QUYỀN: mã `crm.person.view_sensitive` vẫn cần. Nhưng là leo
 * thang PHẠM VI, và phạm vi mới là thứ ngăn người công ty A đọc dữ liệu cá nhân của người
 * công ty B.
 *
 * `Customer.personId` là `@unique`, nên nhân thân ĐÃ có khách hàng thì không gắn thêm được —
 * nhưng nó vướng ở ràng buộc CSDL, tức một P2002 nói về chỉ mục, không phải một câu 403 nói
 * về phạm vi. Nhân thân đã có HỒ SƠ AN TÁNG mà chưa có khách hàng thì không vướng gì cả, và
 * đó đúng là hình dạng của người đã mất — nhóm mà dữ liệu cá nhân vẫn được luật bảo vệ, và
 * là nhóm đông nhất trong một hệ nghĩa trang.
 */

const PERSON = 'per-1';
const CO_A = 'cty-A';
const CO_B = 'cty-B';
const SITE_A = 'nt-A';
const SITE_B = 'nt-B';

const CALLER_CREATE: Caller = { userId: 'u1', permission: 'crm.customer.create' };

function build(opts: {
  /** Neo sẵn có của nhân thân: chỗ mà hệ quy được nó về một công ty/nghĩa trang. */
  anchor: 'none' | 'customer-B' | 'burial-B' | 'burial-A';
  /** Công ty người gọi với tới. `null` = mức GROUP. */
  allowedCompanies?: string[] | null;
  /** Nghĩa trang người gọi phụ trách. `null` = không bị bó theo nghĩa trang. */
  allowedSites?: string[] | null;
}) {
  const { anchor, allowedCompanies = [CO_A], allowedSites = null } = opts;

  const created: Record<string, unknown>[] = [];

  const prisma = {
    customer: {
      /* ĐỌC `where` thật. Trả cứng thì hỏi SAI CỘT vẫn xanh: nếu `checkPersonAnchor` hỏi
       * `{ id: personId }` thay vì `{ personId }` thì bước 1 không bao giờ khớp, không nổ, chỉ
       * lặng lẽ trả `null` — neo rơi sang bước 2 (hồ sơ an táng) và người của công ty khác qua
       * cửa, rồi `revealNationalId` mở CCCD. Cùng bẫy mà khối chú thích ngay dưới đã nêu. */
      findUnique: vi.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
        const w = args.where ?? {};
        if (w.personId !== PERSON) return Promise.resolve(null);
        return Promise.resolve(anchor === 'customer-B' ? { companyId: CO_B } : null);
      }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ ...args.data, customerCode: 'KH-0002' });
      }),
    },
    company: { findUnique: vi.fn().mockResolvedValue({ id: CO_A }) },
    /* MOCK PHẢI KIỂM `where`, nếu không nó không canh được gì.
     *
     * `BurialRecord.deceasedPersonId` chứa `DeceasedPerson.id`, KHÔNG phải `Person.id` —
     * hỏi sai cột thì Prisma lặng lẽ trả `null`, không nổ. Một `mockResolvedValue` trả cùng
     * giá trị bất kể đối số sẽ XANH cho cả cách hỏi đúng lẫn cách hỏi sai, và bốn ca "neo an
     * táng" dưới đây từng xanh đúng như thế: chúng khẳng định một hành vi mà mã sản xuất
     * không hề có. Một lượt soi độc lập 16/09/2026 bắt được.
     *
     * Nên mock chỉ trả hồ sơ khi được hỏi ĐÚNG `{ deceased: { personId } }`. Đổi về
     * `{ deceasedPersonId: ... }` là bốn ca kia đỏ ngay. */
    burialRecord: {
      findFirst: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        const asked = (args.where as { deceased?: { personId?: string } }).deceased?.personId;
        const hasBurial = anchor === 'burial-B' || anchor === 'burial-A';
        return Promise.resolve(hasBurial && asked === PERSON ? { gravePlotId: 'plot-1' } : null);
      }),
    },
    gravePlot: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          anchor === 'burial-B'
            ? { companyId: CO_B, cemeteryId: SITE_B }
            : anchor === 'burial-A'
              ? { companyId: CO_A, cemeteryId: SITE_A }
              : null,
        ),
    },
    person: {
      create: vi
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'per-moi', ...args.data }),
        ),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  /* Mock phạm vi hành xử như bản thật: ngoài danh sách là NÉM, không phải trả rỗng. */
  const assertCompanyFor = vi.fn((_u: string | null, _c: string | null, companyId: string) => {
    if (allowedCompanies !== null && !allowedCompanies.includes(companyId)) {
      return Promise.reject(new ForbiddenException('Ngoài phạm vi được gán: công ty'));
    }
    return Promise.resolve(undefined);
  });
  /* `assertPlotFor` hỏi CẢ HAI TRỤC một lần (từ 17/09/2026), nên stub kiểm cả hai: công ty
   * trước rồi nghĩa trang, đúng thứ tự bản thật. */
  const assertPlotFor = vi.fn(
    (_u: string | null, _c: string | null, companyId: string, siteId: string) => {
      if (allowedCompanies !== null && !allowedCompanies.includes(companyId)) {
        return Promise.reject(new ForbiddenException('Ngoài phạm vi được gán: công ty'));
      }
      if (allowedSites !== null && !allowedSites.includes(siteId)) {
        return Promise.reject(new ForbiddenException('Ngoài phạm vi được gán: nghĩa trang'));
      }
      return Promise.resolve(undefined);
    },
  );

  const svc = new CustomersService(
    prisma,
    { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as PiiService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
  );
  return { svc, created, prisma, assertCompanyFor, assertPlotFor };
}

const DTO = { type: 'INDIVIDUAL', companyId: CO_A, personId: PERSON } as never;

describe('createCustomer — nhân thân có sẵn phải nằm trong phạm vi người gắn', () => {
  it('CHẶN nhân thân đang nằm ở nghĩa trang của công ty khác', async () => {
    const { svc } = build({ anchor: 'burial-B' });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chặn TRƯỚC khi ghi — không một dòng khách hàng nào ra đời', async () => {
    const { svc, created } = build({ anchor: 'burial-B' });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toEqual([]);
  });

  it('CHẶN nhân thân đã là khách hàng của công ty khác — bằng 403 nói về phạm vi, không phải P2002 nói về chỉ mục', async () => {
    const { svc } = build({ anchor: 'customer-B' });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cho qua nhân thân nằm trong CHÍNH công ty người gọi', async () => {
    const { svc, created } = build({ anchor: 'burial-A' });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
    expect(created[0]?.personId).toBe(PERSON);
  });

  /* Nhân thân CHƯA có neo nào phải gắn được: `POST /crm/persons` là endpoint thật, nên luồng
   * hai bước "tạo nhân thân trước, rồi tạo khách hàng trỏ vào" là luồng thật. Người đang gắn
   * chính là người đặt cái neo ĐẦU TIÊN — không có neo cũ nào để so, và chặn ở đây là chặn
   * một việc không ai làm sai được.
   *
   * Đây là chỗ hàm này KHÁC `assertPersonInScope`: đường ĐỌC (mở CCCD) quy không ra neo thì
   * TỪ CHỐI, vì đọc mà không biết của ai là đọc liều. Đường GHI neo đầu tiên thì cho qua. */
  it('cho qua nhân thân chưa có neo nào — luồng tạo nhân thân rồi tạo khách hàng', async () => {
    const { svc, created } = build({ anchor: 'none' });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
  });

  it('nhân thân ở đúng công ty nhưng SAI nghĩa trang vẫn bị chặn', async () => {
    const { svc } = build({ anchor: 'burial-A', allowedSites: [SITE_B] });
    await expect(svc.createCustomer(DTO, CALLER_CREATE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  /* Không phải "chặn tất cho chắc": đường tạo nhân thân MỚI (không truyền `personId`) không
   * đi qua phép kiểm này, vì chưa có nhân thân nào để hỏi phạm vi. */
  it('đường tạo nhân thân MỚI không bị phép kiểm này đụng tới', async () => {
    const { svc, created, prisma } = build({ anchor: 'burial-B' });
    const dtoMoi = {
      type: 'INDIVIDUAL',
      companyId: CO_A,
      person: { fullName: 'Nguyễn Văn A' },
    } as never;
    await expect(svc.createCustomer(dtoMoi, CALLER_CREATE)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
    expect(prisma.burialRecord.findFirst).not.toHaveBeenCalled();
  });
});
