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

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
  /** Codes explicitly denied for this caller. Deny beats allow, always. */
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
   * Because nothing narrows, the explicit deny table is the only remaining brake.
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

  /* Scope level for ONE code — union across the grants that actually cover that code.
   *
   * Union has to be computed per code, never once for the whole caller. A single global
   * "widest level" leaks: someone holding a group-wide read-only audit role alongside a
   * company-level operational role would get group reach on the OPERATIONAL codes too,
   * which the audit role never granted them. Union means "add up what each role gives",
   * not "take the widest thing you hold anywhere and apply it everywhere".
   */
  async scopeLevelFor(userId: string, code: string): Promise<ScopeLevel> {
    if (await this.isDenied(userId, code)) {
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

  /* Codes explicitly denied for this caller, right now.
   *
   * Deny wins over any grant. `subject_user_id = null` denies for everybody — the shape
   * used for a leaf nobody may hold. This exists for the constitution's forbidden lane:
   * with a union rule, and an administrator who may widen their own role, an explicit
   * deny is the last thing standing between a role and data it must never read.
   */
  async deniedCodes(userId: string): Promise<string[]> {
    const now = new Date();
    const rows = await this.prisma.permissionDeny.findMany({
      where: {
        OR: [{ subjectUserId: userId }, { subjectUserId: null }],
        validFrom: { lte: now },
        AND: [{ OR: [{ validTo: null }, { validTo: { gt: now } }] }],
      },
      select: { permissionCode: true },
    });
    return [...new Set(rows.map((r) => r.permissionCode))].sort();
  }

  /** True when an explicit deny covers this code. Checked before any grant is consulted. */
  async isDenied(userId: string, code: string): Promise<boolean> {
    const denied = await this.deniedCodes(userId);
    return denied.some((pattern) => permissionMatches(pattern, code));
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
    const [assignments, sites, denied] = await Promise.all([
      this.activeAssignments(userId),
      this.prisma.scopeAssignment.findMany({
        where: {
          userId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        select: { cemeteryId: true },
      }),
      this.deniedCodes(userId),
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

    // A denied code must not be advertised to the UI as something the caller holds.
    const isDenied = (code: string): boolean => denied.some((d) => permissionMatches(d, code));

    return {
      roles: [...roles].sort(),
      permissions: [...permissions].filter((c) => !isDenied(c)).sort(),
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
