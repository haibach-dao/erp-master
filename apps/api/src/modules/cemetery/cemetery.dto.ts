import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
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

export class AssignUsageRightDto {
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) holderCustomerId!: string;
  @ApiPropertyOptional({ description: 'Ngày bắt đầu đứng tên; mặc định hôm nay' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
  @ApiPropertyOptional({ description: 'Vì sao gán tay, không qua hợp đồng' })
  @IsOptional()
  @IsString()
  note?: string;
}

/* Thu hồi và sang tên đều BẮT BUỘC có lý do.
 *
 * Bắt buộc ở DTO chứ không ở cột CSDL: bản ghi cũ không mang lý do, và ép NOT NULL là
 * phải bịa lý do cho chúng. Ở đây thì mọi lần thao tác TỪ NAY đều phải nói vì sao — hai
 * việc này tước quyền của một người, nên "vì sao" không được để trống.
 */
export class ReleaseUsageRightDto {
  @ApiProperty({ description: 'Vì sao thu hồi' })
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class TransferUsageRightDto {
  @ApiProperty({ description: 'Khách hàng nhận sang tên — phải còn sống' })
  @IsString()
  @MinLength(1)
  toCustomerId!: string;

  @ApiProperty({ description: 'Vì sao sang tên: thừa kế, chuyển nhượng, sửa sai...' })
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiPropertyOptional({ description: 'Ngày chủ mới bắt đầu đứng tên; mặc định hôm nay' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}
