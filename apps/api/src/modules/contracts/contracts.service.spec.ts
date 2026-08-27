import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* Caller mang theo MÃ QUYỀN đang thi hành, không chỉ userId — phạm vi được tính theo
 * TỪNG mã, nên truyền thiếu mã là kiểm phạm vi trên một câu hỏi khác câu đang chạy. */
/* `verify` và `activate` nhận HÀM chứ không phải hằng: nhóm test "người soạn không tự thẩm
 * định" chỉ có nghĩa khi truyền được hai người KHÁC nhau, nên userId phải là tham số. */
const verifier = (userId: string): Caller => ({ userId, permission: 'contract.record.verify' });
const activator = (userId: string): Caller => ({ userId, permission: 'contract.record.activate' });
const CALLER_CANCEL: Caller = { userId: 'u1', permission: 'contract.record.cancel' };
const CALLER_VIEW: Caller = { userId: 'u1', permission: 'contract.record.view' };
const CALLER_ADD_PARTY: Caller = { userId: 'u1', permission: 'contract.party.assign' };

const AUTHOR = 'user-author';
const MANAGER = 'user-manager';
const SITE = 'nt-1';

function contract(over: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    companyId: 'co-1',
    contractNo: 'HD-001',
    gravePlotId: 'plot-1',
    contractFileId: 'file-1',
    status: 'Verified',
    signedAt: new Date('2026-01-01'),
    validTo: new Date('2056-01-01'),
    totalAmount: 250_000_000,
    createdBy: AUTHOR,
    verifiedBy: null,
    parties: [{ id: 'p1', customerId: 'cus-1', role: 'OWNER' }],
    ...over,
  };
}

function build(row: unknown) {
  const record = vi.fn().mockResolvedValue(undefined);
  const update = vi
    .fn()
    .mockImplementation((args: { data: unknown }) => Promise.resolve(args.data));
  // Giao dịch thật: cho activate chạy TRỌN VẸN thay vì để nó nổ ở $transaction rồi
  // khẳng định "không nổ vì lý do X" — một khẳng định như thế xanh cả khi hỏng chỗ khác.
  const tx = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({ id: 'plot-1', status: 'Available' }),
      update: vi.fn().mockResolvedValue({}),
    },
    externalContract: { update: vi.fn().mockResolvedValue({ id: 'ct-1', status: 'Active' }) },
    gravePlotStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    graveUsageRight: { create: vi.fn().mockResolvedValue({ id: 'ur-1' }) },
  };
  /* Phần mộ của hợp đồng, NGOÀI giao dịch: `assertContractInScope` quy nghĩa trang trước
   * khi mở giao dịch, nên nó đọc `prisma.gravePlot` chứ không phải `tx.gravePlot`. */
  const plotFindUnique = vi.fn().mockResolvedValue({ cemeteryId: SITE });
  const plotFindMany = vi.fn().mockResolvedValue([{ id: 'plot-1' }]);
  const prisma = {
    externalContract: {
      findUnique: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([]),
      update,
    },
    gravePlot: { findUnique: plotFindUnique, findMany: plotFindMany },
    contractParty: { create: vi.fn().mockResolvedValue({ id: 'p9' }) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const listSiteFilterFor = vi.fn().mockResolvedValue(null);
  const svc = new ContractsService(
    prisma,
    { record } as unknown as AuditService,
    { assertCompanyFor, assertSiteFor, listSiteFilterFor } as unknown as ScopeService,
  );
  return {
    svc,
    record,
    update,
    tx,
    prisma,
    assertCompanyFor,
    assertSiteFor,
    listSiteFilterFor,
    plotFindUnique,
    plotFindMany,
  };
}

/* Số bước phụ thuộc NGƯỜI LÀM, không phụ thuộc bản ghi (G0-Q10). Ai cầm quyền cho hiệu
 * lực thì đi thẳng; ai không cầm thì không gọi được endpoint và phải qua tay người khác.
 */
describe('verify — người soạn không tự thẩm định hợp đồng của mình', () => {
  it('CHẶN khi người thẩm định chính là người soạn', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await expect(svc.verify('ct-1', verifier(AUTHOR))).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('nói rõ vì sao chặn, không chỉ báo lỗi trạng thái', async () => {
    const { svc } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await expect(svc.verify('ct-1', verifier(AUTHOR))).rejects.toThrow(/không được tự thẩm định/);
  });

  it('cho qua khi là người khác', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await svc.verify('ct-1', verifier(MANAGER));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Verified', verifiedBy: MANAGER }),
      }),
    );
  });

  it('không chặn hợp đồng cũ chưa biết ai soạn — không biết thì không khẳng định trùng người', async () => {
    const { svc, update } = build(contract({ status: 'Uploaded', createdBy: null }));
    await svc.verify('ct-1', verifier(AUTHOR));
    expect(update).toHaveBeenCalled();
  });
});

