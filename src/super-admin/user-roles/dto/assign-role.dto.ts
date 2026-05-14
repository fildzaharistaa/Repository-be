import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @IsUUID()
  roleId: string;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
