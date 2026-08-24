import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCatalogDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty({ description: 'VND (integer đồng)' }) @IsInt() @Min(0) price!: number;
  @ApiProperty({ description: 'Service period in months' })
  @IsInt()
  @Min(1)
  durationMonths!: number;
  @ApiPropertyOptional({ description: 'Reminder milestones in days (default 90/60/30/7)' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  reminderDays?: number[];
}

export class SubscribeDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) serviceCatalogId!: string;
  @ApiProperty() @IsString() @MinLength(1) customerId!: string;
  @ApiProperty({ description: 'ISO date' }) @IsISO8601() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractId?: string;
  @ApiPropertyOptional({ description: 'Override agreed price (VND); default = catalog price' })
  @IsOptional()
  @IsInt()
  @Min(0)
  agreedPrice?: number;
}

export class RenewDto {
  @ApiPropertyOptional({ description: 'ISO date; default = previous effectiveTo' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}
