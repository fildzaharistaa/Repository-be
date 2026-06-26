import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_PERMISSIONS_MODE_KEY,
  RequirePermissionsMode,
} from '../decorators/require-permissions.decorator';
import { PermissionCacheService } from '../../super-admin/shared/permission-cache.service';

/**
 * Action-level permission guard. Runs AFTER JwtAuthGuard.
 * Reads slugs from @RequirePermissions() / @RequireAnyPermission() metadata
 * and checks them against the user's effective permission set (dynamic, DB-backed).
 *
 * Does NOT replace RolesGuard. Existing controllers still work unchanged.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: PermissionCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const mode =
      this.reflector.getAllAndOverride<RequirePermissionsMode | undefined>(
        REQUIRE_PERMISSIONS_MODE_KEY,
        [context.getHandler(), context.getClass()],
      ) || 'all';

    const request = context.switchToHttp().getRequest();
    const user = request.user as any;
    if (!user) throw new ForbiddenException('Not authenticated');

    // active_role_id can be present on the JWT payload (set via /users/switch-role)
    const activeRoleId =
      (request.user as any)?.active_role_id || user.role_id || null;

    const { slugs } = await this.cache.getEffective(user.id, activeRoleId);

    const checker = (slug: string) => this.cache.hasSlug(slugs, slug);
    const ok = mode === 'any' ? required.some(checker) : required.every(checker);

    if (!ok) {
      throw new ForbiddenException(
        `Missing permission${required.length > 1 ? 's' : ''}: ${required.join(mode === 'any' ? ' | ' : ', ')}`,
      );
    }
    return true;
  }
}
