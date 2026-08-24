import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateHoldDto {
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) customerId!: string;

  @ApiPropertyOptional({ description: 'Absolute expiry (ISO8601). Overrides holdMinutes.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Minutes from now until expiry (default 60)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  holdMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