describe('activate — đi thẳng được, nhưng phải để lại vết', () => {
  it('cho hiệu lực THẲNG từ Uploaded, bỏ bước thẩm định', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded' }));
    await svc.activate('ct-1', activator(MANAGER));
    expect(tx.externalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Active', activatedBy: MANAGER }),
      }),
    );
  });

  it('ghi audit nói RÕ là đã bỏ bước thẩm định', async () => {
    const { svc, record } = build(contract({ status: 'Uploaded' }));
    await svc.activate('ct-1', activator(MANAGER));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTRACT.ACTIVATED',
        reason: expect.stringContaining('bỏ bước thẩm định'),
        afterData: expect.objectContaining({ skippedVerification: true, fromStatus: 'Uploaded' }),
      }),
    );
  });

  it('đường đi đủ bốn bước thì KHÔNG bị đánh dấu là bỏ bước', async () => {
    const { svc, record } = build(contract({ status: 'Verified', verifiedBy: MANAGER }));
    await svc.activate('ct-1', activator('user-director'));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: null,
        afterData: expect.objectContaining({ skippedVerification: false }),
      }),
    );
  });

  it('người soạn tự cho hiệu lực là ĐƯỢC PHÉP — chủ doanh nghiệp đã quyết', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded', createdBy: AUTHOR }));
    await svc.activate('ct-1', activator(AUTHOR));
    expect(tx.externalContract.update).toHaveBeenCalled();
  });

  it('vẫn CHẶN trạng thái không thể cho hiệu lực', async () => {
    const { svc, tx } = build(contract({ status: 'Cancelled' }));
    await expect(svc.activate('ct-1', activator(MANAGER))).rejects.toThrow(/Không thể cho hiệu lực/);
    expect(tx.externalContract.update).not.toHaveBeenCalled();
  });

  it('vẫn CHẶN khi thiếu dữ liệu bắt buộc, dù người gọi có quyền', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded', totalAmount: null, validTo: null }));
    await expect(svc.activate('ct-1', activator(MANAGER))).rejects.toThrow(/Thiếu/);
    expect(tx.externalContract.update).not.toHaveBeenCalled();
  });

  it('vẫn CHẶN khi lô mộ đã được phân bổ cho hợp đồng khác', async () => {
    const { svc, tx } = build(contract({ status: 'Uploaded' }));
    tx.gravePlot.findUnique.mockResolvedValue({ id: 'plot-1', status: 'Allocated' });
    await expect(svc.activate('ct-1', activator(MANAGER))).rejects.toThrow(/không phân bổ được/);
  });
});

/* HUỶ hợp đồng phải ĐẢO đúng ba thứ `activate` đã sinh ra: trạng thái hợp đồng, quyền sử
 * dụng phần mộ, và trạng thái phần mộ. Bỏ sót một cái là để lại một chủ mộ không có hợp
 * đồng, hoặc một phần mộ `Allocated` mà không ai đứng tên.
 *
 * Mã quyền `contract.record.cancel` có trong danh mục từ đầu nhưng KHÔNG có endpoint — nên
 * rào chắn xoá khách hàng bảo "dọn hợp đồng trước" mà hệ không có chỗ nào để dọn.
 */
