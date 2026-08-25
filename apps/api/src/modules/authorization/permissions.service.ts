import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionGrant } from './policy.types';
import { isScope, type Scope } from './scope.enum';

export interface PermissionMeta {
  code: string;
  wildcardExempt: boolean;
  sensitivity: string;
}

/* What a caller may do, and where. Two axes kept apart on purpose: holding a permission
 * says nothing about which records it reaches, and the effective right is the
 * INTERSECTION of the two (blueprint doc 16 §D.2).
 */
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
  scope: {
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

  // Effective grants for a user = every role_permission of every role assigned to them.
  //
  // Known gap, deliberately left for the scope work: this is a UNION, so somebody holding
  // two roles ends up with the WIDEST scope rather than the narrowest, there is no
  // validity window, and there is no explicit deny. Nothing may lean on the `scope` field
  // for a security decision until that is fixed (doc 16 §D.10).
  async getGrants(userId: string): Promise<PermissionGrant[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
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
    const [assignments, sites] = await Promise.all([
      this.prisma.roleAssignment.findMany({
        where: { userId },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      }),
      this.prisma.scopeAssignment.findMany({
        where: { userId },
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

    return {
      roles: [...roles].sort(),
      permissions: [...permissions].sort(),
      scope: {
        level,
        unrestricted: level === 'GROUP',
        companyIds: [...companyIds].sort(),
        siteIds: sites.map((s) => s.cemeteryId).sort(),
      },
    };
  }
}

/* Widest wins, matching the union rule in getGrants above. That is the CURRENT rule and
 * it is the wrong way round — the constitution asks for the narrowest intersection, so a
 * person holding two roles should be bounded by the tighter one. Changing it is a
 * separate step with its own blast radius; until then this function is honest about what
 * the system actually does rather than about what it should do.
 */
const RANK: Record<string, number> = { NONE: 0, SITE: 1, COMPANY: 2, GROUP: 3 };

function broader(current: ScopeLevel, candidate: string): ScopeLevel {
  const next: ScopeLevel =
    candidate === 'GROUP' || candidate === 'COMPANY' || candidate === 'SITE' ? candidate : 'NONE';
  return (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current;
}
