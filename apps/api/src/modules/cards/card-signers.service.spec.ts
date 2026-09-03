import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CardSignersService } from './card-signers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/* NGƯỜI KÝ THẺ MỘ — danh mục toàn hệ (anh Bách chốt 03/09/2026).
 *
 * Bộ này kiểm phần SERVICE phải tự lo. Ba luật cứng nằm ở CSDL và đã được kiểm bằng 11 ca
 * psql chạy thật (nhiều nhất một người mặc định · người đã nghỉ không được là mặc định ·
 * không trùng cả tên lẫn chức danh khi đang dùng) — mock Prisma KHÔNG dựng lại được ràng
 * buộc, nên đừng viết test ở đây mà tưởng là đang canh chúng.
 */

const SIGNER = {
  id: 's1',
  fullName: 'Trần Thị B',
  title: 'PHÓ GIÁM ĐỐC',
  isDefault: false,
  status: 'Active',
  createdBy: null,
  createdAt: new Date('2026-09-03'),
  updatedAt: new Date('2026-09-03'),
};

type SignerDelegate = {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

type BuildOpts = { existing?: unknown; createError?: unknown };

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
 *
 * Nhánh không đặt mặc định thì service truyền thẳng `this.prisma` xuống, nên lệnh ghi rơi
 * vào bộ đếm gốc — đó là hành vi đúng, không phải sơ hở của mock.
 */
function build(opts: BuildOpts = {}) {
  const tx = { cardSigner: signerDelegate(opts) };

  const prisma = {
    cardSigner: signerDelegate(opts),
    /* Giao dịch giả chạy thẳng hàm được truyền vào — đủ để kiểm THỨ TỰ hai bước và kiểm
     * chúng đi đúng client, không đủ để kiểm tính nguyên tử. Nguyên tử là việc của Postgres. */
    $transaction: vi.fn().mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService & {
    cardSigner: SignerDelegate;
    $transaction: ReturnType<typeof vi.fn>;
  };

  const record = vi.fn().mockResolvedValue(undefined);
  const svc = new CardSignersService(prisma, { record } as unknown as AuditService);
  return { svc, prisma, tx, record };
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
  it('đặt người MẶC ĐỊNH thì BỎ CỜ người cũ TRƯỚC, và cả hai lệnh chạy TRONG giao dịch', async () => {
    const { svc, prisma, tx } = build();
    await svc.create({ fullName: 'Lê Văn C', title: 'GIÁM ĐỐC', isDefault: true }, 'u1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.cardSigner.create).toHaveBeenCalledTimes(1);

    /* Hai dòng này mới là chỗ bắt lỗi. Mở giao dịch nhưng ghi qua client gốc thì giao dịch
     * rỗng: `updateMany` commit ngay, rồi `create` vỡ vì trùng tên — hệ ở lại trạng thái
     * không còn ai là mặc định. Bỏ hai dòng này thì ca đó lại lọt. */
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
    await svc.create({ fullName: 'Lê Văn C', title: 'GIÁM ĐỐC' }, 'u1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    /* Chỉ một lệnh thì không cần giao dịch — nhưng vẫn phải ghi thật, chứ không phải "không
     * gọi gì cả" cũng cho qua. */
    expect(prisma.cardSigner.create).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.create).not.toHaveBeenCalled();
  });

  it('sửa CHÍNH người đang mặc định thì không tự bỏ cờ của mình, và vẫn đi trong giao dịch', async () => {
    const { svc, prisma, tx } = build();
    await svc.update('s1', { isDefault: true }, 'u1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cardSigner.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, id: { not: 's1' } },
      data: { isDefault: false },
    });
    expect(tx.cardSigner.update).toHaveBeenCalledTimes(1);
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
  });

  /* Đây là chỗ service phải HIỂU Ý người dùng thay vì đưa lỗi CSDL ra màn hình: họ chỉ bấm
   * "Ngừng dùng", họ không đặt cờ mặc định nào cả. */
  it('NGỪNG DÙNG người đang mặc định thì tự bỏ cờ trong cùng lệnh', async () => {
    const { svc, prisma } = build({ existing: { ...SIGNER, isDefault: true } });
    await svc.update('s1', { status: 'Retired' }, 'u1');
    expect(prisma.cardSigner.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'Retired', isDefault: false },
    });
  });

  /* THAY cho ca cũ "ngừng dùng mà người gọi TỰ nêu isDefault thì tôn trọng ý họ". Ca ấy khoá
   * lại một hành vi SAI, không phải một hành vi cần giữ: "tôn trọng ý họ" ở đây nghĩa là gửi
   * xuống CSDL một dòng vừa `Retired` vừa `is_default = true`, mà `card_signers_default_active_check`
   * từ chối thẳng. Lỗi CHECK không phải P2002 nên `wrapDuplicate` ném nguyên — người dùng
   * nhận 500 kèm câu tiếng Anh của Postgres. Không có ý nào để tôn trọng cả; yêu cầu này tự
   * mâu thuẫn nên phải chặn ngay, và chặn ở service để câu lỗi còn đọc được.
   *
   * Ai đọc sau này đừng tưởng đây là hồi quy: hành vi cũ chưa bao giờ chạy được đến nơi. */
  it('vừa NGỪNG DÙNG vừa đặt mặc định là yêu cầu tự mâu thuẫn — chặn trước khi chạm CSDL', async () => {
    const { svc, prisma, tx } = build({ existing: { ...SIGNER, isDefault: true } });

    await expect(svc.update('s1', { status: 'Retired', isDefault: true }, 'u1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.update('s1', { status: 'Retired', isDefault: true }, 'u1')).rejects.toThrow(
      /không thể là người ký mặc định/,
    );

    /* Chặn mà vẫn kịp ghi thì chẳng chặn gì: phải đỏ nếu ai đó đặt phép kiểm xuống SAU lệnh ghi. */
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(tx.cardSigner.update).not.toHaveBeenCalled();
    expect(tx.cardSigner.updateMany).not.toHaveBeenCalled();
  });

  /* Bẫy thật: PATCH chỉ gửi `{ isDefault: true }`, không gửi `status`. Mọi phép kiểm nhìn vào
   * riêng `dto.status` đều cho qua vì `dto.status` là undefined — rồi vỡ ở CSDL. Trạng thái
   * SAU KHI SỬA mới là thứ phải xét, và ở đây nó lấy từ bản ghi cũ. */
  it('đặt mặc định cho một dòng VỐN ĐÃ ngừng dùng cũng bị chặn, dù dto không nhắc trạng thái', async () => {
    const { svc, prisma, tx } = build({ existing: { ...SIGNER, status: 'Retired' } });

    await expect(svc.update('s1', { isDefault: true }, 'u1')).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardSigner.update).not.toHaveBeenCalled();
    expect(prisma.cardSigner.updateMany).not.toHaveBeenCalled();
    expect(tx.cardSigner.update).not.toHaveBeenCalled();
    expect(tx.cardSigner.updateMany).not.toHaveBeenCalled();
  });

  it('cắt khoảng trắng thừa ở tên và chức danh — " Trần Thị B " và "Trần Thị B" là một người', async () => {
    const { svc, prisma } = build();
    await svc.create({ fullName: '  Trần Thị B  ', title: '  PHÓ GIÁM ĐỐC  ' }, 'u1');
    const arg = prisma.cardSigner.create.mock.calls[0]?.[0] as {
      data: { fullName: string; title: string };
    };
    expect(arg.data.fullName).toBe('Trần Thị B');
    expect(arg.data.title).toBe('PHÓ GIÁM ĐỐC');
  });

  it('trùng tên + chức danh thì trả câu TIẾNG VIỆT, không để lộ P2002 và tên index', async () => {
    const { svc } = build({ createError: p2002('card_signers_active_name_title') });
    await expect(
      svc.create({ fullName: 'Trần Thị B', title: 'PHÓ GIÁM ĐỐC' }, 'u1'),
    ).rejects.toThrow(ConflictException);
    await expect(
      svc.create({ fullName: 'Trần Thị B', title: 'PHÓ GIÁM ĐỐC' }, 'u1'),
    ).rejects.toThrow(/không phân biệt được/);
  });

  /* Index thứ hai, cùng mã P2002, nguyên nhân khác hẳn: hai quản trị cùng bấm "Đặt mặc định"
   * trên hai dòng KHÁC NHAU. Bản đầu gán mọi P2002 cho index trùng tên, nên ca này báo "trùng
   * họ tên" cho hai người tên khác hẳn nhau — họ đi sửa tên, còn nguyên nhân thật thì không
   * ai thấy. Vì thế phải khẳng định cả chiều PHỦ ĐỊNH: câu này không được nhắc tên/chức danh. */
  it('trùng người MẶC ĐỊNH thì ra câu riêng, không đổ cho trùng tên', async () => {
    const { svc } = build({ createError: p2002('card_signers_one_default') });
    const err = await svc
      .create({ fullName: 'Lê Văn C', title: 'GIÁM ĐỐC', isDefault: true }, 'u1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/một người mặc định/);
    expect((err as Error).message).not.toMatch(/họ tên|chức danh/);
  });

  /* `meta.target` khi là mảng phải nhận ra y như khi là chuỗi — Prisma đổi hình dạng theo
   * driver và phiên bản, và người dùng thì không quan tâm hôm nay nó trả kiểu gì. */
  it('nhận ra tên index cả khi meta.target là MẢNG chứ không phải chuỗi', async () => {
    const { svc } = build({ createError: p2002(['card_signers_one_default']) });
    await expect(
      svc.create({ fullName: 'Lê Văn C', title: 'GIÁM ĐỐC', isDefault: true }, 'u1'),
    ).rejects.toThrow(/một người mặc định/);
  });

  /* Không nhận ra index thì NÉM NGUYÊN lỗi gốc, không bọc và không đoán. Đoán bừa nguyên nhân
   * chính là lớp lỗi vừa sửa: một câu tiếng Anh khó đọc vẫn hơn một câu tiếng Việt chỉ sai
   * đường. Nên ca này canh hai vế — vẫn là lỗi Prisma ban đầu, VÀ không hề khẳng định nguyên nhân. */
  it('P2002 mà không nhận ra index thì ném nguyên lỗi gốc, không khẳng định sai nguyên nhân', async () => {
    const { svc } = build({ createError: p2002() });
    const err = await svc
      .create({ fullName: 'Trần Thị B', title: 'PHÓ GIÁM ĐỐC' }, 'u1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err).not.toBeInstanceOf(ConflictException);
    expect((err as Error).message).not.toMatch(/họ tên|chức danh|mặc định/);
  });

  it('lỗi KHÁC P2002 thì NÉM NGUYÊN, không nuốt thành "trùng tên"', async () => {
    const { svc } = build({ createError: new Error('connect ECONNREFUSED') });
    await expect(
      svc.create({ fullName: 'Trần Thị B', title: 'PHÓ GIÁM ĐỐC' }, 'u1'),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('sửa người không tồn tại thì 404, không lặng lẽ tạo mới', async () => {
    const { svc } = build({ existing: null });
    await expect(svc.update('khong-co', { title: 'X' }, 'u1')).rejects.toThrow(NotFoundException);
  });

  it('ghi nhật ký kèm bản TRƯỚC và SAU khi sửa', async () => {
    const { svc, record } = build();
    await svc.update('s1', { title: 'GIÁM ĐỐC' }, 'u1');
    const entry = record.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry.action).toBe('CARD_SIGNER.UPDATED');
    expect(entry.entityType).toBe('card_signer');
    expect(entry.beforeData).toBeDefined();
    expect(entry.afterData).toBeDefined();
  });

  /* Người đã nghỉ vẫn PHẢI trả về: trang quản trị cần thấy để bật lại, và màn hình cấp thẻ
   * tự lọc `Active`. Cũng canh luôn rằng danh sách KHÔNG sắp theo `status` — thứ tự đó chỉ
   * đúng nhờ 'Active' tình cờ đứng trước 'Retired' trong bảng chữ cái. */
  it('trả cả người đã nghỉ, và KHÔNG sắp xếp theo trạng thái', async () => {
    const { svc, prisma } = build();
    await svc.list();
    const arg = prisma.cardSigner.findMany.mock.calls[0]?.[0] as {
      where?: unknown;
      orderBy: Record<string, unknown>[];
    };
    expect(arg.where).toBeUndefined();
    expect(JSON.stringify(arg.orderBy)).not.toContain('status');
  });
});
