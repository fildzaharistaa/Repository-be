import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { folder_permissions } from '@prisma/client';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

type FolderPermissionWithRelations = folder_permissions & {
  folders?: any;
  users?: any;
  roles?: any;
};

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async create(createPermissionDto: CreatePermissionDto): Promise<FolderPermissionWithRelations> {
    if (!createPermissionDto.user_id && !createPermissionDto.role_id) {
      throw new BadRequestException('Either user_id or role_id must be provided');
    }

    if (createPermissionDto.user_id && createPermissionDto.role_id) {
      throw new BadRequestException('Cannot assign permission to both user and role. Choose one.');
    }

    const folder = await this.prisma.folders.findUnique({
      where: { id: createPermissionDto.folder_id },
    });
    if (!folder) throw new NotFoundException('Folder not found');

    if (createPermissionDto.user_id) {
      const user = await this.prisma.users.findUnique({
        where: { id: createPermissionDto.user_id },
      });
      if (!user) throw new NotFoundException('User not found');
    }

    if (createPermissionDto.role_id) {
      const role = await this.prisma.roles.findUnique({
        where: { id: createPermissionDto.role_id },
      });
      if (!role) throw new NotFoundException('Role not found');
    }

    const existing = await this.prisma.folder_permissions.findFirst({
      where: {
        folder_id: createPermissionDto.folder_id,
        user_id: createPermissionDto.user_id ?? null,
        role_id: createPermissionDto.role_id ?? null,
      },
    });

    if (existing) throw new BadRequestException('Permission already exists');

    return this.prisma.folder_permissions.create({
      data: {
        folder_id: createPermissionDto.folder_id,
        user_id: createPermissionDto.user_id ?? null,
        role_id: createPermissionDto.role_id ?? null,
        can_read: createPermissionDto.can_read ?? false,
        can_create: createPermissionDto.can_create ?? false,
        can_update: createPermissionDto.can_update ?? false,
        can_delete: createPermissionDto.can_delete ?? false,
        can_download: false,
        expires_at: createPermissionDto.expires_at ? new Date(createPermissionDto.expires_at) : null,
      },
      include: { folders: true, users: true, roles: true },
    });
  }

  async findAll(folderId?: string): Promise<FolderPermissionWithRelations[]> {
    return this.prisma.folder_permissions.findMany({
      where: folderId ? { folder_id: folderId } : undefined,
      include: { folders: true, users: true, roles: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string): Promise<FolderPermissionWithRelations> {
    const permission = await this.prisma.folder_permissions.findUnique({
      where: { id },
      include: { folders: true, users: true, roles: true },
    });

    if (!permission) throw new NotFoundException('Permission not found');
    return permission;
  }

  async update(id: string, updatePermissionDto: UpdatePermissionDto): Promise<FolderPermissionWithRelations> {
    await this.findOne(id);

    const data: any = { ...updatePermissionDto };
    if (updatePermissionDto.expires_at !== undefined) {
      data.expires_at = updatePermissionDto.expires_at ? new Date(updatePermissionDto.expires_at) : null;
    }

    return this.prisma.folder_permissions.update({
      where: { id },
      data,
      include: { folders: true, users: true, roles: true },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.folder_permissions.delete({ where: { id } });
  }
}
