import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FolderPermission } from '../../entities/folder-permission.entity';
import { Folder } from '../../entities/folder.entity';
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

    @InjectRepository(FolderPermission)
    private permissionRepository: Repository<FolderPermission>,

    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
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

    const folder = await this.folderRepository.findOne({
      where: { id: folderId },
      relations: ['owner', 'role'],
    });

    if (!folder) {
      return false;
    }

    // The folder owner may always manage their own folder regardless of which role
    // they are currently operating under. This only covers the owner themselves.
    if (folder.owner?.id === userId) {
      return true;
    }

    // Private workspace folder: same-role non-owners are always denied (prevents same-role
    // private workspace leakage). Cross-role non-owners may have explicit permissions —
    // check those before denying.
    if (folder.role?.is_private && folder.owner_id !== userId) {
      // Check all relevant permissions (user-specific or role-based for current active role).
      const permissions = await this.permissionRepository
        .createQueryBuilder('fp')
        .where('fp.folder_id = :folderId', { folderId: folder.id })
        .andWhere('(fp.user_id = :userId OR (fp.role_id = :roleId AND fp.user_id IS NULL))', { userId, roleId })
        .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
        .getMany();

      // Explicit user-specific grant always wins (covers same-role & cross-role sharing).
      const userPerm = permissions.find(p => p.user_id === userId);
      if (userPerm) {
        switch (permissionType) {
          case PermissionType.READ: return userPerm.can_read;
          case PermissionType.CREATE: return userPerm.can_create;
          case PermissionType.UPDATE: return userPerm.can_update;
          case PermissionType.DELETE: return userPerm.can_delete;
          default: return false;
        }
      }

      // Same private role, no user-specific grant → deny (prevents role-level leakage).
      if (folder.role_id === roleId) return false;

      // Cross-role: role-based permission is enough.
      if (permissions.length === 0) {
        return this.checkAncestorPermissions(folder, userId, roleId, permissionType, now);
      }
      return permissions.some(p => {
        switch (permissionType) {
          case PermissionType.READ: return p.can_read;
          case PermissionType.CREATE: return p.can_create;
          case PermissionType.UPDATE: return p.can_update;
          case PermissionType.DELETE: return p.can_delete;
          default: return false;
        }
      });
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
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id = :folderId', { folderId })
      .andWhere('(fp.user_id = :userId OR fp.role_id = :roleId)', { userId, roleId })
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getMany();

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
    folder: Folder,
    userId: string,
    roleId: string,
    permissionType: PermissionType,
    now: Date,
  ): Promise<boolean> {
    const ancestorIds: string[] = [];
    let parentId = folder.parent_id;
    while (parentId && ancestorIds.length < 5) {
      ancestorIds.push(parentId);
      const parent = await this.folderRepository.findOne({
        where: { id: parentId },
        select: ['id', 'parent_id'],
      });
      parentId = parent?.parent_id ?? null;
    }
    if (!ancestorIds.length) return false;

    const perms = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id IN (:...folderIds)', { folderIds: ancestorIds })
      .andWhere('(fp.user_id = :userId OR fp.role_id = :roleId)', { userId, roleId })
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getMany();

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