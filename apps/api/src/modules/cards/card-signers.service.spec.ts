import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CardSignersService } from './card-signers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* NGƯỜI KÝ THẺ MỘ — danh mục THEO NGHĨA TRANG (anh Bách chốt 05/09/2026).
 *
 * Bộ này kiểm phần SERVICE phải tự lo. Ba luật cứng nằm ở CSDL (một người mặc định MỖI
 * NGHĨA TRANG · người đã nghỉ không được là mặc định · một người một dòng đang dùng mỗi
 * nghĩa trang) — mock Prisma KHÔNG dựng lại được ràng buộc, nên đừng viết test ở đây mà
 * tưởng là đang canh chúng.
 */

const CEM = 'cem-1';
const CALLER: Caller = { userId: 'admin-1', permission: 'config.card_signer.update' };

const SIGNER = {
  id: 's1',
  userId: 'u-ql',
  cemeteryId: CEM,
  fullName: 'Trần Thị B',
  title: 'PHÓ GIÁM ĐỐC',
  isDefault: false,
  status: 'Active',
  createdBy: null,
  createdAt: new Date('2026-09-05'),
  updatedAt: new Date('2026-09-05'),
};

const NEW_SIGNER = { userId: 'u-ql', cemeteryId: CEM };

type SignerDelegate = {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

type BuildOpts = {
  existing?: unknown;
  createError?: unknown;
  /** Hồ sơ nhân viên. `null` = không có tài khoản. */
  user?: unknown;
  /** Người này có đang giữ vai QL_NGHIA_TRANG không. */
  holdsRole?: boolean;
  /** Người này có được phân công nghĩa trang đang xét không. */
  coversSite?: boolean;
  /** `listSiteFilterFor` trả về gì — `null` nghĩa là không bị bó. */
  siteFilter?: string[] | null;
};

function signerDelegate(opts: BuildOpts): SignerDelegate {
  const create = vi.fn();
  if (opts.createError === undefined) create.mockResolvedValue(SIGNER);
  else create.mockRejectedValue(opts.createError);

  const update = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...SIGNER, ...data }),
    );
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findUnique = vi
    .fn()
    .mockResolvedValue(opts.existing === undefined ? SIGNER : opts.existing);
  const findMany = vi.fn().mockResolvedValue([SIGNER]);

  return { create, update, updateMany, findUnique, findMany };
}

/* HAI bộ đếm TÁCH HẲN NHAU: `prisma` (client gốc) và `tx` (client giao dịch).
 *
 * Bản đầu của bộ test này cho `$transaction` chạy `fn(prisma)` — trả về CHÍNH client gốc làm
 * tx. Hệ quả: gọi trong giao dịch và gọi ngoài giao dịch rơi vào cùng một `vi.fn()`, nên
 * không phép so sánh nào phân biệt được hai đường. Đúng cái lỗi mà service vừa phải sửa —
 * mở giao dịch rồi vẫn ghi qua `this.prisma` — lại là cái test đó KHÔNG THỂ thấy.
 *
 * Tách ra thì mỗi ca đặt mặc định phải khẳng định được cả hai vế: lệnh ghi CÓ trên `tx`, và
 * KHÔNG có trên `prisma`. Vế thứ hai mới là vế bắt lỗi; bỏ nó đi là test lại mù như cũ.
 */
function build(opts: BuildOpts = {}) {
  const tx = { cardSigner: signerDelegate(opts) };

  const prisma = {
    cardSigner: signerDelegate(opts),
    cemetery: { findUnique: vi.fn().mockResolvedValue({ id: CEM, name: 'An Lạc Viên' }) },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.user === undefined
            ? { id: 'u-ql', email: 'ql@erp.local', fullName: 'Trần Thị B', title: 'PHÓ GIÁM ĐỐC' }
            : opts.user,
        ),
    },
    roleAssignment: {
      findFirst: vi.fn().mockResolvedValue(opts.holdsRole === false ? null : { id: 'ra1' }),
    },
    scopeAssignment: {
      findFirst: vi.fn().mockResolvedValue(opts.coversSite === false ? null : { id: 'sa1' }),
    },
    /* Giao dịch giả chạy thẳng hàm được truyền vào — đủ để kiểm THỨ TỰ hai bước và kiểm
     * chúng đi đúng client, không đủ để kiểm tính nguyên tử. Nguyên tử là việc của Postgres. */
    $transaction: vi.fn().mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService & {
    cardSigner: SignerDelegate;
    $transaction: ReturnType<typeof vi.fn>;
  };

  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const listSiteFilterFor = vi
    .fn()
    .mockResolvedValue(opts.siteFilter === undefined ? null : opts.siteFilter);
  const scope = { assertSiteFor, listSiteFilterFor } as unknown as ScopeService;

  const record = vi.fn().mockResolvedValue(undefined);
  const svc = new CardSignersService(prisma, { record } as unknown as AuditService, scope);
  return { svc, prisma, tx, record, assertSiteFor, listSiteFilterFor };
}

