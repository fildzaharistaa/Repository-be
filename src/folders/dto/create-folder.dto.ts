import { IsString, IsUUID, IsOptional, MinLength, IsArray, IsBoolean } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsUUID()
  @IsOptional()
  parent_id?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  share_with_roles?: string[];

  @IsArray()
  @IsOptional()
  user_permissions?: any[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  initial_subfolders?: string[];

  @IsBoolean()
  @IsOptional()
  is_shared_subfolder?: boolean;
}

