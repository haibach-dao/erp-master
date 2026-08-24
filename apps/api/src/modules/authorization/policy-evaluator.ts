import { Injectable } from '@nestjs/common';
import type {
  AccessRequest,
  CustomScopeResolver,
  PermissionGrant,
  ResourceTarget,
  Subject,
} from './policy.types';
import type { Scope } from './scope.enum';

// Whether a granted permission code covers a requested one. Segments equal, or a
// granted '*' wildcard matches any segment: `cemetery.*.view` covers `cemetery.grave.view`.
export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === requested) {
    return true;
  }
  const g = granted.split('.');
  const r = requested.split('.');
  if (g.length !== r.length) {
    return false;
  }
  return g.every((seg, i) => seg === '*' || seg === r[i]);
}

@Injectable()
export class PolicyEvaluator {
  // Allow if ANY grant both matches the permission and satisfies its scope against the target.
  // Authorization must be enforced here (service layer), never by hiding UI only.
  can(req: AccessRequest, grants: PermissionGrant[], custom?: CustomScopeResolver): boolean {
    return grants.some(
      (grant) =>
        permissionMatches(grant.permission, req.permission) && this.scopeAllows(grant, req, custom),
    );
  }

  private scopeAllows(
    grant: PermissionGrant,
    req: AccessRequest,
    custom?: CustomScopeResolver,
  ): boolean {
    const scope: Scope = grant.scope;
    const subject: Subject = req.subject;
    const target: ResourceTarget | undefined = req.target;

    switch (scope) {
      case 'COMPANY':
        return eq(target?.companyId, subject.companyId);
      case 'DEPARTMENT':
        return eq(target?.departmentId, subject.departmentId);
      case 'GROUP':
        return eq(target?.groupId, subject.groupId);
      case 'SELF':
        return eq(target?.ownerId, subject.userId);
      case 'ASSIGNED':
        return (
          target?.id != null &&
          subject.assignedIds !== undefined &&
          subject.assignedIds.includes(target.id)
        );
      case 'CUSTOM':
        return custom !== undefined && custom(req, grant);
      default:
        return false;
    }
  }
}

// Equal AND both present (a null/undefined on either side never grants access).
function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && a === b;
}
