import { IsString, IsUUID, IsOptional, MinLength, IsArray, IsBoolean, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { UserPermissionItemDto } from './update-folder.dto';

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

  /**
   * Maps role ID → can_download for group role shares.
   * e.g. { "<dosen-role-id>": true }
   */
  @IsOptional()
  @IsObject()
  role_download_map?: Record<string, boolean>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserPermissionItemDto)
  @IsOptional()
  user_permissions?: UserPermissionItemDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  initial_subfolders?: string[];

  @IsBoolean()
  @IsOptional()
  is_shared_subfolder?: boolean;
}
