import { IsString, IsUUID, IsOptional, MinLength, IsArray, IsBoolean, ValidateNested } from 'class-validator';
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
