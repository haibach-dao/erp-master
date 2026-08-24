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
