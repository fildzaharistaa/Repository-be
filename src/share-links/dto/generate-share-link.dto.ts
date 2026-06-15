import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateShareLinkDto {
  @IsIn(['file', 'folder'])
  type: 'file' | 'folder';

  @IsUUID()
  id: string;

  @IsOptional()
  @IsIn(['anyone', 'organization'])
  access_level?: 'anyone' | 'organization';

  @IsOptional()
  @IsIn(['view', 'download'])
  permission?: 'view' | 'download';

  @IsOptional()
  @IsString()
  expires_at?: string | null;
}