describe('huỷ hợp đồng — đảo đúng hệ quả của activate', () => {
  function buildCancel(
    over: { status?: string; burials?: number; plotStatus?: string; rights?: number } = {},
  ) {
    const { status = 'Active', burials = 0, plotStatus = 'Allocated', rights = 1 } = over;
    const record = vi.fn().mockResolvedValue(undefined);
    const updateContract = vi.fn().mockResolvedValue({ id: 'ct-1', status: 'Cancelled' });
    const updateRight = vi.fn().mockResolvedValue({});
    const updatePlot = vi.fn().mockResolvedValue({});
    const createHistory = vi.fn().mockResolvedValue({});

    const tx = {
      externalContract: { update: updateContract },
      graveUsageRight: {
        findMany: vi
          .fn()
          .mockResolvedValue(Array.from({ length: rights }, (_, i) => ({ id: `ur-${i}` }))),
        update: updateRight,
      },
      gravePlot: {
        findUnique: vi.fn().mockResolvedValue({ id: 'plot-1', status: plotStatus }),
        update: updatePlot,
      },
      gravePlotStatusHistory: { create: createHistory },
    };

    const prisma = {
      externalContract: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ct-1',
          contractNo: 'HD-001',
          companyId: 'co-1',
          gravePlotId: 'plot-1',
          status,
        }),
      },
      burialRecord: { count: vi.fn().mockResolvedValue(burials) },
      /* NGOÀI giao dịch: `assertContractInScope` quy nghĩa trang trước khi mở giao dịch. */
      gravePlot: { findUnique: vi.fn().mockResolvedValue({ cemeteryId: SITE }) },
      $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;

    const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
    const assertSiteFor = vi.fn().mockResolvedValue(undefined);
    const svc = new ContractsService(
      prisma,
      { record } as unknown as AuditService,
      { assertCompanyFor, assertSiteFor } as unknown as ScopeService,
    );
    return {
      svc,
      record,
      updateContract,
      updateRight,
      updatePlot,
      createHistory,
      assertCompanyFor,
      assertSiteFor,
    };
  }

  it('huỷ được: hợp đồng Cancelled, quyền sử dụng Ended, mộ về Available', async () => {
    const { svc, updateContract, updateRight, updatePlot } = buildCancel();

    await svc.cancel('ct-1', { reason: 'khách đổi ý' }, CALLER_CANCEL);

    expect(updateContract).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Cancelled' }) }),
    );
    expect(updateRight).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Ended' }) }),
    );
    expect(updatePlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Available' }) }),
    );
  });

  /* Huỷ hợp đồng của một phần mộ đã có người nằm là rút căn cứ pháp lý của một việc không
   * đảo ngược được. Muốn đổi người chịu trách nhiệm thì đó là SANG TÊN. */
  it('mộ đã có hồ sơ an táng thì CHẶN, và chỉ sang SANG TÊN', async () => {
    const { svc, updateContract } = buildCancel({ burials: 1 });

    await expect(svc.cancel('ct-1', { reason: 'x' }, CALLER_CANCEL)).rejects.toThrow(
      /đã có 1 hồ sơ an táng.*SANG TÊN/s,
    );
    expect(updateContract).not.toHaveBeenCalled();
  });

  it('hợp đồng đã huỷ rồi thì không huỷ lại', async () => {
    const { svc } = buildCancel({ status: 'Cancelled' });

    await expect(svc.cancel('ct-1', { reason: 'x' }, CALLER_CANCEL)).rejects.toThrow(/đã huỷ rồi/);
  });

  it('huỷ hợp đồng NHÁP thì không có quyền nào để chấm dứt, mộ không đổi', async () => {
    const { svc, updateRight, updatePlot } = buildCancel({
      status: 'Draft',
      rights: 0,
      plotStatus: 'Available',
    });

    await svc.cancel('ct-1', { reason: 'bỏ bản nháp' }, CALLER_CANCEL);

    expect(updateRight).not.toHaveBeenCalled();
    expect(updatePlot).not.toHaveBeenCalled();
  });

  it('audit ghi lý do và số quyền đã chấm dứt theo', async () => {
    const { svc, record } = buildCancel({ rights: 2 });

    await svc.cancel('ct-1', { reason: 'khách trả lại mộ' }, CALLER_CANCEL);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTRACT.CANCELLED',
        afterData: expect.objectContaining({
          reason: 'khách trả lại mộ',
          endedUsageRights: 2,
        }),
      }),
    );
  });
  it('cancel hỏi nghĩa trang của phần mộ — ba đường nói CÙNG một điều', async () => {
    const { svc, assertSiteFor } = buildCancel();

    await svc.cancel('ct-1', { reason: 'khách đổi ý' }, CALLER_CANCEL);

    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'contract.record.cancel', SITE);
  });

});

