import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Folder, FolderPermission, User, Role, File, SystemSetting } from '../entities';
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
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * Calculate the depth of a folder by traversing the parent chain.
   * A root folder has depth 1.
   */
  private async calculateDepth(parentId: string | null | undefined): Promise<number> {
    if (!parentId) return 0; // root level, so new folder will be depth 1
    let depth = 0;
    let currentId: string | null = parentId;
    while (currentId) {
      depth++;
      const folder = await this.folderRepository.findOne({ where: { id: currentId } });
      currentId = folder?.parent_id ?? null;
    }
    return depth;
  }

  async getMaxFolderDepth(userId: string): Promise<number> {
    const user = await this.folderRepository.manager.getRepository(User).findOne({
      where: { id: userId },
      relations: ['role'],
    });

    if (user?.max_folder_depth != null) {
      return user.max_folder_depth;
    }

    if (user?.role?.max_folder_depth != null) {
      return user.role.max_folder_depth;
    }

    const setting = await this.settingRepository.findOne({ where: { key: 'max_folder_depth' } });
    return setting ? parseInt(setting.value, 10) : 5;
  }

  private mapRoleLabelToName(label: string): string {
    const norm = label.toLowerCase().trim();
    if (norm === 'wakil dekan 1' || norm === 'wd 1' || norm === 'wd1') return 'wd1';
    if (norm === 'wakil dekan 2' || norm === 'wd 2' || norm === 'wd2') return 'wd2';
    if (norm === 'wakil dekan 3' || norm === 'wd 3' || norm === 'wd3') return 'wd3';
    if (norm.includes('dosen')) return 'dosen';
    if (norm.includes('tendik')) return 'tendik';
    return norm;
  }

  async create(createFolderDto: CreateFolderDto, userId: string): Promise<Folder> {
    if (createFolderDto.parent_id) {
      const parent = await this.folderRepository.findOne({
        where: { id: createFolderDto.parent_id },
      });

      if (!parent) {
        throw new NotFoundException('Parent folder not found');
      }
    }

    // Validate folder depth against max_folder_depth setting
    const maxDepth = await this.getMaxFolderDepth(userId);
    const parentDepth = await this.calculateDepth(createFolderDto.parent_id);
    const newDepth = parentDepth + 1;
    if (newDepth > maxDepth) {
      throw new ForbiddenException(
        `Melebihi batas kedalaman folder maksimal (${maxDepth} level). Silakan request ke Super Admin untuk menambah kedalaman.`,
      );
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
        const mappedName = this.mapRoleLabelToName(roleName);
        const role = await this.roleRepository.findOne({
          where: { name: mappedName as any },
        });

        if (role) {
          const isDosenOrTendik = mappedName === 'dosen' || mappedName === 'tendik';
          // Check if permission already exists for this role+folder
          const existing = await this.permissionRepository.findOne({
            where: { folder_id: savedFolder.id, role_id: role.id },
          });

          if (!existing) {
            await this.permissionRepository.save({
              folder_id: savedFolder.id,
              role_id: role.id,
              can_read: true,
              can_download: true,
              can_create: isDosenOrTendik,
              can_update: isDosenOrTendik,
              can_delete: isDosenOrTendik,
            });
          }
        }
      }
    }

    // Assign specific user permissions 
    if (createFolderDto.user_permissions && createFolderDto.user_permissions.length > 0) {
      for (const perm of createFolderDto.user_permissions) {
        const existing = await this.permissionRepository.findOne({
          where: { folder_id: savedFolder.id, user_id: perm.user_id },
        });

        if (existing) {
          existing.can_read = !!perm.can_read;
          existing.can_create = !!perm.can_create;
          existing.can_update = !!perm.can_update;
          existing.can_delete = !!perm.can_delete;
          existing.can_download = !!perm.can_download;
          await this.permissionRepository.save(existing);
        } else {
          await this.permissionRepository.save({
            folder_id: savedFolder.id,
            user_id: perm.user_id,
            can_read: !!perm.can_read,
            can_create: !!perm.can_create,
            can_update: !!perm.can_update,
            can_delete: !!perm.can_delete,
            can_download: !!perm.can_download,
          });
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

    // Get ONLY OWNED folders so it doesn't mix with Shared Folders
    const folders = await this.folderRepository
      .createQueryBuilder('folder')
      .where('folder.id IN (:...ids)', { ids: accessibleFolderIds })
      .andWhere('folder.owner_id = :userId', { userId: user.id })
      .andWhere('folder.deleted_at IS NULL')
      .orderBy('folder.name', 'ASC')
      .getMany();

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
    
    // Update name if provided
    if (updateFolderDto.name) {
      folder.name = updateFolderDto.name;
    }

    // Handle new share_with_roles assignments
    if (updateFolderDto.share_with_roles && updateFolderDto.share_with_roles.length > 0) {
      for (const roleName of updateFolderDto.share_with_roles) {
        const mappedName = this.mapRoleLabelToName(roleName);
        const role = await this.roleRepository.findOne({
          where: { name: mappedName as any },
        });

        if (role) {
          const isDosenOrTendik = mappedName === 'dosen' || mappedName === 'tendik';
          // Check if permission already exists for this role+folder
          const existing = await this.permissionRepository.findOne({
            where: { folder_id: folder.id, role_id: role.id },
          });

          if (!existing) {
            await this.permissionRepository.save({
              folder_id: folder.id,
              role_id: role.id,
              can_read: true,
              can_download: true,
              can_create: isDosenOrTendik,
              can_update: isDosenOrTendik,
              can_delete: isDosenOrTendik,
            });
          }
        }
      }
    }

    // Handle specific user permissions 
    if (updateFolderDto.user_permissions && updateFolderDto.user_permissions.length > 0) {
      for (const perm of updateFolderDto.user_permissions) {
        const existing = await this.permissionRepository.findOne({
          where: { folder_id: folder.id, user_id: perm.user_id },
        });

        if (existing) {
          existing.can_read = !!perm.can_read;
          existing.can_create = !!perm.can_create;
          existing.can_update = !!perm.can_update;
          existing.can_delete = !!perm.can_delete;
          existing.can_download = !!perm.can_download;
          await this.permissionRepository.save(existing);
        } else {
          await this.permissionRepository.save({
            folder_id: folder.id,
            user_id: perm.user_id,
            can_read: !!perm.can_read,
            can_create: !!perm.can_create,
            can_update: !!perm.can_update,
            can_delete: !!perm.can_delete,
            can_download: !!perm.can_download,
          });
        }
      }
    }

    return this.folderRepository.save(folder);
  }

  async remove(id: string): Promise<void> {
    const folder = await this.findOne(id);
    // Cascade soft-delete: delete all children recursively
    await this.cascadeSoftDelete(folder.id);
    await this.folderRepository.softRemove(folder);
  }

  private async cascadeSoftDelete(folderId: string): Promise<void> {
    // Soft-delete all files in this folder
    const files = await this.fileRepository.find({ where: { folder_id: folderId } });
    if (files.length > 0) {
      await this.fileRepository.softRemove(files);
    }

    // Find all child folders and recursively soft-delete
    const children = await this.folderRepository.find({ where: { parent_id: folderId } });
    for (const child of children) {
      await this.cascadeSoftDelete(child.id);
      await this.folderRepository.softRemove(child);
    }
  }

  public async getAccessibleFolderIds(user: User): Promise<string[]> {
    const now = new Date();

    // Get folder IDs where user has ANY permission (read, create, update, delete)
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('(fp.can_read = true OR fp.can_create = true OR fp.can_update = true OR fp.can_delete = true)')
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
    permissionType: 'read' | 'create' | 'update' | 'delete' | 'download',
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
      case 'download':
        return permission.can_download;
      default:
        return false;
    }
  }

}

