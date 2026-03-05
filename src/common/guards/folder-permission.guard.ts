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

    const hasPermission = await this.checkPermission(
      user.id,
      user.role_id,
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
      relations: ['owner'],
    });

    if (!folder) {
      return false;
    }

    // owner selalu boleh
    if (folder.owner?.id === userId) {
      return true;
    }

    // role sama dengan owner (WD2 → folder WD2)
    if (folder.owner?.role_id === roleId) {
      return true;
    }

    // cek permission table
    const permission = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id = :folderId', { folderId })
      .andWhere('fp.user_id = :userId', { userId })
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getOne();

    if (!permission) {
      return false;
    }

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
  }
}