import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDeceasedDto {
  @ApiProperty() @IsString() @MinLength(1) personId!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateOfDeath?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deathCertFileId?: string;
}

export class CreateBurialDto {
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) deceasedPersonId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contractId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() burialDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() legalDocFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
