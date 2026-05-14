import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  @Length(2, 50)
  name?: string;

  @IsString()
  @IsOptional()
  @Length(0, 255)
  description?: string;

  @IsBoolean()
  @IsOptional()
  is_admin?: boolean;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsInt()
  @IsOptional()
  @Min(0)
  hierarchy_level?: number;

  @IsString()
  @IsOptional()
  @Length(0, 50)
  category?: string;

  @IsString()
  @IsOptional()
  @Length(0, 20)
  color?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  max_folder_depth?: number;
}
