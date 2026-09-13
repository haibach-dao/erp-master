import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessRulesService } from './access-rules.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PermissionsService } from './permissions.service';

function rule(id: string, priority: number, over: Record<string, unknown> = {}) {
  return {
    id,
    priority,
    effect: 'DENY',
    permissionCode: 'crm.person.view_sensitive',
    subjectUserId: null,
    roleCode: null,
    reason: 'thử',
    validFrom: new Date('2026-01-01'),
    validTo: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function build(
  opts: {
    rules?: ReturnType<typeof rule>[];
    catalog?: string[];
    ruling?: 'ALLOW' | 'DENY' | 'NO_MATCH';
    roles?: string[];
  } = {},
) {
  const rules = opts.rules ?? [];
  const create = vi.fn().mockImplementation((a: { data: unknown }) => Promise.resolve(a.data));
  const update = vi.fn().mockImplementation((a: unknown) => Promise.resolve(a));
  const record = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    accessRule: {
      findMany: vi.fn().mockResolvedValue(rules),
      findFirst: vi.fn().mockResolvedValue(rules[rules.length - 1] ?? null),
      findUnique: vi
        .fn()
        .mockImplementation((a: { where: { id: string } }) =>
          Promise.resolve(rules.find((r) => r.id === a.where.id) ?? null),
        ),
      create,
      update,
    },
    permission: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          (opts.catalog ?? ['crm.person.view_sensitive']).map((code) => ({ code })),
        ),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  const permissions = {
    evaluateRules: vi.fn().mockResolvedValue(opts.ruling ?? 'NO_MATCH'),
    getEffectiveAccess: vi.fn().mockResolvedValue({ roles: opts.roles ?? [], permissions: [] }),
    scopeLevelFor: vi.fn().mockResolvedValue('COMPANY'),
  } as unknown as PermissionsService;

  const svc = new AccessRulesService(prisma, { record } as unknown as AuditService, permissions);
  return { svc, create, update, record, prisma };
}

const NEW_RULE = {
  effect: 'DENY' as const,
  permissionCode: 'crm.person.view_sensitive',
  reason: 'LÀN CẤM',
};

/* Thứ tự LÀ ý nghĩa của bảng này. Cùng hai luật đặt ngược thứ tự cho ra kết quả ngược
 * nhau, nên các thao tác quanh thứ tự phải không thể dùng sai.
 */
describe('create — luật mới vào CUỐI chuỗi', () => {
  it('cấp priority lớn hơn luật cuối, không chèn lên đầu', async () => {
    const { svc, create } = build({ rules: [rule('r1', 10), rule('r2', 20)] });
    await svc.create(NEW_RULE, 'admin');
    expect((create.mock.calls[0]?.[0] as { data: { priority: number } }).data.priority).toBe(30);
  });

  it('luật đầu tiên trong bảng rỗng nhận priority 10', async () => {
    const { svc, create } = build({ rules: [] });
    await svc.create(NEW_RULE, 'admin');
    expect((create.mock.calls[0]?.[0] as { data: { priority: number } }).data.priority).toBe(10);
  });

  it('bắt buộc có lý do', async () => {
    const { svc, create } = build();
    await expect(svc.create({ ...NEW_RULE, reason: '  ' }, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('từ chối mẫu sai số đoạn', async () => {
    const { svc } = build();
    await expect(
      svc.create({ ...NEW_RULE, permissionCode: 'crm.person' }, 'admin'),
    ).rejects.toThrow(/3 đoạn/);
  });

  /* Một luật không khớp mã nào là một luật nằm đó TRÔNG NHƯ đang bảo vệ mà không bảo vệ
   * gì — tệ hơn là không có luật, vì nó tạo cảm giác an toàn sai. */
  it('từ chối mẫu không khớp mã nào trong danh mục', async () => {
    const { svc } = build({ catalog: ['crm.customer.view'] });
    await expect(
      svc.create({ ...NEW_RULE, permissionCode: 'khong.co.that' }, 'admin'),
    ).rejects.toThrow(/không khớp mã nào/);
  });

  it('mẫu có `*` được nhận khi nó khớp ít nhất một mã thật', async () => {
    const { svc, create } = build({ catalog: ['crm.person.view_sensitive', 'crm.person.export'] });
    await svc.create({ ...NEW_RULE, permissionCode: 'crm.person.*' }, 'admin');
    expect(create).toHaveBeenCalled();
  });

  it('ghi audit kèm lý do', async () => {
    const { svc, record } = build();
    await svc.create(NEW_RULE, 'admin');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTHZ.RULE_CREATED', reason: 'LÀN CẤM' }),
    );
  });
});

describe('move — đổi chỗ hai luật liền kề', () => {
  it('đẩy lên là đổi priority với luật ngay trên', async () => {
    const { svc, record } = build({ rules: [rule('r1', 10), rule('r2', 20)] });
    const out = await svc.move('r2', 'up', 'admin');
    expect(out).toEqual({ moved: 'r2', swappedWith: 'r1' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTHZ.RULE_REORDERED' }),
    );
  });

  it('luật ở đầu chuỗi không đẩy lên được', async () => {
    const { svc } = build({ rules: [rule('r1', 10), rule('r2', 20)] });
    await expect(svc.move('r1', 'up', 'admin')).rejects.toThrow(/đầu chuỗi/);
  });

  it('luật ở cuối chuỗi không đẩy xuống được', async () => {
    const { svc } = build({ rules: [rule('r1', 10), rule('r2', 20)] });
    await expect(svc.move('r2', 'down', 'admin')).rejects.toThrow(/cuối chuỗi/);
  });

  it('luật không tồn tại thì 404', async () => {
    const { svc } = build({ rules: [rule('r1', 10)] });
    await expect(svc.move('khong-co', 'up', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('revoke — đóng hiệu lực, không xoá dòng', () => {
  it('đặt validTo thay vì delete', async () => {
    const { svc, update } = build({ rules: [rule('r1', 10)] });
    await svc.revoke('r1', 'admin');
    const arg = update.mock.calls[0]?.[0] as { data: { validTo: Date } };
    expect(arg.data.validTo).toBeInstanceOf(Date);
  });

  it('ghi audit với giá trị trước', async () => {
    const { svc, record } = build({ rules: [rule('r1', 10)] });
    await svc.revoke('r1', 'admin');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTHZ.RULE_REVOKED',
        beforeData: expect.objectContaining({ effect: 'DENY' }),
      }),
    );
  });
});

/* Một chuỗi luật có thứ tự mà không thử được là một chuỗi không ai dám sửa. */
describe('explain — thử chuỗi luật cho một (người, mã)', () => {
  it('chỉ ra ĐÚNG luật khớp đầu tiên', async () => {
    const { svc } = build({
      rules: [
        rule('r1', 10, { permissionCode: 'crm.customer.view' }),
        rule('r2', 20, { permissionCode: 'crm.person.view_sensitive' }),
        rule('r3', 30, { permissionCode: 'crm.person.*' }),
      ],
      ruling: 'DENY',
    });
    const out = await svc.explain('u1', 'crm.person.view_sensitive');
    expect(out.matchedRule?.id).toBe('r2');
    expect(out.ruling).toBe('DENY');
  });

  it('nói rõ khi không luật nào khớp — ma trận vai mới là chỗ quyết', async () => {
    const { svc } = build({ rules: [rule('r1', 10, { permissionCode: 'crm.customer.view' })] });
    const out = await svc.explain('u1', 'service.revenue.view');
    expect(out.matchedRule).toBeNull();
    expect(out.fallsBackToRoleMatrix).toBe(true);
  });

  it('bỏ qua luật nhắm vai mà người gọi không giữ', async () => {
    const { svc } = build({
      rules: [rule('r1', 10, { roleCode: 'QT_HE_THONG' })],
      roles: ['THU_NGAN'],
    });
    const out = await svc.explain('u1', 'crm.person.view_sensitive');
    expect(out.matchedRule).toBeNull();
  });

  /* CÁI BẪY của `grantInForce()`: nó MANG một khoá `OR`, mà mệnh đề ngay trên cũng có `OR` của
   * riêng nó (lọc `subjectUserId`). Trải cả hai vào cùng một object thì khoá sau ĐÈ khoá trước
   * — JavaScript im lặng, TypeScript im lặng, Prisma im lặng.
   *
   * Mất khoá nào cũng hỏng, và hỏng theo hướng nguy hiểm:
   *   · mất `OR` chủ thể → luật nhắm đích danh NGƯỜI KHÁC bị đem ra áp cho người này;
   *   · mất cửa sổ hiệu lực → luật DENY đã hết hạn vẫn chặn, luật ALLOW đã hết hạn vẫn mở.
   *
   * Nên kiểm CẢ HAI còn nguyên trong một mệnh đề, chứ không kiểm riêng từng cái. */
  it('giữ CẢ HAI: lọc chủ thể và cửa sổ hiệu lực — không khoá nào đè khoá nào', async () => {
    const { svc, prisma } = build({ rules: [rule('r1', 10)] });
    await svc.explain('u1', 'crm.person.view_sensitive');

    const findMany = (prisma as unknown as { accessRule: { findMany: ReturnType<typeof vi.fn> } })
      .accessRule.findMany;
    const where = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;

    expect(where.OR).toEqual([{ subjectUserId: 'u1' }, { subjectUserId: null }]);
    expect(where.AND).toEqual([
      {
        validFrom: { lte: expect.any(Date) },
        OR: [{ validTo: null }, { validTo: { gt: expect.any(Date) } }],
      },
    ]);
  });
});

/* Màn quản trị dán nhãn "còn hiệu lực" lên từng luật. Nhãn đó phải nói ĐÚNG cái mà chuỗi duyệt
 * làm — một màn hình nói dối về chính thứ nó quản còn tệ hơn một màn hình không có nhãn.
 *
 * Nên biên ở đây là `>` để khớp `gt` của `grantInForce`, và ca `validTo` ĐÚNG BẰNG bây giờ là ca
 * duy nhất phân biệt được `gt` với `gte`. Đó chính là chỗ đã lệch một lần: danh mục người ký nói
 * "được ký" trong khi `PermissionGuard` nói 403.
 */
describe('list — nhãn "còn hiệu lực" phải khớp từng chữ với chuỗi duyệt', () => {
  const NOW = new Date('2026-09-09T10:00:00Z');

  function at(over: Record<string, unknown>) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return build({ rules: [rule('r1', 10, over)] });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('luật vô thời hạn thì còn hiệu lực', async () => {
    const { svc } = at({ validTo: null });
    expect((await svc.list())[0]?.active).toBe(true);
  });

  it('luật đã qua hạn thì hết hiệu lực', async () => {
    const { svc } = at({ validTo: new Date('2026-09-09T09:59:59Z') });
    expect((await svc.list())[0]?.active).toBe(false);
  });

  it('luật chưa tới ngày bắt đầu thì CHƯA có hiệu lực', async () => {
    const { svc } = at({ validFrom: new Date('2026-09-10T00:00:00Z') });
    expect((await svc.list())[0]?.active).toBe(false);
  });

  /* Ca vạch ra lằn ranh `gt` / `gte`. Lấy `gte` thì dòng này thành `true`, và màn hình sẽ nói
   * "còn hiệu lực" về đúng cái luật mà `evaluateRules` vừa bỏ qua. */
  it('validTo ĐÚNG BẰNG bây giờ là HẾT hiệu lực — biên `gt`, không phải `gte`', async () => {
    const { svc } = at({ validTo: NOW });
    expect((await svc.list())[0]?.active).toBe(false);
  });
});
