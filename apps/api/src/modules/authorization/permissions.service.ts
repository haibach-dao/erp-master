import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionGrant } from './policy.types';
import { isScope, type Scope } from './scope.enum';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Effective grants for a user = every role_permission of every role assigned to them.
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
}
