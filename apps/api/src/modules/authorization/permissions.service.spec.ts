import { describe, expect, it, vi } from 'vitest';
import { PermissionsService } from './permissions.service';
import type { PrismaService } from '../../prisma/prisma.service';

function assignment(roleCode: string, codes: string[], scope: string, companyId: string | null) {
  return {
    scope: null,
    companyId,
    role: {
      code: roleCode,
      rolePermissions: codes.map((code) => ({ scope, permission: { code } })),
    },
  };
}

function build(
  assignments: unknown[],
  sites: { cemeteryId: string }[] = [],
  rules: Record<string, unknown>[] = [],
  meta: { code: string; wildcardExempt: boolean; sensitivity: string } | null = null,
) {
  const findMany = vi.fn().mockResolvedValue(assignments);
  const svc = new PermissionsService({
    roleAssignment: { findMany },
    scopeAssignment: { findMany: vi.fn().mockResolvedValue(sites) },
    accessRule: { findMany: vi.fn().mockResolvedValue(rules) },
    permission: { findUnique: vi.fn().mockResolvedValue(meta) },
  } as unknown as PrismaService);
  return { svc, findMany };
}

describe('getEffectiveAccess — what the caller may do, and where', () => {
  it('collects roles and codes across every assignment, de-duplicated and sorted', async () => {
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view', 'crm.customer.view'], 'COMPANY', 'co-1'),
      assignment('CSKH_TIEP_DON', ['crm.customer.view', 'cemetery.plot.view'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.roles).toEqual(['CSKH_TIEP_DON', 'THU_NGAN']);
    expect(access.permissions).toEqual([
      'cemetery.plot.view',
      'contract.record.view',
      'crm.customer.view',
    ]);
  });

  it('reports the companies the caller is bound to', async () => {
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-2'),
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope).toEqual({
      level: 'COMPANY',
      unrestricted: false,
      companyIds: ['co-1', 'co-2'],
      siteIds: [],
    });
  });

  it('a GROUP grant means no record restriction at all', async () => {
    const { svc } = build([assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null)]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.unrestricted).toBe(true);
  });

  it('a caller with no assignment is bound to nothing — not to everything', async () => {
    const { svc } = build([]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access).toEqual({
      roles: [],
      permissions: [],
      denied: [],
      scope: { level: 'NONE', unrestricted: false, companyIds: [], siteIds: [] },
    });
  });

  it('one GROUP role alongside a company-bound role still lifts the restriction', async () => {
    // Known consequence of the union rule in getGrants: the widest scope wins today.
    // Narrowing to the tightest scope is a separate change, and until it lands nothing
    // may treat `scope` as a security boundary.
    const { svc } = build([
      assignment('THU_NGAN', ['contract.record.view'], 'COMPANY', 'co-1'),
      assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.unrestricted).toBe(true);
    expect(access.scope.companyIds).toEqual(['co-1']);
  });
});

describe('scope level — the difference between "no limit" and "no cemeteries yet"', () => {
  it('a site-bound role reports SITE, so an empty hub means reaching nothing', async () => {
    const { svc } = build([assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1')]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.level).toBe('SITE');
    expect(access.scope.siteIds).toEqual([]);
  });

  it('reports the cemeteries assigned in the hub', async () => {
    const { svc } = build(
      [assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1')],
      [{ cemeteryId: 'ct-2' }, { cemeteryId: 'ct-1' }],
    );
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.siteIds).toEqual(['ct-1', 'ct-2']);
  });

  it('the widest level wins today — a known inversion of the intended rule', async () => {
    const { svc } = build([
      assignment('NV_BAO_TRI', ['cemetery.plot.view'], 'SITE', 'co-1'),
      assignment('GD_CONG_TY', ['contract.record.approve'], 'COMPANY', 'co-1'),
    ]);
    const access = await svc.getEffectiveAccess('u1');
    expect(access.scope.level).toBe('COMPANY');
  });
});

/* Union means "add up what each role gives", NOT "take the widest thing you hold
 * anywhere and apply it everywhere". Computed globally it leaks: the group-wide audit
 * role below never grants set_status, so it must not widen it.
 */
describe('scopeLevelFor — union computed PER CODE', () => {
  const twoRoles = [
    assignment('KTNB_KIEM_TOAN', ['audit.event.view'], 'GROUP', null),
    assignment('THU_NGAN', ['cemetery.plot.set_status'], 'COMPANY', 'co-1'),
  ];

  it('gives GROUP on the code the group-wide role actually grants', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'audit.event.view')).resolves.toBe('GROUP');
  });

  it('gives only COMPANY on a code the group-wide role never granted', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'cemetery.plot.set_status')).resolves.toBe('COMPANY');
  });

  it('gives NONE for a code nobody granted', async () => {
    const { svc } = build(twoRoles);
    await expect(svc.scopeLevelFor('u1', 'service.revenue.view')).resolves.toBe('NONE');
  });
});

