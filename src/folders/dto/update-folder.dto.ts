import {
  IsString, IsOptional, MinLength, IsArray,
  IsUUID, IsBoolean, ValidateNested,
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserPermissionItemDto)
  @IsOptional()
  user_permissions?: UserPermissionItemDto[];
}
