import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublicRoute';

/* Marks a route as deliberately reachable without a permission.
 *
 * Today PermissionGuard lets an undecorated route through, so this decorator is a
 * DECLARATION, not yet an enforcement point: it separates "nobody gated this" from
 * "somebody decided this needs no gate". When the guard flips to deny-by-default it
 * becomes the only way a route stays open, which is why it has to exist first.
 *
 * Use it only for routes that must work with no identity at all (liveness probe, the
 * login and refresh endpoints). A route that needs a token but no permission — /auth/me,
 * /auth/logout — is NOT public: it keeps JwtAuthGuard and simply declares no permission.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