/* Bảng có HAI unique index, cả hai cùng ra P2002, và service chỉ phân biệt được nhờ
 * `meta.target`. Prisma trả trường này lúc là chuỗi, lúc là mảng, lúc không có — nên chỗ nào
 * cần dựng lỗi giả thì dựng qua đây để khỏi mỗi ca một hình dạng. */
function p2002(target?: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '6',
    ...(target === undefined ? {} : { meta: { target } }),
  });
}

describe('danh mục người ký thẻ mộ', () => {
  /* ---------- Luật 05/09/2026: người ký PHẢI là người quản lý nghĩa trang ---------- */

  it('từ chối người KHÔNG giữ vai quản lý nghĩa trang, và nói rõ đi cấp vai ở đâu', async () => {
    const { svc, prisma } = build({ holdsRole: false });
    const err = await svc.create(NEW_SIGNER, CALLER).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/không giữ vai Quản lý nghĩa trang/);
    expect((err as Error).message).toMatch(/Gán vai/);
    expect(prisma.cardSigner.create).not.toHaveBeenCalled();
  });

  /* GIAO của hai trục, không phải tổng — `ScopeAssignment` ghi thẳng điều đó trong schema.
   * Giữ vai KHÔNG tự cấp nghĩa trang nào, nên người giữ đúng vai mà chưa được phân công
   * nghĩa trang này thì vẫn không ký được ở đây. Câu từ chối phải chỉ sang ĐÚNG màn hình
   * thứ hai: cấp vai và phân công nghĩa trang là hai chỗ khác nhau, và một câu chung chung
   * sẽ đẩy người ta đi sửa nhầm chỗ. */
  it('người có vai nhưng CHƯA được phân công nghĩa trang này thì vẫn bị từ chối', async () => {
    const { svc, prisma } = build({ coversSite: false });
    const err = await svc.create(NEW_SIGNER, CALLER).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/chưa được phân công nghĩa trang này/);
    expect((err as Error).message).toMatch(/Phạm vi nghĩa trang/);
    expect(prisma.cardSigner.create).not.toHaveBeenCalled();
  });

  /* Cả hai trục đều có cửa sổ hiệu lực. Bỏ qua nó nghĩa là người hết nhiệm kỳ hôm qua vẫn
   * ký được thẻ hôm nay — mà `validTo` sinh ra chính là để không ai phải nhớ đi thu hồi. */
  it('chỉ tính phân công CÒN HIỆU LỰC — bản hết hạn coi như không tồn tại', async () => {
    const { svc, prisma } = build();
    await svc.create(NEW_SIGNER, CALLER);

    for (const call of [
      prisma.roleAssignment.findFirst.mock.calls[0]?.[0],
      prisma.scopeAssignment.findFirst.mock.calls[0]?.[0],
    ] as { where: Record<string, unknown> }[]) {
      expect(call.where.validFrom).toBeDefined();
      expect(JSON.stringify(call.where.OR)).toContain('validTo');
    }
  });

  /* Hai thứ DUY NHẤT in lên tờ thẻ. Thiếu một trong hai thì dòng người ký này in ra một ô
   * chữ ký trống — và người dùng phải biết đi sửa ở HỒ SƠ NHÂN VIÊN, không phải ở đây. */
  it('tài khoản chưa có họ tên hoặc chức danh thì từ chối, và chỉ sang hồ sơ nhân viên', async () => {
    const { svc } = build({
      user: { id: 'u-ql', email: 'ql@erp.local', fullName: 'Trần Thị B', title: null },
    });
    const err = await svc.create(NEW_SIGNER, CALLER).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/hồ sơ nhân viên/);
    expect((err as Error).message).toMatch(/ql@erp\.local/);
  });

  /* Đây là yêu cầu gốc của anh Bách: "họ và tên và chức danh lấy trong danh sách nhân viên".
   * DTO không còn nhận hai chuỗi đó nữa, nên ca này canh vế còn lại — service CHÉP từ hồ sơ
   * tài khoản chứ không lấy từ đâu khác. */
  it('CHÉP họ tên và chức danh từ hồ sơ nhân viên, không nhận chuỗi gõ tay', async () => {
    const { svc, prisma } = build({
      user: {
        id: 'u-ql',
        email: 'ql@erp.local',
        fullName: '  Lê Văn C  ',
        title: '  GIÁM ĐỐC  ',
      },
    });
    await svc.create(NEW_SIGNER, CALLER);

    const arg = prisma.cardSigner.create.mock.calls[0]?.[0] as {
      data: { fullName: string; title: string; userId: string; cemeteryId: string };
    };
    expect(arg.data.fullName).toBe('Lê Văn C');
    expect(arg.data.title).toBe('GIÁM ĐỐC');
    expect(arg.data.userId).toBe('u-ql');
    expect(arg.data.cemeteryId).toBe(CEM);
  });

  it('nghĩa trang không tồn tại thì 404, không tạo dòng trỏ vào hư không', async () => {
    const { svc, prisma } = build();
    (prisma.cemetery.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(svc.create(NEW_SIGNER, CALLER)).rejects.toThrow(NotFoundException);
    expect(prisma.cardSigner.create).not.toHaveBeenCalled();
  });

  /* ---------- Phạm vi ---------- */

  it('bó phạm vi theo nghĩa trang lúc TẠO, dùng đúng mã quyền của người gọi', async () => {
    const { svc, assertSiteFor } = build();
    await svc.create(NEW_SIGNER, CALLER);
    expect(assertSiteFor).toHaveBeenCalledWith(CALLER.userId, CALLER.permission, CEM);
  });

  /* Bó phạm vi phải đứng NGAY SAU phép tìm bản ghi và TRƯỚC mọi phép kiểm trạng thái — cùng
   * thứ tự đã dựng cho `contracts.verify` 27/08/2026. Kiểm trạng thái trước thì câu lỗi 400
   * đã kể cho người ngoài phạm vi biết dòng này tồn tại và đang ở trạng thái nào. */
  it('lúc SỬA thì bó phạm vi TRƯỚC khi kiểm trạng thái, không rò trạng thái ra ngoài phạm vi', async () => {
    const { svc, assertSiteFor } = build({ existing: { ...SIGNER, status: 'Retired' } });
    assertSiteFor.mockRejectedValue(new Error('Ngoài phạm vi được gán'));

    /* Dòng này VỐN sẽ ném BadRequest ("đã ngừng dùng thì không đặt mặc định được"). Nếu phép
     * kiểm phạm vi bị đặt xuống sau, người ngoài phạm vi sẽ nhận đúng câu đó — tức là biết
     * dòng tồn tại và đang ở trạng thái nào. Phải nhận câu phạm vi. */
    await expect(svc.update('s1', { isDefault: true }, CALLER)).rejects.toThrow(/Ngoài phạm vi/);
  });

  it('người ở mức SITE chỉ thấy người ký của nghĩa trang mình phủ', async () => {
    const { svc, prisma } = build({ siteFilter: ['cem-1', 'cem-2'] });
    await svc.list({ userId: 'u9', permission: 'cemetery.card_signer.view' });
    const arg = prisma.cardSigner.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where.cemeteryId).toEqual({ in: ['cem-1', 'cem-2'] });
  });

  /* ---------- Mặc định: MỖI NGHĨA TRANG một người ---------- */

  /* Đây là điểm khác lớn nhất so với bản 03/09, và là chỗ dễ hỏng nhất: bản cũ bỏ cờ của MỌI
   * dòng mặc định trong hệ. Giữ nguyên hành vi đó sau khi danh mục tách theo nghĩa trang thì
   * đặt người ký cho nghĩa trang A sẽ lặng lẽ bỏ mặc định của nghĩa trang B — một nghĩa trang
   * không liên quan tự mất người ký mặc định, và không có gì báo. */
  it('đặt mặc định CHỈ bỏ cờ trong CÙNG nghĩa trang, không đụng nghĩa trang khác', async () => {
    const { svc, prisma, tx } = build();
    await svc.create({ ...NEW_SIGNER, isDefault: true }, CALLER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, cemeteryId: CEM },
      data: { isDefault: false },
    });

    /* Hai dòng này mới là chỗ bắt lỗi. Mở giao dịch nhưng ghi qua client gốc thì giao dịch
     * rỗng: `updateMany` commit ngay, rồi `create` vỡ — hệ ở lại trạng thái không còn ai là
     * mặc định. Bỏ hai dòng này thì ca đó lại lọt. */
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(prisma.cardSigner.create).not.toHaveBeenCalled();

    /* Thứ tự: bỏ cờ xong mới tạo. Ngược lại là hai dòng cùng `is_default = true` trong một
     * khoảnh khắc, và partial unique index ở CSDL sẽ từ chối. */
    const clearOrder = tx.cardSigner.updateMany.mock.invocationCallOrder[0] ?? 0;
    const createOrder = tx.cardSigner.create.mock.invocationCallOrder[0] ?? 0;
    expect(clearOrder).toBeLessThan(createOrder);
  });

  it('KHÔNG đặt mặc định thì không mở giao dịch, ghi thẳng trên client gốc', async () => {
    const { svc, prisma, tx } = build();
    await svc.create(NEW_SIGNER, CALLER);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(prisma.cardSigner.create).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.create).not.toHaveBeenCalled();
  });

  it('sửa CHÍNH người đang mặc định thì không tự bỏ cờ của mình, và vẫn đi trong giao dịch', async () => {
    const { svc, prisma, tx } = build();
    await svc.update('s1', { isDefault: true }, CALLER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, cemeteryId: CEM, id: { not: 's1' } },
      data: { isDefault: false },
    });
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
  });

  /* ---------- Trạng thái ---------- */

  it('NGỪNG DÙNG người đang mặc định thì tự bỏ cờ trong cùng lệnh', async () => {
    const { svc, prisma } = build({ existing: { ...SIGNER, isDefault: true } });
    await svc.update('s1', { status: 'Retired' }, CALLER);
    expect(prisma.cardSigner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'Retired', isDefault: false },
    });
  });

  it('vừa NGỪNG DÙNG vừa đặt mặc định là yêu cầu tự mâu thuẫn — chặn trước khi chạm CSDL', async () => {
    const { svc, prisma, tx } = build({ existing: { ...SIGNER, isDefault: true } });

    await expect(svc.update('s1', { status: 'Retired', isDefault: true }, CALLER)).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.update('s1', { status: 'Retired', isDefault: true }, CALLER)).rejects.toThrow(
      /không thể là người ký mặc định/,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
    expect(tx.cardSigner.update).not.toHaveBeenCalled();
  });

  it('đặt mặc định cho một dòng VỐN ĐÃ ngừng dùng cũng bị chặn, dù dto không nhắc trạng thái', async () => {
    const { svc, prisma, tx } = build({ existing: { ...SIGNER, status: 'Retired' } });

    await expect(svc.update('s1', { isDefault: true }, CALLER)).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
    expect(tx.cardSigner.update).not.toHaveBeenCalled();
  });

  /* Đường vòng thật: không kiểm lại tư cách lúc BẬT LẠI thì một người đã rời ghế quản lý
   * nghĩa trang vẫn quay lại danh mục chỉ bằng một lệnh PATCH — tức là đi vòng qua đúng cái
   * luật vừa dựng, mà không đụng tới đường `create` nơi mọi phép kiểm đang nằm. */
  it('BẬT LẠI một người đã mất vai thì bị chặn, không đi vòng qua đường sửa', async () => {
    const { svc, prisma } = build({
      existing: { ...SIGNER, status: 'Retired' },
      holdsRole: false,
    });
    await expect(svc.update('s1', { status: 'Active' }, CALLER)).rejects.toThrow(
      /không giữ vai Quản lý nghĩa trang/,
    );
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
  });

  /* ---------- Đọc: mất vai thì HIỆN RA kèm lý do, không biến mất ---------- */

  /* Một người được thêm hợp lệ tháng trước có thể đã hết vai hôm nay, và KHÔNG lệnh UPDATE
   * nào chạm vào dòng đó — CSDL không thể biết. Lọc bỏ khỏi danh sách thì người dùng thấy
   * một cái tên biến mất mà không hiểu vì sao; phải hiện ra kèm lý do. */
  it('người đã mất vai vẫn HIỆN RA trong danh sách, kèm lý do, chứ không biến mất', async () => {
    const { svc } = build({ coversSite: false });
    const rows = await svc.list(CALLER, CEM);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eligible).toBe(false);
    expect(rows[0]?.ineligibleReason).toMatch(/chưa được phân công nghĩa trang này/);
  });

  it('người còn đủ tư cách thì eligible = true và không kèm lý do', async () => {
    const { svc } = build();
    const rows = await svc.list(CALLER, CEM);
    expect(rows[0]?.eligible).toBe(true);
    expect(rows[0]?.ineligibleReason).toBeNull();
  });

  /* Dòng người ký có từ trước migration 05/09 không nối tài khoản nào. Nó phải ở lại để tra
   * được tên đã in trên thẻ cũ, nhưng KHÔNG được dùng lại — và câu giải thích phải nói thẳng
   * là "thêm người mới", chứ không để người dùng loay hoay tìm cách sửa nó. */
  it('dòng cũ chưa nối tài khoản thì không đủ tư cách, và câu lý do bảo thêm người mới', async () => {
    const { svc, prisma } = build();
    (prisma.cardSigner.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...SIGNER, userId: null, cemeteryId: null, status: 'Retired', isDefault: false },
    ]);
    const rows = await svc.list(CALLER);
    expect(rows[0]?.eligible).toBe(false);
    expect(rows[0]?.ineligibleReason).toMatch(/Thêm người ký mới/);
  });

  it('KHÔNG sắp xếp theo trạng thái', async () => {
    const { svc, prisma } = build();
    await svc.list(CALLER);
    const arg = prisma.cardSigner.findMany.mock.calls[0]?.[0] as {
      orderBy: Record<string, unknown>[];
    };
    expect(JSON.stringify(arg.orderBy)).not.toContain('status');
  });

  /* ---------- Dịch lỗi trùng ---------- */

  it('một người hai dòng ở cùng nghĩa trang thì trả câu TIẾNG VIỆT, không lộ P2002', async () => {
    const { svc } = build({ createError: p2002('card_signers_active_user_site') });
    await expect(svc.create(NEW_SIGNER, CALLER)).rejects.toThrow(ConflictException);
    await expect(svc.create(NEW_SIGNER, CALLER)).rejects.toThrow(/đã có trong danh mục/);
  });

  /* Index thứ hai, cùng mã P2002, nguyên nhân khác hẳn: hai quản trị cùng bấm "Đặt mặc định"
   * trên hai dòng KHÁC NHAU. Bản đầu gán mọi P2002 cho index thứ nhất, nên ca này báo nhầm
   * nguyên nhân và người dùng đi sửa nhầm chỗ. Vì thế phải canh cả chiều PHỦ ĐỊNH. */
  it('trùng người MẶC ĐỊNH thì ra câu riêng, không đổ cho trùng người', async () => {
    const { svc } = build({ createError: p2002('card_signers_one_default_per_site') });
    const err = await svc
      .create({ ...NEW_SIGNER, isDefault: true }, CALLER)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/một người mặc định/);
    expect((err as Error).message).not.toMatch(/đã có trong danh mục/);
  });

  it('nhận ra tên index cả khi meta.target là MẢNG chứ không phải chuỗi', async () => {
    const { svc } = build({ createError: p2002(['card_signers_one_default_per_site']) });
    await expect(svc.create({ ...NEW_SIGNER, isDefault: true }, CALLER)).rejects.toThrow(
      /một người mặc định/,
    );
  });

  /* Không nhận ra index thì NÉM NGUYÊN lỗi gốc, không bọc và không đoán. Đoán bừa nguyên nhân
   * chính là lớp lỗi vừa sửa: một câu tiếng Anh khó đọc vẫn hơn một câu tiếng Việt chỉ sai
   * đường. Nên ca này canh hai vế — vẫn là lỗi Prisma ban đầu, VÀ không hề khẳng định nguyên nhân. */
  it('P2002 mà không nhận ra index thì ném nguyên lỗi gốc, không khẳng định sai nguyên nhân', async () => {
    const { svc } = build({ createError: p2002() });
    const err = await svc.create(NEW_SIGNER, CALLER).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err).not.toBeInstanceOf(ConflictException);
    expect((err as Error).message).not.toMatch(/danh mục|mặc định/);
  });

  it('lỗi KHÁC P2002 thì NÉM NGUYÊN, không nuốt thành lỗi trùng', async () => {
    const { svc } = build({ createError: new Error('connect ECONNREFUSED') });
    await expect(svc.create(NEW_SIGNER, CALLER)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('sửa người không tồn tại thì 404, không lặng lẽ tạo mới', async () => {
    const { svc } = build({ existing: null });
    await expect(svc.update('khong-co', { status: 'Active' }, CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ghi nhật ký kèm bản TRƯỚC và SAU khi sửa', async () => {
    const { svc, record } = build();
    await svc.update('s1', { status: 'Active' }, CALLER);
    const entry = record.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry.action).toBe('CARD_SIGNER.UPDATED');
    expect(entry.entityType).toBe('card_signer');
    expect(entry.beforeData).toBeDefined();
    expect(entry.afterData).toBeDefined();
  });
});
