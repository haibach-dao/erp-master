import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { GRAVE_PLOT_STATUSES } from './cemetery.constants';

export class CreateCompanyDto {
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
}

export class CreateCemeteryDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
}

export class CreateGraveTypeDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) defaultCapacity?: number;
  @ApiPropertyOptional({ description: 'VND (integer đồng)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  referencePrice?: number;
}

export class CreateGravePlotDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) cemeteryId!: string;
  @ApiProperty() @IsString() @MinLength(1) graveTypeId!: string;
  @ApiProperty() @IsString() @MinLength(1) plotCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subzone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() block?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() row?: string;
  @ApiPropertyOptional({ description: 'Override capacity; null uses grave type default' })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacityOverride?: number;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: GRAVE_PLOT_STATUSES })
  @IsIn(GRAVE_PLOT_STATUSES)
  toStatus!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
