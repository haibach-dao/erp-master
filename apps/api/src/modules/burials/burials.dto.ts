import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateDeceasedDto {
  @ApiProperty() @IsString() @MinLength(1) personId!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateOfDeath?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deathCertFileId?: string;
}

export class CreateBurialDto {
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) deceasedPersonId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractId?: string;

  /* Cốt số mấy trong phần mộ. Tuỳ chọn: hồ sơ chưa xác định vị trí vẫn tạo được, và bịa
   * một số cho nó là ghi vào hệ một sự thật chưa ai xác nhận. Có số thì service kiểm nằm
   * trong sức chứa và chưa ai chiếm. */
  @ApiPropertyOptional({ description: 'Cốt số mấy (1..sức chứa)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  slotNumber?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() burialDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() legalDocFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
