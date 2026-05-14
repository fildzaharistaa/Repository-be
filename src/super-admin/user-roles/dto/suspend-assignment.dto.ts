import { IsOptional, IsString, Length } from 'class-validator';

export class SuspendAssignmentDto {
  @IsString()
  @IsOptional()
  @Length(0, 500)
  reason?: string;
}
