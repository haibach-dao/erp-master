import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePersonDto {
  @ApiProperty() @IsString() @MinLength(1) fullName!: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'UNKNOWN'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'UNKNOWN'])
  gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateOfBirth?: string;
  @ApiPropertyOptional({ description: 'CCCD — stored encrypted + hashed, shown masked' })
  @IsOptional()
  @IsString()
  nationalId?: string;
}

export class CreateCustomerDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'] })
  @IsIn(['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'])
  type!: string;

  @ApiPropertyOptional({ description: 'Existing Person id (individual customers)' })
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional({ description: 'Inline person for INDIVIDUAL if personId not given' })
  @IsOptional()
  person?: CreatePersonDto;

  @ApiPropertyOptional() @IsOptional() @IsString() orgName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() companyId?: string;
}

export class CreateRelationshipDto {
  @ApiProperty() @IsString() sourcePersonId!: string;
  @ApiProperty() @IsString() targetPersonId!: string;
  @ApiProperty({ description: 'relationship_types.code, e.g. SPOUSE/PARENT/CHILD/SIBLING' })
  @IsString()
  relationshipType!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() verificationSource?: string;
}
