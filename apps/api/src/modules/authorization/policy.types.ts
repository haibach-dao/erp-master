import type { Scope } from './scope.enum';

export interface PermissionGrant {
  permission: string; // module.resource.action (segments may be '*')
  scope: Scope;
}

export interface Subject {
  userId: string;
  departmentId?: string | null;
  companyId?: string | null;
  groupId?: string | null;
  assignedIds?: string[];
}

export interface ResourceTarget {
  id?: string | null;
  ownerId?: string | null;
  departmentId?: string | null;
  companyId?: string | null;
  groupId?: string | null;
}

export interface AccessRequest {
  permission: string;
  subject: Subject;
  target?: ResourceTarget;
}

// Resolver for grants whose scope is CUSTOM (backed by a ScopePolicy rule).
export type CustomScopeResolver = (req: AccessRequest, grant: PermissionGrant) => boolean;
