import { Injectable } from '@nestjs/common';
import type {
  AccessRequest,
  CustomScopeResolver,
  PermissionGrant,
  ResourceTarget,
  Subject,
} from './policy.types';
import type { Scope } from './scope.enum';

/* Whether a granted permission code covers a requested one. Segments equal, or a
 * granted '*' wildcard matches any segment: `cemetery.*.view` covers `cemetery.grave.view`.
 *
 * `wildcardExempt` is how an S3 leaf refuses to be swept up by a wildcard. Without it a
 * grant of `cemetery.*.*` silently carries every future cemetery leaf with it — including
 * ones added years later by someone who never saw the grant. An exempt leaf can only be
 * reached by naming it, which is the point: unmasking personal data, giving a contract
 * legal effect or reading revenue should never be something a role acquired by accident.
 */
export function permissionMatches(
  granted: string,
  requested: string,
  options: { wildcardExempt?: boolean } = {},
): boolean {
  if (granted === requested) {
    return true;
  }
  if (options.wildcardExempt === true && granted.includes('*')) {
    return false;
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
      /* GROUP means NO RECORD RESTRICTION — decided by the business owner, and the only
       * reading the data supports: there is no `group_id` column anywhere in the schema,
       * so the previous implementation (compare target.groupId to subject.groupId) could
       * only ever return false. Wiring this evaluator up without fixing that would have
       * refused every request from the top-level roles. */
      case 'GROUP':
        return true;
      case 'COMPANY':
        return includes(subject.companyIds, target?.companyId);
      case 'SITE':
        return includes(subject.siteIds, target?.siteId);
      case 'SELF':
        return eq(target?.ownerId, subject.userId);
      case 'DEPARTMENT':
        return eq(target?.departmentId, subject.departmentId);
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

// The target must name a value AND the subject must hold it. An unknown target or an
// empty subject list denies — being assigned to nothing must never mean everything.
function includes(held: string[] | undefined, value: string | null | undefined): boolean {
  return value != null && held !== undefined && held.includes(value);
}
