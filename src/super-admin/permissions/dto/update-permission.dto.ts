import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

type PermissionVisibility = 'internal' | 'public' | 'hidden';

export class UpdatePermissionDto {
  @IsString()
  @IsOptional()
  @Length(2, 150)
  name?: string;

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
