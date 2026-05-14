import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AssignPermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  permissionIds: string[];
}
