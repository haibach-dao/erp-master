// Data scopes, from narrowest to broadest. A grant's scope bounds which records a
// permission applies to. CUSTOM defers to a named ScopePolicy / resolver.
//
// SITE (một nghĩa trang) is the narrowest scope the cemetery business actually needs,
// and the role matrix seeds it. PolicyEvaluator does NOT implement `case 'SITE'` yet —
// that lands with the rest of the scope wiring, together with `siteId` on Subject and
// ResourceTarget (blueprint doc 16 §D.10, PR-10). Until then the evaluator's `default`
// branch denies it, which is fail-CLOSED and harmless because nothing calls the
// evaluator on the request path yet. Seeding the real intent beats seeding COMPANY and
// letting a reviewer believe a site-bound role is site-bound when it is not.
export const SCOPES = [
  'SELF',
  'ASSIGNED',
  'DEPARTMENT',
  'SITE',
  'COMPANY',
  'GROUP',
  'CUSTOM',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/* Ba mức hệ THỰC THI được — khai đúng một lần, ở đây.
 *
 * `SCOPES` là những gì hệ KHAI; đây là những gì hệ LÀM. Bốn mức còn lại
 * (SELF/ASSIGNED/DEPARTMENT/CUSTOM) có mặt trong danh sách khai nhưng không có đường thực
 * thi ở tầng phạm vi: `broader()` ném chúng về `NONE`.
 *
 * VÌ SAO PHẢI CÓ HÀM NÀY, VÀ VÌ SAO Ở ĐÂY: từ 16/09/2026 mức `NONE` là TỪ CHỐI. Cộng với
 * chuyện cột `role_permissions.scope` mặc định `DEPARTMENT` và màn hình ma trận trước đây
 * nhận MỌI giá trị trong `SCOPES`, một lần bấm trên giao diện đủ để khoá chết một mã quyền
 * cho mọi người giữ vai đó — người dùng ăn 403 mà không ai thấy nguyên nhân, vì `PermissionGuard`
 * vẫn cho qua (nó hỏi mã, không hỏi phạm vi). Đường GHI phải từ chối thứ đường ĐỌC không
 * thực thi được; hai bên dùng CHUNG danh sách này nên không lệch nhau được.
 */
export const ENFORCED_SCOPES = ['GROUP', 'COMPANY', 'SITE'] as const;

export type EnforcedScope = (typeof ENFORCED_SCOPES)[number];

export function isEnforcedScope(value: string): value is EnforcedScope {
  return (ENFORCED_SCOPES as readonly string[]).includes(value);
}
