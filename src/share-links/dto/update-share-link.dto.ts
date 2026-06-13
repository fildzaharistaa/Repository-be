import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateShareLinkDto {
  @IsOptional()
  @IsIn(['anyone', 'organization'])
  access_level?: 'anyone' | 'organization';

  @IsOptional()
  @IsIn(['view', 'download'])
  permission?: 'view' | 'download';

  @IsOptional()
  @IsString()
  expires_at?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
