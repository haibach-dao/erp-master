import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
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

/* Toạ độ sơ đồ mặt bằng. Hệ CỤC BỘ theo từng nghĩa trang, đơn vị mét — không phải kinh/vĩ
 * độ, nên không ràng buộc [-180,180]. Cho phép null tường minh để gỡ một mộ khỏi sơ đồ mà
 * không phải xoá bản ghi.
 */
export class SetPlotPositionDto {
  @ApiPropertyOptional({ description: 'Toạ độ X cục bộ (mét); null để gỡ khỏi sơ đồ' })
  @IsOptional()
  @IsNumber()
  mapX?: number | null;

  @ApiPropertyOptional({ description: 'Toạ độ Y cục bộ (mét); null để gỡ khỏi sơ đồ' })
  @IsOptional()
  @IsNumber()
  mapY?: number | null;
}
