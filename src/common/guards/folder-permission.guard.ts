import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

export enum PermissionType {
  READ = 'read',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

@Injectable()
export class FolderPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<PermissionType>(
      'permission',
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    const folderId =
      request.params.folderId ||
      request.params.id ||
      request.body.folder_id ||
      request.body.parent_id;

    if (!folderId) {
      throw new ForbiddenException('Folder ID is required');
    }

    const activeRoleId = (request.user as any)?.active_role_id || user.role_id;

    const hasPermission = await this.checkPermission(
      user.id,
      activeRoleId,
      folderId,
      requiredPermission,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `You do not have ${requiredPermission} permission for this folder`,
      );
    }

    return true;
  }

  private async checkPermission(
    userId: string,
    roleId: string,
    folderId: string,
    permissionType: PermissionType,
  ): Promise<boolean> {
    const now = new Date();

    const folder = await this.prisma.folders.findUnique({
      where: { id: folderId },
      include: { users: true, roles: true },
    });

    if (!folder) {
      return false;
    }

    // The folder owner may always manage their own folder regardless of which role
    // they are currently operating under. This only covers the owner themselves.
    if (folder.owner_id === userId) {
      return true;
    }

    // Private workspace folder: only the owner (already returned above) may access it.
    // Without this check, the workspace-role match below would grant every same-role
    // member full access to another user's Workspace Pribadi folder.
    if (folder.roles?.is_private && folder.owner_id !== userId) {
      return false;
    }

    // Allow access if the requester's active role matches the folder's workspace role
    // (folder.role_id is the role under which the folder was created).
    // We intentionally do NOT check folder.owner?.role_id here — that is the owner's
    // primary role which may be stale for multi-role users and would grant unintended
    // access to any user whose role matches the owner's primary role.
    if (folder.role_id && folder.role_id === roleId) {
      return true;
    }

    // cek permission table (both user-level and role-level)
    const permissions = await this.prisma.folder_permissions.findMany({
      where: {
        folder_id: folderId,
        AND: [
          { OR: [{ user_id: userId }, { role_id: roleId }] },
          { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
        ],
      },
    });

    if (permissions.length === 0) {
      // No direct permission: check if any ancestor folder grants access.
      // This handles subfolders of shared folders that may not have their own
      // permission records (e.g. legacy data before recursive propagation was added).
      return this.checkAncestorPermissions(folder, userId, roleId, permissionType, now);
    }

    // OR logic: if ANY matching permission grants the requested type, allow
    return permissions.some(permission => {
      switch (permissionType) {
        case PermissionType.READ:
          return permission.can_read;

        case PermissionType.CREATE:
          return permission.can_create;

        case PermissionType.UPDATE:
          return permission.can_update;

        case PermissionType.DELETE:
          return permission.can_delete;

        default:
          return false;
      }
    });
  }

  private async checkAncestorPermissions(
    folder: any,
    userId: string,
    roleId: string,
    permissionType: PermissionType,
    now: Date,
  ): Promise<boolean> {
    const ancestorIds: string[] = [];
    let parentId = folder.parent_id;
    while (parentId && ancestorIds.length < 5) {
      ancestorIds.push(parentId);
      const parent = await this.prisma.folders.findUnique({
        where: { id: parentId },
        select: { id: true, parent_id: true },
      });
      parentId = parent?.parent_id ?? null;
    }
    if (!ancestorIds.length) return false;

    const perms = await this.prisma.folder_permissions.findMany({
      where: {
        folder_id: { in: ancestorIds },
        AND: [
          { OR: [{ user_id: userId }, { role_id: roleId }] },
          { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
        ],
      },
    });

    return perms.some(p => {
      switch (permissionType) {
        case PermissionType.READ: return p.can_read;
        case PermissionType.CREATE: return p.can_create;
        case PermissionType.UPDATE: return p.can_update;
        case PermissionType.DELETE: return p.can_delete;
        default: return false;
      }
    });
  }
}
