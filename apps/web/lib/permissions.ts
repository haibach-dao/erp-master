import type { AuthUser } from './api';

/* Client-side view of what the caller may do, from /auth/me.
 *
 * This is a COURTESY, never a control. Every one of these codes is checked again by the
 * guard on the server for every request, so a client that ignores this file — or edits
 * it in devtools — gains exactly nothing. Its only job is to avoid showing a menu item
 * that would answer 403.
 *
 * It also cannot be perfectly faithful: the server refuses to let a wildcard grant reach
 * a `wildcard_exempt` leaf, and the client is not told which leaves those are. So `can()`
 * is deliberately OPTIMISTIC about wildcards — it may show something the server then
 * refuses. Wrong in the harmless direction; the reverse would hide work people can do.
 */
export function can(user: AuthUser | null, code: string): boolean {
  if (user === null) {
    return false;
  }
  return user.permissions.some((granted) => matches(granted, code));
}

export function canAny(user: AuthUser | null, codes: string[]): boolean {
  return codes.some((code) => can(user, code));
}

function matches(granted: string, requested: string): boolean {
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

/** Whether a company is inside the caller's scope. GROUP means no restriction at all. */
export function canSeeCompany(user: AuthUser | null, companyId: string): boolean {
  if (user === null) {
    return false;
  }
  return user.scope.unrestricted || user.scope.companyIds.includes(companyId);
}
