import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Folder, FolderPermission, User, Role } from '../entities';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

export interface FolderTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
  children?: FolderTreeNode[];
}

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(FolderPermission)
    private permissionRepository: Repository<FolderPermission>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async create(createFolderDto: CreateFolderDto, userId: string): Promise<Folder> {
    if (createFolderDto.parent_id) {
      const parent = await this.folderRepository.findOne({
        where: { id: createFolderDto.parent_id },
      });

      if (!parent) {
        throw new NotFoundException('Parent folder not found');
      }
    }

    // Get user with role for unit assignment
    const user = await this.folderRepository.manager.getRepository(User).findOne({
      where: { id: userId },
      relations: ['role'],
    });

    const folder = this.folderRepository.create({
      ...createFolderDto,
      owner: { id: userId } as User,
      unit: user?.role?.name.toLowerCase().substring(0, 50) || 'general',
    });

    const savedFolder = await this.folderRepository.save(folder);

    // Automatically grant full permissions to the creator
    await this.permissionRepository.save({
      folder_id: savedFolder.id,
      user_id: userId,
      can_read: true,
      can_create: true,
      can_update: true,
      can_delete: true,
      can_download: true,
    });

    // Inherit permissions from parent folder if exists
    if (createFolderDto.parent_id) {
      const parentPermissions = await this.permissionRepository.find({
        where: { folder_id: createFolderDto.parent_id }
      });
      for (const perm of parentPermissions) {
        // Skip copying the owner's permission since we already added the new owner
        if (perm.user_id === userId) continue;

        // Save copied permission
        await this.permissionRepository.save({
          folder_id: savedFolder.id,
          user_id: perm.user_id,
          role_id: perm.role_id,
          can_read: perm.can_read,
          can_create: perm.can_create,
          can_update: perm.can_update,
          can_delete: perm.can_delete,
          can_download: perm.can_download,
        });
      }
    }

    // Auto-share with specified roles (e.g. dosen, tendik)
    if (createFolderDto.share_with_roles && createFolderDto.share_with_roles.length > 0) {
      for (const roleName of createFolderDto.share_with_roles) {
        const role = await this.roleRepository.findOne({
          where: { name: roleName.toLowerCase() as any },
        });

        if (role) {
          // Check if permission already exists for this role+folder
          const existing = await this.permissionRepository.findOne({
            where: { folder_id: savedFolder.id, role_id: role.id },
          });

          if (!existing) {
            await this.permissionRepository.save({
              folder_id: savedFolder.id,
              role_id: role.id,
              can_read: true,
              can_create: true,
              can_update: true,
              can_delete: true,
              can_download: true,
            });
          }
        }
      }
    }

    return savedFolder;
  }

  async findOne(id: string): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['parent', 'children'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }

  async findAllAccessible(user: User): Promise<Folder[]> {
    const accessibleFolderIds = await this.getAccessibleFolderIds(user);
    
    if (accessibleFolderIds.length === 0) {
      return [];
    }

    return this.folderRepository.find({
      where: { id: In(accessibleFolderIds) },
      relations: ['parent'],
      order: { name: 'ASC' },
    });
  }

  async findAllForAdmin(): Promise<Folder[]> {
    return this.folderRepository.find({
      where: { deleted_at: IsNull() },
      relations: ['parent'],
      order: { name: 'ASC' },
    });
  }

  async getTreeForAdmin(): Promise<FolderTreeNode[]> {
    const folders = await this.folderRepository.find({
      where: { deleted_at: IsNull() },
      order: { name: 'ASC' },
    });

    // Build tree structure
    const folderMap = new Map<string, FolderTreeNode>();
    const rootFolders: FolderTreeNode[] = [];

    // First pass: create all nodes
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        children: [],
      });
    });

    // Second pass: build parent-child relationships
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  async getTree(user: User): Promise<FolderTreeNode[]> {
    const accessibleFolderIds = await this.getAccessibleFolderIds(user);

    if (accessibleFolderIds.length === 0) {
      return [];
    }

    // Get ALL accessible folders (both owned and shared) so the sidebar tree is complete
    const folders = await this.folderRepository.find({
      where: { id: In(accessibleFolderIds) },
      order: { name: 'ASC' },
    });

    return this.buildTree(folders);
  }

  async getSharedTree(user: User): Promise<FolderTreeNode[]> {
    const accessibleFolderIds = await this.getAccessibleFolderIds(user);

    if (accessibleFolderIds.length === 0) {
      return [];
    }

    // Get only SHARED folders (user has permission but is NOT the owner)
    const folders = await this.folderRepository
      .createQueryBuilder('folder')
      .where('folder.id IN (:...ids)', { ids: accessibleFolderIds })
      .andWhere('(folder.owner_id != :userId OR folder.owner_id IS NULL)', { userId: user.id })
      .andWhere('folder.deleted_at IS NULL')
      .leftJoinAndSelect('folder.owner', 'owner')
      .orderBy('folder.name', 'ASC')
      .getMany();

    return this.buildTreeWithOwner(folders);
  }

  private buildTree(folders: Folder[]): FolderTreeNode[] {
    const folderMap = new Map<string, FolderTreeNode>();
    const rootFolders: FolderTreeNode[] = [];

    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        children: [],
      });
    });

    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  private buildTreeWithOwner(folders: Folder[]): any[] {
    const folderMap = new Map<string, any>();
    const rootFolders: any[] = [];

    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        owner_name: folder.owner?.name || 'Unknown',
        children: [],
      });
    });

    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  async update(id: string, updateFolderDto: UpdateFolderDto): Promise<Folder> {
    const folder = await this.findOne(id);
    Object.assign(folder, updateFolderDto);
    return this.folderRepository.save(folder);
  }

  async remove(id: string): Promise<void> {
    const folder = await this.findOne(id);
    await this.folderRepository.softRemove(folder);
  }

  public async getAccessibleFolderIds(user: User): Promise<string[]> {
    const now = new Date();

    // Get folder IDs where user has read permission (direct or via role)
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('fp.can_read = :canRead', { canRead: true })
      .andWhere(
        '(fp.user_id = :userId OR fp.role_id = :roleId)',
        { userId: user.id, roleId: user.role_id },
      )
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getRawMany();

    return permissions.map((p) => p.folder_id);
  }

  async checkPermission(
    userId: string,
    roleId: string,
    folderId: string,
    permissionType: 'read' | 'create' | 'update' | 'delete',
  ): Promise<boolean> {
    const now = new Date();

    const permission = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id = :folderId', { folderId })
      .andWhere(
        '(fp.user_id = :userId OR fp.role_id = :roleId)',
        { userId, roleId },
      )
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getOne();

    if (!permission) {
      return false;
    }

    switch (permissionType) {
      case 'read':
        return permission.can_read;
      case 'create':
        return permission.can_create;
      case 'update':
        return permission.can_update;
      case 'delete':
        return permission.can_delete;
      default:
        return false;
    }
  }

}

