import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionGrant } from './policy.types';
import { isScope, type Scope } from './scope.enum';

export interface PermissionMeta {
  code: string;
  wildcardExempt: boolean;
  sensitivity: string;
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
}
