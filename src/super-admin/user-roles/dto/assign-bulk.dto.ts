import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class AssignBulkDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  userIds: string[];

  @IsUUID()
  roleId: string;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
