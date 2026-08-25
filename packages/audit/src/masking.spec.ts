import { describe, expect, it } from 'vitest';
import { maskSensitive, maskValue } from './masking';

describe('maskValue', () => {
  it('masks a CCCD keeping first/last 3', () => {
    expect(maskValue('079123456789')).toBe('079***789');
  });

  it('fully masks short values', () => {
    expect(maskValue('12345')).toBe('***');
  });
});

describe('maskSensitive', () => {
  it('masks sensitive keys and leaves others intact', () => {
    const input = {
      fullName: 'Nguyen Van A',
      nationalId: '079123456789',
      password: 'supersecret',
      nested: { access_token: 'abcdef123456', note: 'ok' },
    };
    const out = maskSensitive(input) as Record<string, unknown>;
    expect(out.fullName).toBe('Nguyen Van A');
    expect(out.nationalId).toBe('079***789');
    expect(out.password).toBe('sup***ret');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.access_token).toBe('abc***456');
    expect(nested.note).toBe('ok');
  });

  it('handles arrays and nullish', () => {
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive([{ ssn: '123456789' }])).toEqual([{ ssn: '123***789' }]);
  });
});