function rule(over: Record<string, unknown> = {}) {
  return {
    priority: 100,
    effect: 'DENY',
    subjectUserId: null,
    roleCode: null,
    permissionCode: 'crm.person.view_sensitive',
    reason: 'LÀN CẤM',
    validTo: null,
    ...over,
  };
}

/* Firewall semantics: ascending priority, first match wins, evaluation stops there.
 * Order IS the meaning of this table — the same two rules in the other order give the
 * opposite answer, which is exactly why the chain has to be printable in order.
 */
describe('rule chain — ordered, first match wins', () => {
  it('a DENY rule blocks a code the role matrix grants', async () => {
    const { svc } = build(
      [assignment('DPO_DLCN', ['crm.person.view_sensitive'], 'GROUP', null)],
      [],
      [rule()],
    );
    await expect(svc.evaluateRules('u1', 'crm.person.view_sensitive')).resolves.toBe('DENY');
  });

  it('an ALLOW placed ABOVE a DENY wins — the exception beats the blanket ban', async () => {
    const { svc } = build(
      [],
      [],
      [
        rule({ priority: 10, effect: 'ALLOW', permissionCode: 'crm.person.view_sensitive' }),
        rule({ priority: 20, effect: 'DENY', permissionCode: 'crm.person.*' }),
      ],
    );
    await expect(svc.evaluateRules('u1', 'crm.person.view_sensitive')).resolves.toBe('ALLOW');
  });

  it('the same two rules in the other order give the opposite answer', async () => {
    const { svc } = build(
      [],
      [],
      [
        rule({ priority: 10, effect: 'DENY', permissionCode: 'crm.person.*' }),
        rule({ priority: 20, effect: 'ALLOW', permissionCode: 'crm.person.view_sensitive' }),
      ],
    );
    await expect(svc.evaluateRules('u1', 'crm.person.view_sensitive')).resolves.toBe('DENY');
  });

  it('a code no rule mentions falls through to the role matrix', async () => {
    const { svc } = build([], [], [rule({ permissionCode: 'crm.person.*' })]);
    await expect(svc.evaluateRules('u1', 'service.revenue.view')).resolves.toBe('NO_MATCH');
  });

  it('a rule scoped to a role the caller does not hold is skipped', async () => {
    const { svc } = build(
      [assignment('THU_NGAN', ['crm.person.view_sensitive'], 'COMPANY', 'co-1')],
      [],
      [rule({ roleCode: 'QT_HE_THONG' })],
    );
    await expect(svc.evaluateRules('u1', 'crm.person.view_sensitive')).resolves.toBe('NO_MATCH');
  });

  it('a blocked code is not advertised as held, and has no scope either', async () => {
    const { svc } = build(
      [assignment('DPO_DLCN', ['crm.person.view_sensitive'], 'GROUP', null)],
      [],
      [rule()],
    );
    const access = await svc.getEffectiveAccess('u1');
    expect(access.permissions).not.toContain('crm.person.view_sensitive');
    expect(access.denied).toEqual(['crm.person.view_sensitive']);
    await expect(svc.scopeLevelFor('u1', 'crm.person.view_sensitive')).resolves.toBe('NONE');
  });
});

