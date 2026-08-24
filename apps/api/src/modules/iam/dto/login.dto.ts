import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'devpass1234' })
  @IsString()
  @MinLength(1)
  password!: string;
}