/* Gate mã quyền trả lời "có được làm việc này hay không". Nó KHÔNG trả lời "lên hợp đồng
 * NÀO" — nên tới 27/08/2026 người cầm `contract.record.verify` thẩm định được hợp đồng của
 * công ty khác chỉ cần biết id, và `activate` thì phân bổ luôn phần mộ của công ty đó.
 */
describe('phạm vi — verify và activate chỉ chạm hợp đồng trong phạm vi được gán', () => {
  it('verify hỏi phạm vi theo companyId CỦA HỢP ĐỒNG, kèm mã quyền đang thi hành', async () => {
    const { svc, assertCompanyFor } = build(contract({ status: 'Uploaded' }));

    await svc.verify('ct-1', verifier(MANAGER));

    /* Tham số GIỮA là thứ đáng kiểm nhất: thiếu mã quyền thì phạm vi bị tính ở mức rộng
     * nhất của người gọi — đúng lớp lỗi đã vá bằng cách xoá bản cũ. */
    expect(assertCompanyFor).toHaveBeenCalledWith(MANAGER, 'contract.record.verify', 'co-1');
  });

  it('activate hỏi phạm vi theo companyId CỦA HỢP ĐỒNG, kèm mã quyền đang thi hành', async () => {
    const { svc, assertCompanyFor } = build(contract({ status: 'Verified' }));

    await svc.activate('ct-1', activator(MANAGER));

    expect(assertCompanyFor).toHaveBeenCalledWith(MANAGER, 'contract.record.activate', 'co-1');
  });

  it('ngoài phạm vi thì verify BỊ CHẶN và không sửa gì', async () => {
    const { svc, update, assertCompanyFor } = build(contract({ status: 'Uploaded' }));
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.verify('ct-1', verifier(MANAGER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('ngoài phạm vi thì activate BỊ CHẶN và phần mộ không bị phân bổ', async () => {
    const { svc, tx, assertCompanyFor } = build(contract({ status: 'Verified' }));
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.activate('ct-1', activator(MANAGER))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.graveUsageRight.create).not.toHaveBeenCalled();
    expect(tx.gravePlot.update).not.toHaveBeenCalled();
  });

  /* Thứ tự có giá trị riêng, không chỉ là thẩm mỹ: kiểm trạng thái trước rồi mới kiểm phạm
   * vi thì câu lỗi "Không thể xác minh ở trạng thái Active" đã kể cho người NGOÀI phạm vi
   * biết hợp đồng đó tồn tại và đang ở đâu. Cả hai đường đều phải trả 403, không phải 409. */
  it('ngoài phạm vi thì trả 403 chứ KHÔNG rò trạng thái hợp đồng qua câu lỗi 409', async () => {
    const { svc, assertCompanyFor } = build(contract({ status: 'Active' }));
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.verify('ct-1', verifier(MANAGER))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.cancel('ct-1', { reason: 'x' }, CALLER_CANCEL)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /* Không tìm thấy thì 404 TRƯỚC khi hỏi phạm vi — hỏi phạm vi của một bản ghi không tồn
   * tại là không có gì để hỏi, và `contract.companyId` lúc đó là đọc trên null. */
  it('hợp đồng không tồn tại thì 404, không gọi kiểm phạm vi', async () => {
    const { svc, assertCompanyFor } = build(null);

    await expect(svc.verify('ct-1', verifier(MANAGER))).rejects.toBeInstanceOf(NotFoundException);
    expect(assertCompanyFor).not.toHaveBeenCalled();
  });
});

/* TRỤC THỨ HAI: nghĩa trang.
 *
 * Bó theo công ty thôi thì người phụ trách nghĩa trang A vẫn chạm được hợp đồng ở nghĩa
 * trang B CÙNG công ty — và hợp đồng là căn cứ sinh quyền sử dụng phần mộ, nên đó là chạm
 * vào mộ của nghĩa trang khác. `ExternalContract.gravePlotId` là NOT NULL nên neo này luôn
 * quy được, không có nhánh nào để fail-open.
 */
describe('phạm vi — hợp đồng bó theo CẢ nghĩa trang, không chỉ công ty', () => {
  it('verify hỏi nghĩa trang của phần mộ, kèm mã quyền đang thi hành', async () => {
    const { svc, assertSiteFor, plotFindUnique } = build(contract({ status: 'Uploaded' }));

    await svc.verify('ct-1', verifier(MANAGER));

    expect(plotFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'plot-1' } }),
    );
    expect(assertSiteFor).toHaveBeenCalledWith(MANAGER, 'contract.record.verify', SITE);
  });

  it('activate hỏi nghĩa trang của phần mộ, kèm mã quyền đang thi hành', async () => {
    const { svc, assertSiteFor } = build(contract({ status: 'Verified' }));

    await svc.activate('ct-1', activator(MANAGER));

    expect(assertSiteFor).toHaveBeenCalledWith(MANAGER, 'contract.record.activate', SITE);
  });

  it('ngoài nghĩa trang thì activate BỊ CHẶN, phần mộ không bị phân bổ', async () => {
    const { svc, tx, assertSiteFor } = build(contract({ status: 'Verified' }));
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(svc.activate('ct-1', activator(MANAGER))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.graveUsageRight.create).not.toHaveBeenCalled();
    expect(tx.gravePlot.update).not.toHaveBeenCalled();
  });

  /* Hợp đồng và phần mộ ở hai schema và KHÔNG có khoá ngoại nối, nên hợp đồng trỏ vào phần
   * mộ đã biến mất là chuyện xảy ra được. Lúc đó không quy được nghĩa trang — và "không
   * kiểm được" phải dẫn tới CHẶN. Cho qua ở đây là fail-open, đúng lớp lỗi đang chặn
   * `createDeceased`. */
  it('không quy được phần mộ thì TỪ CHỐI, không phải bỏ qua phép kiểm', async () => {
    const { svc, update, plotFindUnique, assertSiteFor } = build(
      contract({ status: 'Uploaded' }),
    );
    plotFindUnique.mockResolvedValue(null);

    await expect(svc.verify('ct-1', verifier(MANAGER))).rejects.toThrow(
      /không kiểm được phạm vi/,
    );
    expect(assertSiteFor).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

/* Bó ba đường GHI mà để hở đường ĐỌC là bó nửa vời: đọc là chỗ lấy được id, và id là tất
 * cả những gì cần để gọi ba đường kia.
 */
describe('phạm vi — đường ĐỌC hợp đồng cũng bó, không chỉ đường ghi', () => {
  it('get hỏi CẢ hai trục — trước đây không nhận caller nào cả', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build(contract());

    await svc.get('ct-1', CALLER_VIEW);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'contract.record.view', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'contract.record.view', SITE);
  });

  it('get ngoài phạm vi thì 403, không trả bản ghi', async () => {
    const { svc, assertSiteFor } = build(contract());
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(svc.get('ct-1', CALLER_VIEW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('get không tìm thấy thì 404, không trả null kèm 200', async () => {
    const { svc } = build(null);

    await expect(svc.get('ct-1', CALLER_VIEW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list của người mức SITE bị BÓ theo id phần mộ trong nghĩa trang họ phụ trách', async () => {
    const { svc, prisma, listSiteFilterFor, plotFindMany } = build(contract());
    listSiteFilterFor.mockResolvedValue([SITE]);
    plotFindMany.mockResolvedValue([{ id: 'plot-1' }, { id: 'plot-2' }]);

    await svc.list('co-1', CALLER_VIEW);

    expect(plotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1', cemeteryId: { in: [SITE] } } }),
    );
    expect(prisma.externalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'co-1', gravePlotId: { in: ['plot-1', 'plot-2'] } },
      }),
    );
  });

  /* Được gán KHÔNG nghĩa trang nào nghĩa là với tới không cái nào, không phải với tới tất
   * cả. `in: []` là câu trả lời đúng ở đây — bỏ mệnh đề đi mới là sai. */
  it('người mức SITE chưa được gán nghĩa trang nào thì danh sách RỖNG, không phải tất cả', async () => {
    const { svc, prisma, listSiteFilterFor, plotFindMany } = build(contract());
    listSiteFilterFor.mockResolvedValue([]);
    plotFindMany.mockResolvedValue([]);

    await svc.list('co-1', CALLER_VIEW);

    expect(prisma.externalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1', gravePlotId: { in: [] } } }),
    );
  });

  it('người mức COMPANY/GROUP thì KHÔNG bị bó theo nghĩa trang', async () => {
    const { svc, prisma, listSiteFilterFor, plotFindMany } = build(contract());
    listSiteFilterFor.mockResolvedValue(null);

    await svc.list('co-1', CALLER_VIEW);

    expect(plotFindMany).not.toHaveBeenCalled();
    expect(prisma.externalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' } }),
    );
  });

  it('lọc theo MỘT phần mộ thì phần mộ đó phải trong nghĩa trang được gán', async () => {
    const { svc, assertSiteFor } = build(contract());

    await svc.list('co-1', CALLER_VIEW, undefined, 'plot-9');

    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'contract.record.view', SITE);
  });

  it('lọc theo phần mộ không tồn tại thì 404, không lặng lẽ trả cả công ty', async () => {
    const { svc, plotFindUnique } = build(contract());
    plotFindUnique.mockResolvedValue(null);

    await expect(svc.list('co-1', CALLER_VIEW, undefined, 'plot-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/* Thêm bên ký là GHI vào hợp đồng. Neo đã có sẵn (`assertContractInScope`), nên để hở đường
 * này trong khi `verify`/`activate`/`cancel`/`get`/`list` đều đã bó là hở đúng một khe.
 */
describe('phạm vi — thêm bên ký cũng bó, cùng neo với năm đường kia', () => {
  it('hỏi CẢ hai trục, kèm mã quyền đang thi hành', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build(contract({ status: 'Uploaded' }));

    await svc.addParty('ct-1', { customerId: 'cus-1', role: 'OWNER' }, CALLER_ADD_PARTY);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'contract.party.assign', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'contract.party.assign', SITE);
  });

  it('ngoài phạm vi thì KHÔNG tạo bên ký nào', async () => {
    const { svc, prisma, assertSiteFor } = build(contract({ status: 'Uploaded' }));
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(
      svc.addParty('ct-1', { customerId: 'cus-1', role: 'OWNER' }, CALLER_ADD_PARTY),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.contractParty.create).not.toHaveBeenCalled();
  });

  /* Cùng thứ tự với năm đường kia: phạm vi TRƯỚC phép kiểm trạng thái, để câu lỗi 409 không
   * kể cho người ngoài phạm vi biết hợp đồng đó tồn tại và đang ở đâu. */
  it('ngoài phạm vi thì trả 403 chứ không rò trạng thái qua 409', async () => {
    const { svc, assertCompanyFor } = build(contract({ status: 'Active' }));
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(
      svc.addParty('ct-1', { customerId: 'cus-1', role: 'OWNER' }, CALLER_ADD_PARTY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
