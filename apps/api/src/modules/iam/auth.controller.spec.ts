import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';

// A rate limit that is silently not wired is worse than none: /auth/login stays an
// unmetered password oracle while the code reads as protected. This asserts the guard
// is actually attached; the limit values themselves live in app.module.ts.
describe('AuthController rate limiting', () => {
  it('registers ThrottlerGuard on the credential controller', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, AuthController) ?? [];
    expect(guards).toContain(ThrottlerGuard);
  });
});
