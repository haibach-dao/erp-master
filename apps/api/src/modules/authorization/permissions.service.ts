import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionGrant } from './policy.types';
import { permissionMatches } from './policy-evaluator';
import { isScope, type Scope } from './scope.enum';

export interface PermissionMeta {
  code: string;
  wildcardExempt: boolean;
  sensitivity: string;
}

/* The broadest scope level a caller holds. NONE means they hold no usable scope at all
 * and therefore reach no records — which is what someone with no assignment gets.
 *
 * The LEVEL has to be reported, not just "restricted or not". A caller whose reach is
 * meant to stop at specific cemeteries but who has not been given any yet must reach
 * NOTHING; without the level, an empty site list is indistinguishable from "this role is
 * not site-bound", and the safe reading and the dangerous one swap places.
 */
export type ScopeLevel = 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';

/* Outcome of the ordered rule chain for one code.
 * NO_MATCH means no rule mentioned it, so the role matrix decides.
 */
export type Ruling = 'ALLOW' | 'DENY' | 'NO_MATCH';

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
  /** Codes a DENY rule blocks for this caller, with no ALLOW ahead of it. */
  denied: string[];
  scope: {
    /** Highest level held on ANY code. For display; per-code decisions use scopeLevelFor. */
    level: ScopeLevel;
    /** A GROUP-scoped grant means "no record restriction" — every company, every site. */
    unrestricted: boolean;
    /** Companies this user is bound to. Empty + not unrestricted = bound to nothing. */
    companyIds: string[];
    /** Cemeteries this user covers (authz.scope_assignments) — the hub axis. */
    siteIds: string[];
  };
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /* Effective grants for a user: every role_permission of every role assigned to them,
   * limited to the assignments that are in force right now.
   *
   * Combination rule is UNION — decided by the business owner. Holding two roles adds
   * their rights together; nothing narrows. Note what that does and does not mean: the
   * constitution's "smallest intersection" is about the axes of ONE TRANSACTION (person ∩
   * agent ∩ device ∩ data layer ∩ action ∩ destination), not about how one person's
   * several roles combine. Union across roles is ordinary RBAC.
   *
   * Because nothing narrows, the ordered rule chain is the only remaining brake.
   */
  async getGrants(userId: string): Promise<PermissionGrant[]> {
    const assignments = await this.activeAssignments(userId);
    const grants: PermissionGrant[] = [];
    for (const a of assignments) {
      for (const rp of a.role.rolePermissions) {
        const scopeStr = a.scope ?? rp.scope;
        const scope: Scope = isScope(scopeStr) ? scopeStr : 'CUSTOM';
        grants.push({ permission: rp.permission.code, scope });
      }
    }
    return grants;
  }

  /* Người này có cầm mã `code` không — dùng cho LỚP CHE trường và cho việc ghi nhật ký
   * "bản đầy đủ có rời khỏi hệ hay không".
   *
   * Tách ra thành hàm riêng vì có hai nơi phải trả lời CÙNG một câu hỏi và phải trả lời
   * GIỐNG NHAU: `MaskingInterceptor` quyết che hay không che, còn `CardsService` ghi vào
   * nhật ký rằng thẻ vừa in có CCCD đầy đủ hay không. Hai nơi tự kiểm thì sẽ có ngày một
   * bên nói che còn bên kia ghi là không che — và nhật ký sai còn tệ hơn không có nhật ký.
   *
   * FAIL CLOSED: mã không có trong danh mục trả về false, tức là VẪN CHE.
   *
   * GIỚI HẠN CÓ CHỦ ĐÍCH: hàm này KHÔNG đi qua chuỗi luật truy cập (`evaluateRules`), khác
   * với `scopeLevelFor`. Giữ nguyên hành vi vốn có của lớp che — một luật DENY hiện không
   * che thêm trường nào. Đổi điều đó là một quyết định riêng, không phải hệ quả phụ của
   * việc gom hai chỗ kiểm về một chỗ.
   */
  async holdsForMasking(userId: string, code: string): Promise<boolean> {
    const meta = await this.getPermissionMeta(code);
    if (meta === null) {
      return false;
    }
    const grants = await this.getGrants(userId);
    return grants.some((g) =>
      permissionMatches(g.permission, code, { wildcardExempt: meta.wildcardExempt }),
    );
  }

  /* Scope level for ONE code — union across the grants that actually cover that code.
   *
   * Union has to be computed per code, never once for the whole caller. A single global
   * "widest level" leaks: someone holding a group-wide read-only audit role alongside a
   * company-level operational role would get group reach on the OPERATIONAL codes too,
   * which the audit role never granted them. Union means "add up what each role gives",
   * not "take the widest thing you hold anywhere and apply it everywhere".
   */
  async scopeLevelFor(userId: string, code: string): Promise<ScopeLevel> {
    const ruling = await this.evaluateRules(userId, code);
    if (ruling === 'DENY') {
      return 'NONE';
    }
    const meta = await this.getPermissionMeta(code);
    const grants = await this.getGrants(userId);
    let level: ScopeLevel = 'NONE';
    for (const g of grants) {
      const covers = permissionMatches(g.permission, code, {
        ...(meta === null ? {} : { wildcardExempt: meta.wildcardExempt }),
      });
      if (covers) {
        level = broader(level, g.scope);
      }
    }
    return level;
  }

  /* Walk the ordered rule chain for one code — firewall semantics.
   *
   * Rules are evaluated by ascending priority, and the FIRST one that matches decides;
   * evaluation stops there. Nothing matched means NO_MATCH, and the role matrix answers
   * instead. Nothing granted after that means 403 — the implicit "deny all" at the end
   * of the chain, which PermissionGuard provides by refusing anything it was not told
   * to allow.
   *
   * Consequence worth being explicit about: an ALLOW rule sits ABOVE the role matrix, so
   * it can permit something no role grants — including a wildcard-exempt leaf. That is
   * inherent to an ordered rule list, which is why every rule carries a reason and why
   * the chain is printable in evaluation order.
   */
  async evaluateRules(userId: string, code: string): Promise<Ruling> {
    const now = new Date();
    const [rules, roles] = await Promise.all([
      this.prisma.accessRule.findMany({
        where: {
          OR: [{ subjectUserId: userId }, { subjectUserId: null }],
          validFrom: { lte: now },
          AND: [{ OR: [{ validTo: null }, { validTo: { gt: now } }] }],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      this.roleCodesOf(userId),
    ]);

    for (const rule of rules) {
      if (rule.roleCode !== null && !roles.includes(rule.roleCode)) {
        continue;
      }
      if (!permissionMatches(rule.permissionCode, code)) {
        continue;
      }
      return rule.effect === 'ALLOW' ? 'ALLOW' : 'DENY';
    }
    return 'NO_MATCH';
  }

  /** True when the rule chain lands on DENY for this code. */
  async isDenied(userId: string, code: string): Promise<boolean> {
    return (await this.evaluateRules(userId, code)) === 'DENY';
  }

  /** Codes the chain currently blocks, evaluated against the catalog the caller holds. */
  private async deniedAmong(userId: string, codes: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const code of codes) {
      if ((await this.evaluateRules(userId, code)) === 'DENY') {
        out.push(code);
      }
    }
    return out.sort();
  }

  private async roleCodesOf(userId: string): Promise<string[]> {
    const assignments = await this.activeAssignments(userId);
    return [...new Set(assignments.map((a) => a.role.code))];
  }

  /* Catalog metadata for one code, or null when the code is not in the catalog at all.
   *
   * Read on every request on purpose — no cache. A revoked right has to stop working
   * immediately; OPERA's equivalent can take minutes to propagate and that is a property
   * to beat, not to copy. If a cache is ever added it needs a very short TTL and must
   * never hold a sensitive leaf (doc 16 §B.3).
   */
  async getPermissionMeta(code: string): Promise<PermissionMeta | null> {
    const row = await this.prisma.permission.findUnique({
      where: { code },
      select: { code: true, wildcardExempt: true, sensitivity: true },
    });
    return row;
  }

  /* Everything the UI and the pickers need, in one round trip.
   *
   * Deliberately derived here rather than trusted from the client: the web app used to
   * ask the user to type a companyId, which is the same as letting the caller choose
   * their own scope. The lists below are what the server is willing to accept from them.
   */
  async getEffectiveAccess(userId: string): Promise<EffectiveAccess> {
    const now = new Date();
    const [assignments, sites] = await Promise.all([
      this.activeAssignments(userId),
      this.prisma.scopeAssignment.findMany({
        where: {
          userId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        select: { cemeteryId: true },
      }),
    ]);

    const roles = new Set<string>();
    const permissions = new Set<string>();
    const companyIds = new Set<string>();
    let level: ScopeLevel = 'NONE';

    for (const a of assignments) {
      roles.add(a.role.code);
      for (const rp of a.role.rolePermissions) {
        permissions.add(rp.permission.code);
        level = broader(level, a.scope ?? rp.scope);
      }
      if (a.companyId !== null) {
        companyIds.add(a.companyId);
      }
    }

    // A blocked code must not be advertised to the UI as something the caller holds.
    const denied = await this.deniedAmong(userId, [...permissions]);
    const denySet = new Set(denied);

    return {
      roles: [...roles].sort(),
      permissions: [...permissions].filter((c) => !denySet.has(c)).sort(),
      denied,
      scope: {
        level,
        unrestricted: level === 'GROUP',
        companyIds: [...companyIds].sort(),
        siteIds: sites.map((s) => s.cemeteryId).sort(),
      },
    };
  }

  /* Assignments in force right now. An expired grant simply stops existing — nobody has
   * to remember to go and revoke it, which is the entire point of having a `valid_to`.
   */
  private activeAssignments(userId: string) {
    const now = new Date();
    return this.prisma.roleAssignment.findMany({
      where: {
        userId,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
  }
}

// Union rule: the widest scope among the grants that cover the code in question.
const RANK: Record<string, number> = { NONE: 0, SITE: 1, COMPANY: 2, GROUP: 3 };

function broader(current: ScopeLevel, candidate: string): ScopeLevel {
  const next: ScopeLevel =
    candidate === 'GROUP' || candidate === 'COMPANY' || candidate === 'SITE' ? candidate : 'NONE';
  return (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current;
}
