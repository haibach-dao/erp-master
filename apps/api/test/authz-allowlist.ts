/* Routes that ship WITHOUT a permission gate, each with the reason it is acceptable.
 *
 * This list is a ratchet. Every business route is gated; what remains is the pair that
 * needs a valid token but no permission, because each acts only on the caller's own
 * session. The genuinely token-free routes (/health, login, refresh) are not here —
 * they carry @Public(), which is a decision recorded in the code itself.
 *
 * Adding an entry is a deliberate, reviewable act. Forgetting a decorator is not, and
 * while PermissionGuard still allows undecorated routes, a forgotten decorator is an
 * open door — which is what the invariant test makes visible in review.
 */

export const UNGATED_ROUTE_ALLOWLIST: Readonly<Record<string, string>> = {
  'POST /auth/logout': 'Tự thân: chỉ huỷ phiên của chính người gọi (JwtAuthGuard)',
  'GET /auth/me': 'Tự thân: chỉ trả hồ sơ của chính người gọi (JwtAuthGuard)',
};
