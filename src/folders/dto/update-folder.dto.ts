import {
  IsString, IsOptional, MinLength, IsArray,
  IsUUID, IsBoolean, ValidateNested, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UserPermissionItemDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsUUID()
  role_id?: string | null;

  @IsBoolean()
  can_read: boolean;

  @IsBoolean()
  can_download: boolean;

  @IsBoolean()
  @IsOptional()
  can_create?: boolean;

  @IsBoolean()
  @IsOptional()
  can_update?: boolean;

  @IsBoolean()
  @IsOptional()
  can_delete?: boolean;
}

export class UpdateFolderDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  share_with_roles?: string[];

  /**
   * Maps role ID → can_download for group role shares.
   * Sent alongside share_with_roles to specify per-role download permission.
   * e.g. { "<dosen-role-id>": true, "<tendik-role-id>": false }
   */
  @IsOptional()
  @IsObject()
  role_download_map?: Record<string, boolean>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserPermissionItemDto)
  @IsOptional()
  user_permissions?: UserPermissionItemDto[];
}
