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
