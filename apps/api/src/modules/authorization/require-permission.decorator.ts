import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

// Mark a route as requiring a permission (module.resource.action). Enforced by PermissionGuard.
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);
