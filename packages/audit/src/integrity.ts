import { createHash } from 'node:crypto';

// Fields that go into an audit event's integrity hash. Chaining previousEventHash
// makes tampering detectable: altering an event breaks every later hash in the partition.
export interface HashableEvent {
  previousEventHash: string | null;
  occurredAt: string;
  companyId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: string;
  changedFields: string[];
  afterData: unknown;
}

export function computeEventHash(event: HashableEvent): string {
  return createHash('sha256').update(stableStringify(event)).digest('hex');
}

// Deterministic serialization (sorted keys) so the hash is stable across runs.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}
