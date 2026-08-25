import type { Scope } from './scope.enum';

export interface PermissionGrant {
  permission: string; // module.resource.action (segments may be '*')
  scope: Scope;
}

export interface Subject {
  userId: string;
  departmentId?: string | null;
  /** Companies the caller is bound to. Empty means bound to none, never to all. */
  companyIds?: string[];
  /** Cemeteries the caller covers — the hub axis, from authz.scope_assignments. */
  siteIds?: string[];
  assignedIds?: string[];
}

export interface ResourceTarget {
  id?: string | null;
  ownerId?: string | null;
  departmentId?: string | null;
  companyId?: string | null;
  /** The cemetery a record belongs to (GravePlot.cemeteryId and friends). */
  siteId?: string | null;
}

export interface AccessRequest {
  permission: string;
  subject: Subject;
  target?: ResourceTarget;
}

// Resolver for grants whose scope is CUSTOM (backed by a ScopePolicy rule).
export type CustomScopeResolver = (req: AccessRequest, grant: PermissionGrant) => boolean;
