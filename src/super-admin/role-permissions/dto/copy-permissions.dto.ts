import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class CopyPermissionsDto {
  @IsUUID()
  sourceRoleId: string;

  @IsIn(['replace', 'merge'])
  @IsOptional()
  mode?: 'replace' | 'merge' = 'merge';
}
