import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';

// Foundation-stage env validation: lenient (missing optional vars do not crash the
// skeleton). Tighten to required as modules start depending on each variable.
class EnvVars {
  @IsOptional()
  @IsString()
  APP_ENV?: string;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;
}

export function validate(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: true });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return validated;
}
