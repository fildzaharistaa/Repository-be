import { IsString, IsOptional, MinLength, IsArray } from 'class-validator';

export class UpdateFolderDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsArray()
  @IsOptional()
  share_with_roles?: string[];

  @IsArray()
  @IsOptional()
  user_permissions?: any[];
}


