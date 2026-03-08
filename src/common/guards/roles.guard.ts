import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '../../entities';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user || !user.role) {
      return false;
    }

    // Case-insensitive role comparison
    const userRoleName = user.role.name.toLowerCase();
    const normalizedRequired = requiredRoles.map(r => r.toLowerCase());

    if (normalizedRequired.includes(userRoleName)) {
      return true;
    }
    // Treat 'super admin' / 'superadmin' as equivalent to 'admin'
    if (normalizedRequired.includes('admin') && (userRoleName === 'super admin' || userRoleName === 'superadmin')) {
      return true;
    }
    return false;
  }
}

