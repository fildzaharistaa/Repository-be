import { Module } from '@nestjs/common';
import { PermissionCacheService } from './shared/permission-cache.service';
import { AdminRolesController } from './roles/admin-roles.controller';
import { AdminRolesService } from './roles/admin-roles.service';
import { AdminPermissionsController } from './permissions/admin-permissions.controller';
import { AdminPermissionsService } from './permissions/admin-permissions.service';
import { RolePermissionsController } from './role-permissions/role-permissions.controller';
import { RolePermissionsService } from './role-permissions/role-permissions.service';
import { UserRolesController } from './user-roles/user-roles.controller';
import { UserRolesService } from './user-roles/user-roles.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';

@Module({
  controllers: [
    AdminRolesController,
    AdminPermissionsController,
    RolePermissionsController,
    UserRolesController,
  ],
  providers: [
    PermissionCacheService,
    PermissionsGuard,
    AdminRolesService,
    AdminPermissionsService,
    RolePermissionsService,
    UserRolesService,
  ],
  exports: [PermissionCacheService, PermissionsGuard],
})
export class SuperAdminModule {}
