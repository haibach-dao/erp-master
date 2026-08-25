import { describe, expect, it } from 'vitest';
import { computeEventHash, stableStringify, type HashableEvent } from './integrity';

const base: HashableEvent = {
  previousEventHash: null,
  occurredAt: '2026-08-24T00:00:00.000Z',
  companyId: 'c1',
  actorType: 'SYSTEM',
  actorId: null,
  action: 'TEST.CREATED',
  entityType: 'test',
  entityId: 'x1',
  result: 'SUCCESS',
  changedFields: [],
  afterData: null,
};

describe('computeEventHash', () => {
  it('is deterministic and key-order independent', () => {
    const h1 = computeEventHash(base);
    const h2 = computeEventHash({ ...base });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when any field changes', () => {
    expect(computeEventHash(base)).not.toBe(computeEventHash({ ...base, action: 'TEST.UPDATED' }));
    expect(computeEventHash(base)).not.toBe(
      computeEventHash({ ...base, previousEventHash: 'abc' }),
    );
  });
});

describe('stableStringify', () => {
  it('sorts object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
