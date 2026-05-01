import { IsString, IsUUID, IsOptional, MinLength, IsEmail } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsUUID()
  @IsOptional()
  role_id?: string;
}

