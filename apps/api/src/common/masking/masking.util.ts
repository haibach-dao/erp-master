// Mask sensitive values before they enter audit snapshots or logs.
// Keys matching this pattern have their values masked (e.g. CCCD -> 079***123).
const SENSITIVE_KEY_PATTERN =
  /(national_?id|cccd|ssn|passport|password|secret|token|refresh_?token|access_?token)/i;

export function maskValue(value: string): string {
  if (value.length <= 6) {
    return '***';
  }
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function maskSensitive(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => maskSensitive(item));
  }
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = typeof value === 'string' ? maskValue(value) : '***';
      } else {
        out[key] = maskSensitive(value);
      }
    }
    return out;
  }
  return data;
}
