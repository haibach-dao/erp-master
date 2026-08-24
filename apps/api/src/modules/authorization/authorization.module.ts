import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';

// Provides the pure policy evaluator. Concrete permission/role seeding and DB-backed
// grant loading come later (needs org module + Gate 0 decisions on the permission set).
@Global()
@Module({
  providers: [PolicyEvaluator],
  exports: [PolicyEvaluator],
})
export class AuthorizationModule {}
