// Data scopes, from narrowest to broadest. A grant's scope bounds which records a
// permission applies to. CUSTOM defers to a named ScopePolicy / resolver.
export const SCOPES = ['SELF', 'ASSIGNED', 'DEPARTMENT', 'COMPANY', 'GROUP', 'CUSTOM'] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
