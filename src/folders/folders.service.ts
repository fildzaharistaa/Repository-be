import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
  ) { }

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

  /**
   * Look up a role by label, using case-insensitive matching.
   * Handles both short forms (wd1) and long forms (Wakil Dekan 1).
   */
  private async findRoleByLabel(label: string): Promise<Role | null> {
    const norm = label.toLowerCase().trim();

    // Build list of possible name variants to search for
    const variants: string[] = [label]; // original label

    if (norm === 'wakil dekan 1' || norm === 'wd 1' || norm === 'wd1') {
      variants.push('wd1', 'Wakil Dekan 1', 'wakil dekan 1');
    } else if (norm === 'wakil dekan 2' || norm === 'wd 2' || norm === 'wd2') {
      variants.push('wd2', 'Wakil Dekan 2', 'wakil dekan 2');
    } else if (norm === 'wakil dekan 3' || norm === 'wd 3' || norm === 'wd3') {
      variants.push('wd3', 'Wakil Dekan 3', 'wakil dekan 3');
    } else if (norm.includes('dosen')) {
      variants.push('dosen', 'Dosen');
    } else if (norm.includes('tendik')) {
      variants.push('tendik', 'Tendik');
    }

    // Case-insensitive search across all variants
    return this.roleRepository
      .createQueryBuilder('role')
      .where('LOWER(role.name) IN (:...names)', {
        names: [...new Set(variants.map(v => v.toLowerCase()))],
      })
      .getOne();
  }

  private isDosenOrTendikRole(roleName: string): boolean {
    const norm = roleName.toLowerCase().trim();
    return norm.includes('dosen') || norm.includes('tendik');
  }

  async create(createFolderDto: CreateFolderDto, userId: string, activeRoleId?: string): Promise<Folder> {
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

    // Check direct children count limit (same value as depth limit)
    if (createFolderDto.parent_id) {
      const childCount = await this.folderRepository.count({
        where: { parent_id: createFolderDto.parent_id, deleted_at: IsNull() },
      });
      if (childCount >= maxDepth) {
        throw new BadRequestException(
          `Maksimal hanya ${maxDepth} subfolder dalam folder ini`,
        );
      }
    }

    // Get user with role for unit assignment
    const user = await this.folderRepository.manager.getRepository(User).findOne({
      where: { id: userId },
      relations: ['role'],
    });

    const folder = this.folderRepository.create({
      ...createFolderDto,
      role_id: activeRoleId || null,
      owner: { id: userId } as User,
      unit: user?.role?.name?.toLowerCase().substring(0, 50) || 'general',
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

    // Automatically grant full permissions to the creator's role to integrate folders for users with the same role
    if (user?.role?.id) {
      const existingRolePerm = await this.permissionRepository.findOne({
        where: { folder_id: savedFolder.id, role_id: user.role.id }
      });
      if (!existingRolePerm) {
        await this.permissionRepository.save({
          folder_id: savedFolder.id,
          role_id: user.role.id,
          can_read: true,
          can_create: true,
          can_update: true,
          can_delete: true,
          can_download: true,
        });
      } else {
        existingRolePerm.can_read = true;
        existingRolePerm.can_create = true;
        existingRolePerm.can_update = true;
        existingRolePerm.can_delete = true;
        existingRolePerm.can_download = true;
        await this.permissionRepository.save(existingRolePerm);
      }
    }

    // NOTE: Sub-folders do NOT auto-inherit parent permissions.
    // Each sub-folder's permissions are explicitly set via share_with_roles
    // and user_permissions. This ensures granular access control where
    // a parent folder can share with Dosen+Tendik, but a sub-folder
    // can be restricted to only Tendik.

    // Auto-share with specified roles (e.g. dosen, tendik)
    if (createFolderDto.share_with_roles && createFolderDto.share_with_roles.length > 0) {
      for (const roleLabel of createFolderDto.share_with_roles) {
        const role = await this.findRoleByLabel(roleLabel);

        if (role) {
          const isDosenOrTendik = this.isDosenOrTendikRole(role.name);
          // Check if permission already exists for this role+folder
          const existing = await this.permissionRepository.findOne({
            where: { folder_id: savedFolder.id, role_id: role.id },
          });

          if (!existing) {
            await this.permissionRepository.save({
              folder_id: savedFolder.id,
              role_id: role.id,
              can_read: true,
              can_download: false,
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
      relations: ['parent', 'children', 'permissions', 'permissions.role', 'permissions.user'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }

  /**
   * Get a single folder with its details for a specific user.
   * All children are shown (so user can see subfolders exist), but
   * access control is enforced when the user tries to navigate into
   * a subfolder - the getFiles endpoint checks permissions and returns
   * 403 "Akses Ditolak" if the user lacks access.
   */
  async findOneForUser(id: string, user: User): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['parent', 'children', 'permissions', 'permissions.role', 'permissions.user', 'owner'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }

  async findAllAccessible(user: User): Promise<Folder[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];

    return this.folderRepository.find({
      where: { role_id: activeRoleId, deleted_at: IsNull() },
      relations: ['parent', 'owner', 'owner.role'],
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
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];

    // Role workspace: only folders that belong to the active role
    const folders = await this.folderRepository.find({
      where: { role_id: activeRoleId, deleted_at: IsNull() },
      order: { name: 'ASC' },
    });

    return this.buildTree(folders);
  }

  async getSharedTree(user: User): Promise<FolderTreeNode[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    const now = new Date();

    // Shared folders: folders granted to my role via FolderPermission but owned by a different role
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('fp.role_id = :roleId', { roleId: activeRoleId })
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getRawMany();

    const sharedIds = permissions.map((p) => p.folder_id);
    if (!sharedIds.length) return [];

    const folders = await this.folderRepository.find({
      where: { id: In(sharedIds), deleted_at: IsNull() },
      relations: ['owner', 'owner.role'],
      order: { name: 'ASC' },
    });

    // Only show folders that belong to a DIFFERENT role workspace
    const sharedFromOtherRole = folders.filter((f) => f.role_id !== activeRoleId);

    return this.buildTreeWithOwner(sharedFromOtherRole);
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
        owner_email: folder.owner?.email || '',
        owner_role: folder.owner?.role?.name || 'Unknown',
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

    if (updateFolderDto.name) {
      folder.name = updateFolderDto.name;
    }

    // Fetch the folder owner with their role to protect owner's own permissions
    const ownerUser = folder.owner_id
      ? await this.folderRepository.manager.getRepository(User).findOne({
        where: { id: folder.owner_id },
        relations: ['role'],
      })
      : null;
    const ownerRoleId = ownerUser?.role?.id || null;

    // --- SINKRONISASI GRUP ROLE SHARING ---
    if (updateFolderDto.share_with_roles) {
      const targetRoleIds: string[] = [];
      for (const roleLabel of updateFolderDto.share_with_roles) {
        const role = await this.findRoleByLabel(roleLabel);
        if (role) targetRoleIds.push(role.id);
      }

      // Hapus izin role yang tidak ada di targetRoleIds untuk folder ini
      // PENTING: Jangan hapus permission role milik owner folder sendiri
      const currentRolePerms = folder.permissions.filter(p => !!p.role_id);
      for (const p of currentRolePerms) {
        // Protect owner's own role permission
        if (p.role_id === ownerRoleId) continue;
        if (!targetRoleIds.includes(p.role_id!)) {
          await this.permissionRepository.delete(p.id);
        }
      }

      // Tambahkan yang belum ada
      for (const roleId of targetRoleIds) {
        // Skip if it's the owner's own role (already has full permissions)
        if (roleId === ownerRoleId) continue;
        if (!currentRolePerms.find(p => p.role_id === roleId)) {
          const role = await this.roleRepository.findOne({ where: { id: roleId } });
          const isDosenOrTendik = role ? this.isDosenOrTendikRole(role.name) : false;
          await this.permissionRepository.save({
            folder_id: folder.id,
            role_id: roleId,
            can_read: true,
            can_download: false,
            can_create: isDosenOrTendik,
            can_update: isDosenOrTendik,
            can_delete: isDosenOrTendik,
          });
        }
      }
    }

    // --- SINKRONISASI USER PERMISSIONS ---
    if (updateFolderDto.user_permissions) {
      const targetUserIds = updateFolderDto.user_permissions.map(up => up.user_id);
      const currentUserPerms = folder.permissions.filter(p => !!p.user_id && p.user_id !== folder.owner_id);

      // Hapus yang tidak ada di target
      for (const p of currentUserPerms) {
        if (!targetUserIds.includes(p.user_id!)) {
          await this.permissionRepository.delete(p.id);
        }
      }

      // Tambah / Update yang ada
      for (const up of updateFolderDto.user_permissions) {
        if (up.user_id === folder.owner_id) continue;
        const existing = currentUserPerms.find(p => p.user_id === up.user_id);
        if (existing) {
          await this.permissionRepository.update(existing.id, {
            can_read: !!up.can_read,
            can_download: !!up.can_download,
            can_create: !!up.can_create,
            can_update: !!up.can_update,
            can_delete: !!up.can_delete,
          });
        } else {
          await this.permissionRepository.save({
            folder_id: folder.id,
            user_id: up.user_id,
            can_read: !!up.can_read,
            can_download: !!up.can_download,
            can_create: !!up.can_create,
            can_update: !!up.can_update,
            can_delete: !!up.can_delete,
          });
        }
      }
    }

    // Only update the folder name if it was changed, avoiding full entity save which causes relation sync issues
    if (updateFolderDto.name) {
      await this.folderRepository.update(id, { name: updateFolderDto.name });
    }

    return this.findOne(id); // Kembalikan data segar dengan relasi terbaru
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

    // Fetch ALL matching permissions (both user-level and role-level)
    // so that user-level overrides (e.g. download) work alongside role-level (view-only)
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id = :folderId', { folderId })
      .andWhere(
        '(fp.user_id = :userId OR fp.role_id = :roleId)',
        { userId, roleId },
      )
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getMany();

    if (permissions.length === 0) {
      return false;
    }

    // OR logic: if ANY permission record grants the requested type, allow it
    return permissions.some(permission => {
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
    });
  }

}

