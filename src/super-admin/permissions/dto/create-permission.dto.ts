import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { PermissionVisibility } from '../../../entities';

export class CreatePermissionDto {
  // slug = module.action (or module.submodule.action). Lowercase, dot-separated.
  @IsString()
  @Length(2, 100)
  @Matches(/^[a-z0-9_]+(\.[a-z0-9_*]+){1,2}$/, {
    message: 'slug must look like "module.action" or "module.submodule.action" (lowercase, snake_case)',
  })
  slug: string;

  @IsString()
  @Length(2, 50)
  module: string;

  @IsString()
  @Length(2, 50)
  action: string;

  @IsString()
  @IsOptional()
  @Length(0, 50)
  submodule?: string;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsString()
  @IsOptional()
  @Length(0, 500)
  description?: string;

  @IsString()
  @IsOptional()
  @Length(0, 50)
  category?: string;

  @IsIn(['internal', 'public', 'hidden'])
  @IsOptional()
  visibility?: PermissionVisibility;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
