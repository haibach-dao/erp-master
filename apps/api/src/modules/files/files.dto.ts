import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class PresignUploadDto {
  @ApiProperty() @IsString() @MinLength(1) fileName!: string;
  @ApiProperty() @IsString() @MinLength(1) mimeType!: string;
  @ApiPropertyOptional({ enum: ['normal', 'confidential', 'restricted'] })
  @IsOptional()
  @IsIn(['normal', 'confidential', 'restricted'])
  sensitivity?: string;
}

export class ConfirmUploadDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sizeBytes?: number;
}
