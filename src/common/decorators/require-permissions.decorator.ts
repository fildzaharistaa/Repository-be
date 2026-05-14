import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'permissions';
export const REQUIRE_PERMISSIONS_MODE_KEY = 'permissionsMode';

export type RequirePermissionsMode = 'all' | 'any';

/**
 * Require all of the listed permission slugs (AND semantics).
 * Example: @RequirePermissions('role.manage', 'user.manage')
 */
export const RequirePermissions = (...permissions: string[]) => {
  return (target: any, key?: any, descriptor?: any) => {
    SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions)(target, key, descriptor);
    SetMetadata(REQUIRE_PERMISSIONS_MODE_KEY, 'all' as RequirePermissionsMode)(
      target,
      key,
      descriptor,
    );
  };
};

/**
 * Require ANY of the listed permission slugs (OR semantics).
 */
export const RequireAnyPermission = (...permissions: string[]) => {
  return (target: any, key?: any, descriptor?: any) => {
    SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions)(target, key, descriptor);
    SetMetadata(REQUIRE_PERMISSIONS_MODE_KEY, 'any' as RequirePermissionsMode)(
      target,
      key,
      descriptor,
    );
  };
};
