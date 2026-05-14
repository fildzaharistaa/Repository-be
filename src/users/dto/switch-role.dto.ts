import { IsUUID } from 'class-validator';

export class SwitchRoleDto {
  @IsUUID()
  roleId: string;
}
