import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateContractDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) contractNo!: string;
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() signedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() validTo?: string;
  @ApiPropertyOptional({ description: 'VND (integer đồng)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAmount?: number;
}

export class AddPartyDto {
  @ApiProperty() @IsString() @MinLength(1) customerId!: string;
  @ApiProperty({ enum: ['OWNER', 'SIGNER', 'CONTACT'] })
  @IsIn(['OWNER', 'SIGNER', 'CONTACT'])
  role!: string;
}

/* Huỷ hợp đồng BẮT BUỘC có lý do.
 *
 * Huỷ kéo theo chấm dứt quyền sử dụng và nhả phần mộ về trống — ba hệ quả cho một lần
 * bấm. Sáu tháng sau nhìn lại mà không có lý do thì không ai nói được vì sao mộ này từng
 * có chủ rồi lại trống.
 */
export class CancelContractDto {
  @ApiProperty({ description: 'Vì sao huỷ hợp đồng' })
  @IsString()
  @MinLength(3)
  reason!: string;
}
