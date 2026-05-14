import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CloneRoleDto {
  @IsString()
  @Length(2, 50)
  newName: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  @IsBoolean()
  @IsOptional()
  copyPermissions?: boolean = true;
}
