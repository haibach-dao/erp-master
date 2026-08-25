/* Routes that currently ship WITHOUT a permission gate, each with the reason it is
 * still acceptable. This list is a ratchet, not a permanent exemption: PR-5 gates the
 * 45 business routes and shrinks this file to the 5 genuinely public/self routes.
 *
 * Adding an entry here is a deliberate, reviewable act. Forgetting a decorator is not
 * — and because PermissionGuard currently allows routes with no metadata, an ungated
 * route is an open door, which is exactly what this list makes visible in review.
 */

export const UNGATED_ROUTE_ALLOWLIST: Readonly<Record<string, string>> = {
  // --- Genuinely public or self-referential (stays here after PR-5) ---
  'GET /health': 'Liveness probe — không có dữ liệu nghiệp vụ',
  'POST /auth/login': 'Phải công khai để đăng nhập được',
  'POST /auth/refresh': 'Phải công khai — chỉ tiêu thụ refresh token',
  'POST /auth/logout': 'Tự thân: chỉ huỷ phiên của chính người gọi (JwtAuthGuard)',
  'GET /auth/me': 'Tự thân: chỉ trả hồ sơ của chính người gọi (JwtAuthGuard)',

  // --- Nợ kỹ thuật: sẽ được gate ở PR-5 (blueprint doc 16 §F) ---
  'POST /burials/deceased': 'PR-5 → burial.deceased.create',
  'POST /burials': 'PR-5 → burial.record.create',
  'POST /burials/:id/verify': 'PR-5 → burial.record.verify',
  'POST /burials/:id/complete': 'PR-5 → burial.record.complete',
  'GET /burials/:id': 'PR-5 → burial.record.view',
  'GET /burials': 'PR-5 → burial.record.view',
  'GET /cemetery/relationship-types': 'PR-5 → cemetery.reference.view',
  'POST /cemetery/companies': 'PR-5 → org.company.create',
  'GET /cemetery/companies': 'PR-5 → org.company.view',
  'POST /cemetery/cemeteries': 'PR-5 → cemetery.site.create',
  'GET /cemetery/cemeteries': 'PR-5 → cemetery.site.view',
  'POST /cemetery/grave-types': 'PR-5 → cemetery.grave_type.create',
  'GET /cemetery/grave-types': 'PR-5 → cemetery.grave_type.view',
  'POST /cemetery/grave-plots': 'PR-5 → cemetery.plot.create',
  'GET /cemetery/grave-plots': 'PR-5 → cemetery.plot.view',
  'POST /cemetery/grave-plots/:id/status': 'PR-5 → cemetery.plot.set_status',
  'GET /cemetery/grave-plots/:id/status-history': 'PR-5 → cemetery.plot.view_history',
  'POST /contracts': 'PR-5 → contract.record.create',
  'POST /contracts/:id/parties': 'PR-5 → contract.party.assign',
  'POST /contracts/:id/verify': 'PR-5 → contract.record.verify',
  'GET /contracts/:id': 'PR-5 → contract.record.view',
  'GET /contracts': 'PR-5 → contract.record.view',
  'POST /crm/persons': 'PR-5 → crm.person.create',
  'POST /crm/customers': 'PR-5 → crm.customer.create',
  'GET /crm/customers/search': 'PR-5 → crm.customer.search',
  'POST /crm/relationships': 'PR-5 → crm.relationship.create',
  'POST /crm/relationships/:id/end': 'PR-5 → crm.relationship.cancel',
  'GET /crm/persons/:id/relationships': 'PR-5 → crm.relationship.view',
  'POST /files/presign-upload': 'PR-5 → file.object.upload',
  'POST /files/:id/confirm': 'PR-5 → file.object.confirm',
  'GET /files/:id/download-url': 'PR-5 → file.object.download',
  'GET /files/:id': 'PR-5 → file.object.view',
  'POST /cemetery/grave-holds/:id/release': 'PR-5 → cemetery.hold.release',
  'GET /cemetery/grave-holds': 'PR-5 → cemetery.hold.view',
  'POST /services/catalog': 'PR-5 → service.catalog.create',
  'GET /services/catalog': 'PR-5 → service.catalog.view',
  'POST /services/subscriptions': 'PR-5 → service.subscription.create',
  'POST /services/subscriptions/:id/renew': 'PR-5 → service.subscription.renew',
  'POST /services/subscriptions/:id/cancel': 'PR-5 → service.subscription.cancel',
  'GET /services/subscriptions': 'PR-5 → service.subscription.view',
  'GET /services/revenue': 'PR-5 → service.revenue.view',
};