describe('validity window — an expired grant stops existing on its own', () => {
  it('only asks the database for assignments that are in force', async () => {
    const { svc, findMany } = build([]);
    await svc.getGrants('u1');
    const where = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.validFrom).toBeDefined();
    expect(where.OR).toEqual([{ validTo: null }, { validTo: { gt: expect.any(Date) } }]);
  });

  /* CÁI BẪY của `grantInForce()`: nó mang một khoá `OR`, mà mệnh đề lọc luật ở `evaluateRules`
   * cũng có `OR` của riêng nó (`subjectUserId` đích danh hoặc `null` = áp cho mọi người). Hai
   * khoá `OR` trong cùng một object thì khoá sau ĐÈ khoá trước — không lỗi, không cảnh báo, mất
   * im lặng một nửa điều kiện.
   *
   * Mất khoá nào cũng hỏng, và hỏng ở tầng quyền:
   *   · mất `OR` chủ thể → luật nhắm đích danh người khác bị áp cho người này;
   *   · mất cửa sổ hiệu lực → luật DENY đã hết hạn vẫn chặn, luật ALLOW đã hết hạn vẫn mở.
   *
   * Cách viết đúng là `AND: [grantInForce(now)]`. Kiểm CẢ HAI còn nguyên trong một mệnh đề. */
  it('lọc luật giữ CẢ HAI: chủ thể và cửa sổ hiệu lực — không khoá nào đè khoá nào', async () => {
    const rules = vi.fn().mockResolvedValue([]);
    const svc = new PermissionsService({
      roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      scopeAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      accessRule: { findMany: rules },
      permission: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await svc.evaluateRules('u1', 'crm.person.view_sensitive');
    const where = rules.mock.calls[0]?.[0]?.where as Record<string, unknown>;

    expect(where.OR).toEqual([{ subjectUserId: 'u1' }, { subjectUserId: null }]);
    expect(where.AND).toEqual([
      {
        validFrom: { lte: expect.any(Date) },
        OR: [{ validTo: null }, { validTo: { gt: expect.any(Date) } }],
      },
    ]);
  });

  /* Phạm vi nghĩa trang (`scopeAssignment`) là TRỤC THỨ HAI của quyền hiệu dụng, và nó cũng có
   * `validTo`. Quên cửa sổ ở đây thì người đã bị gỡ phân công hôm qua vẫn phủ nghĩa trang đó hôm
   * nay — mà `validTo` sinh ra chính là để không ai phải nhớ đi thu hồi. */
  it('trục nghĩa trang cũng chỉ lấy phân công còn hiệu lực', async () => {
    const sites = vi.fn().mockResolvedValue([]);
    const svc = new PermissionsService({
      roleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      scopeAssignment: { findMany: sites },
      accessRule: { findMany: vi.fn().mockResolvedValue([]) },
      permission: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await svc.getEffectiveAccess('u1');
    const where = sites.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.userId).toBe('u1');
    expect(where.validFrom).toEqual({ lte: expect.any(Date) });
    expect(where.OR).toEqual([{ validTo: null }, { validTo: { gt: expect.any(Date) } }]);
  });
});

/* Phủ MÃ thôi chưa đủ — phạm vi của chính grant đó phải là thứ hệ THỰC THI được.
 *
 * `role_permissions.scope` mặc định `DEPARTMENT` và `role_assignments.scope` là cột tự do;
 * cả hai đều bị `broader()` ném về `NONE`. Nếu một grant như vậy vẫn được tính là "phủ mã"
 * thì công ty của dòng gán đó lọt vào tập — và vì `level` lấy mức RỘNG NHẤT từ các dòng
 * khác, công ty lẽ ra bị thu hẹp lại được với tới ở mức rộng hơn cả trước khi ai đó gõ
 * `DEPARTMENT` vào ô phạm vi.
 */
describe('scopeForCode — grant mang phạm vi hệ không thực thi được thì KHÔNG góp công ty', () => {
  const CODE = 'crm.customer.view';

  it('bỏ công ty của dòng gán mang scope DEPARTMENT, giữ công ty của dòng gán COMPANY', async () => {
    const { svc } = build([
      assignment('VAI_BI_THU_HEP', [CODE], 'DEPARTMENT', 'co-1'),
      assignment('THU_NGAN', [CODE], 'COMPANY', 'co-2'),
    ]);
    const scope = await svc.scopeForCode('u1', CODE);
    expect(scope.level).toBe('COMPANY');
    expect(scope.companyIds).toEqual(['co-2']);
  });

  it('chỉ có grant không thực thi được thì KHÔNG với tới công ty nào', async () => {
    const { svc } = build([assignment('VAI_BI_THU_HEP', [CODE], 'DEPARTMENT', 'co-1')]);
    const scope = await svc.scopeForCode('u1', CODE);
    expect(scope.level).toBe('NONE');
    expect(scope.companyIds).toEqual([]);
  });

  // Không phải "chặn tất cho chắc": ba mức thực thi được vẫn góp công ty như thường.
  for (const s of ['GROUP', 'COMPANY', 'SITE']) {
    it(`grant mức ${s} vẫn góp công ty của nó`, async () => {
      const { svc } = build([assignment('VAI', [CODE], s, 'co-9')]);
      const scope = await svc.scopeForCode('u1', CODE);
      expect(scope.level).toBe(s);
      expect(scope.companyIds).toEqual(['co-9']);
    });
  }
});
