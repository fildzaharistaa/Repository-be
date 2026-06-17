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

    // Subfolders inherit the parent folder's role_id to stay in the same workspace.
    // Exception: private roles (e.g. Dosen/Tendik) keep their own activeRoleId so that
    // each user's subfolders stay isolated — unless is_shared_subfolder=true, which
    // means the user explicitly chose to share it with everyone who has access to the parent.
    const activeRole = activeRoleId
      ? await this.roleRepository.findOne({ where: { id: activeRoleId } })
      : null;

    let folderRoleId = activeRoleId || null;
    if (createFolderDto.parent_id) {
      const shouldInherit = !activeRole?.is_private || createFolderDto.is_shared_subfolder;
      if (shouldInherit) {
        const parent = await this.folderRepository.findOne({
          where: { id: createFolderDto.parent_id },
        });
        if (parent?.role_id) {
          folderRoleId = parent.role_id;
        }
      }
    }

    // Derive unit from the resolved folder role (active role context), not user's primary role
    let folderUnit = 'general';
    if (folderRoleId) {
      const folderRole = await this.roleRepository.findOne({ where: { id: folderRoleId } });
      folderUnit = folderRole?.name?.toLowerCase().substring(0, 50) || 'general';
    } else if (user?.role?.name) {
      folderUnit = user.role.name.toLowerCase().substring(0, 50);
    }

    const folder = this.folderRepository.create({
      ...createFolderDto,
      role_id: folderRoleId,
      owner: { id: userId } as User,
      unit: folderUnit,
    });

    const savedFolder = await this.folderRepository.save(folder);

    // Grant full permissions to the creator's active role so all users of that role inherit access.
    // We intentionally do NOT create a separate user-level permission with role_id=NULL here.
    // A null role_id would mean "accessible in any role context", which causes cross-role leakage:
    // a folder created under "Koordinator Prodi SI" would appear in the creator's "Dosen"
    // Shared Folders because getSharedTree() matches fp.role_id IS NULL for user grants.
    // The role-level permission below is sufficient — it grants access only when the creator
    // is operating under the exact role the folder was created in.
    const creatorRoleId = activeRoleId || user?.role?.id || null;
    if (creatorRoleId) {
      const existingRolePerm = await this.permissionRepository.findOne({
        where: { folder_id: savedFolder.id, role_id: creatorRoleId }
      });
      if (!existingRolePerm) {
        await this.permissionRepository.save({
          folder_id: savedFolder.id,
          role_id: creatorRoleId,
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

    // If creating a subfolder inside an already-shared parent and the caller did NOT
    // explicitly specify share_with_roles, inherit the parent's role-based permissions.
    // This ensures users who can see the parent automatically see new subfolders too.
    // Skip for private-role folders: a private workspace subfolder must not inherit role-level
    // permissions from the parent, as that would make it visible to all members of those roles.
    if (createFolderDto.parent_id && !createFolderDto.share_with_roles?.length && !activeRole?.is_private) {
      const parentRolePerms = await this.permissionRepository.find({
        where: { folder_id: createFolderDto.parent_id, user_id: IsNull() },
      });
      for (const parentPerm of parentRolePerms) {
        if (!parentPerm.role_id) continue;
        if (parentPerm.role_id === creatorRoleId) continue; // already set above
        const existing = await this.permissionRepository.findOne({
          where: { folder_id: savedFolder.id, role_id: parentPerm.role_id, user_id: IsNull() },
        });
        if (!existing) {
          await this.permissionRepository.save({
            folder_id: savedFolder.id,
            role_id: parentPerm.role_id,
            can_read: parentPerm.can_read,
            can_create: parentPerm.can_create,
            can_update: parentPerm.can_update,
            can_delete: parentPerm.can_delete,
            can_download: parentPerm.can_download,
            expires_at: parentPerm.expires_at ?? null,
          });
        }
      }
    }

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
    // Permission identity = (user_id + role_id): scopes the grant to a specific user
    // acting in a specific role context. role_id IS NULL means "any role context".
    if (createFolderDto.user_permissions && createFolderDto.user_permissions.length > 0) {
      for (const perm of createFolderDto.user_permissions) {
        const permRoleId: string | null = perm.role_id ?? null;
        const existing = await this.permissionRepository.findOne({
          where: {
            folder_id: savedFolder.id,
            user_id: perm.user_id,
            role_id: permRoleId === null ? IsNull() : permRoleId,
          },
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
            role_id: permRoleId,
            can_read: !!perm.can_read,
            can_create: !!perm.can_create,
            can_update: !!perm.can_update,
            can_delete: !!perm.can_delete,
            can_download: !!perm.can_download,
          });
        }
      }
    }

    // Auto-create default subfolders and copy all parent permissions to each one.
    // Permissions are fetched AFTER all parent grants/shares are saved, so every
    // subfolder receives the complete set (creator user, creator role, shared roles,
    // individual user overrides) without any manual re-configuration.
    if (createFolderDto.initial_subfolders?.length) {
      const parentPerms = await this.permissionRepository.find({
        where: { folder_id: savedFolder.id },
      });

      for (const subName of createFolderDto.initial_subfolders) {
        const trimmed = subName.trim();
        if (!trimmed) continue;

        const subFolder = this.folderRepository.create({
          name: trimmed,
          parent_id: savedFolder.id,
          role_id: savedFolder.role_id,
          owner: { id: userId } as User,
          unit: savedFolder.unit,
        });
        const savedSub = await this.folderRepository.save(subFolder);

        for (const perm of parentPerms) {
          await this.permissionRepository.save({
            folder_id: savedSub.id,
            user_id: perm.user_id ?? null,
            role_id: perm.role_id ?? null,
            can_read: perm.can_read,
            can_create: perm.can_create,
            can_update: perm.can_update,
            can_delete: perm.can_delete,
            can_download: perm.can_download,
            expires_at: perm.expires_at ?? null,
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

  async findOneForUser(id: string, user: User): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['parent', 'permissions', 'permissions.role', 'permissions.user', 'owner', 'role'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const isOwner = folder.owner_id === user.id;

    // Private-role folders are bound to the exact (user, role) creation context.
    // Only the owner, operating under the folder's own role, may open it.
    if (folder.role?.is_private) {
      if (!isOwner || activeRoleId !== folder.role_id) {
        throw new ForbiddenException('Access denied');
      }
    }

    if (!isOwner) {
      const hasSharedAccess = await this.checkPermission(user.id, activeRoleId, id, 'read');
      if (!hasSharedAccess) {
        throw new ForbiddenException('Access denied');
      }
    }

    // Load children with their own role relation so the privacy filter can inspect them.
    const allChildren = await this.folderRepository.find({
      where: { parent_id: id, deleted_at: IsNull() },
      relations: { owner: { role: true }, role: true },
      order: { name: 'ASC' },
    });

    // A private-role child is only visible when the current user is its owner AND is
    // operating under the exact role the child belongs to.  Non-private children from
    // another user's private workspace are always hidden regardless of ownership.
    folder.children = allChildren.filter((child) => {
      if ((child as any).role?.is_private) {
        return child.owner_id === user.id && child.role_id === activeRoleId;
      }
      if ((child.owner as any)?.role?.is_private && child.owner_id !== user.id) return false;
      return true;
    });

    return folder;
  }

  async findAllAccessible(user: User): Promise<Folder[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];

    const role = await this.roleRepository.findOne({ where: { id: activeRoleId } });
    const isPrivate = role?.is_private === true;

    const where = isPrivate
      ? { role_id: activeRoleId, owner_id: user.id, deleted_at: IsNull() }
      : { role_id: activeRoleId, deleted_at: IsNull() };

    return this.folderRepository.find({
      where,
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

    const role = await this.roleRepository.findOne({ where: { id: activeRoleId } });
    const isPrivate = role?.is_private === true;

    const where = isPrivate
      ? { role_id: activeRoleId, owner_id: user.id, deleted_at: IsNull() }
      : { role_id: activeRoleId, deleted_at: IsNull() };

    const folders = await this.folderRepository.find({
      where,
      order: { name: 'ASC' },
    });

    // For private roles: some folders may be private subfolders of shared folders.
    // Their parent is outside this workspace so they appear as root nodes, but we
    // want to show the user which shared folder they belong to.
    if (isPrivate && folders.length > 0) {
      const folderIds = new Set(folders.map((f) => f.id));
      const orphanParentIds = [
        ...new Set(
          folders
            .filter((f) => f.parent_id && !folderIds.has(f.parent_id))
            .map((f) => f.parent_id!),
        ),
      ];

      if (orphanParentIds.length > 0) {
        const parents = await this.folderRepository.find({
          where: { id: In(orphanParentIds) },
          select: ['id', 'name'],
        });
        const parentMap = new Map(parents.map((p) => [p.id, p.name]));
        for (const folder of folders) {
          if (folder.parent_id && !folderIds.has(folder.parent_id)) {
            (folder as any).shared_parent_name = parentMap.get(folder.parent_id) ?? null;
          }
        }
      }
    }

    return this.buildTree(folders);
  }

  private async expandDescendants(folderIds: string[]): Promise<string[]> {
    const allIds = new Set(folderIds);
    const queue = [...folderIds];
    while (queue.length > 0) {
      const batch = queue.splice(0, 100);
      const children = await this.folderRepository.find({
        where: { parent_id: In(batch), deleted_at: IsNull() },
        select: ['id'],
      });
      for (const child of children) {
        if (!allIds.has(child.id)) {
          allIds.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return [...allIds];
  }

  async getSharedTree(user: User): Promise<any[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    const now = new Date();

    // --- 1. Role-based shared folders ---
    // Folders where a permission record targets the active role (user_id is irrelevant here;
    // the grant is to the entire role group).  A private-workspace folder should never
    // receive cross-role grants, but guard here as defence-in-depth.
    const rolePerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .innerJoin('folders', 'f3', 'f3.id = fp.folder_id AND f3.deleted_at IS NULL')
      .leftJoin('roles', 'r3', 'r3.id = f3.role_id')
      .select('fp.folder_id', 'folder_id')
      .where('fp.role_id = :roleId', { roleId: activeRoleId })
      .andWhere('fp.user_id IS NULL')
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .andWhere('NOT (r3.is_private = true AND f3.role_id != :roleId)', { roleId: activeRoleId })
      .getRawMany();

    // --- 2. User-specific shared folders ---
    // Explicit personal grants: permission targets this user, optionally scoped to their
    // current active role or with no role restriction (role_id IS NULL).
    // JOIN to folders/roles so we can exclude private-workspace folders that belong to a
    // different role context — guards against legacy role_id=NULL permissions on private folders.
    const userPerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .innerJoin('folders', 'f2', 'f2.id = fp.folder_id AND f2.deleted_at IS NULL')
      .leftJoin('roles', 'r2', 'r2.id = f2.role_id')
      .select('fp.folder_id', 'folder_id')
      .where('fp.user_id = :userId', { userId: user.id })
      .andWhere('(fp.role_id = :roleId OR fp.role_id IS NULL)', { roleId: activeRoleId })
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .andWhere('NOT (r2.is_private = true AND f2.role_id != :roleId)', { roleId: activeRoleId })
      .getRawMany();

    const roleSharedIds = new Set(rolePerms.map((p) => p.folder_id));
    const userSharedIds = new Set(userPerms.map((p) => p.folder_id));
    const directSharedIds = [...new Set([...roleSharedIds, ...userSharedIds])];

    if (!directSharedIds.length) return [];

    // Expand: include all descendant subfolders of the directly-shared folders.
    // Without this, a Dosen user who has access to a parent folder would see the
    // parent but none of its children (they have no direct permission records).
    const allSharedIds = await this.expandDescendants(directSharedIds);

    const folders = await this.folderRepository.find({
      where: { id: In(allSharedIds), deleted_at: IsNull() },
      relations: ['owner', 'owner.role', 'role'],
      order: { name: 'ASC' },
    });

    // Filter logic:
    //  - Explicit user-level grants (userSharedIds) always show — this covers cross-role
    //    self-sharing where an owner explicitly grants access to their own folder for a
    //    different role context (e.g. WD2 Bambang grants Dosen Bambang access).
    //  - Role-only access on owner's folders: exclude — the owner already sees those via
    //    "My Folders" in their workspace tree. This prevents implicit auto-duplication.
    //  - Role-based shares on others' folders: only show when the workspace differs from
    //    the active role (same-workspace folders are already visible in "My Folders").
    //  - Descendants of directly-shared folders are included via expandDescendants; the
    //    same filter rules apply and work correctly because descendants are owned by the
    //    sharer (owner_id ≠ current user) and have a different role_id than activeRoleId.
    const sharedFolders = folders.filter((f) => {
      // A private-role folder is bound exclusively to its (user, role) creation context.
      // Hide it from all other role views — including the same user's other roles.
      if (f.role?.is_private && f.role_id !== activeRoleId) return false;

      if (userSharedIds.has(f.id)) return true;
      // Hanya exclude folder milik user jika folder itu ada di workspace role aktif saat ini
      // (sudah terlihat di "My Folders"). Folder dari workspace lain (beda role) tetap tampil
      // jika ada role-permission untuk role aktif.
      if (f.owner_id === user.id && f.role_id === activeRoleId) return false;
      return f.role_id !== activeRoleId;
    });

    return this.buildTreeWithOwner(sharedFolders);
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
        shared_parent_name: (folder as any).shared_parent_name ?? null,
        children: [],
      } as any);
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
        owner_role: folder.role?.name ?? null,
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

  private async propagatePermissionsToDescendants(
    parentId: string,
    addedRoleIds: string[],
    removedRoleIds: string[],
    ownerRoleId: string | null,
  ): Promise<void> {
    if (!addedRoleIds.length && !removedRoleIds.length) return;
    const children = await this.folderRepository.find({
      where: { parent_id: parentId, deleted_at: IsNull() },
      select: ['id'],
    });
    for (const child of children) {
      if (removedRoleIds.length) {
        await this.permissionRepository
          .createQueryBuilder()
          .delete()
          .from(FolderPermission)
          .where('folder_id = :folderId', { folderId: child.id })
          .andWhere('role_id IN (:...roleIds)', { roleIds: removedRoleIds })
          .andWhere('user_id IS NULL')
          .execute();
      }
      for (const roleId of addedRoleIds) {
        if (roleId === ownerRoleId) continue;
        const existing = await this.permissionRepository.findOne({
          where: { folder_id: child.id, role_id: roleId, user_id: IsNull() },
        });
        if (!existing) {
          const role = await this.roleRepository.findOne({ where: { id: roleId } });
          const isDosenOrTendik = role ? this.isDosenOrTendikRole(role.name) : false;
          await this.permissionRepository.save({
            folder_id: child.id,
            role_id: roleId,
            can_read: true,
            can_download: false,
            can_create: isDosenOrTendik,
            can_update: isDosenOrTendik,
            can_delete: isDosenOrTendik,
          });
        }
      }
      await this.propagatePermissionsToDescendants(child.id, addedRoleIds, removedRoleIds, ownerRoleId);
    }
  }

  async update(id: string, updateFolderDto: UpdateFolderDto): Promise<Folder> {
    const folder = await this.findOne(id);

    if (updateFolderDto.name) {
      folder.name = updateFolderDto.name;
    }

    // Protect the folder's workspace role (the role the folder was created under).
    // Prefer folder.role_id because it reflects the active role at creation time,
    // not the owner's current primary role (which may differ for multi-role users).
    const ownerUser = folder.owner_id
      ? await this.folderRepository.manager.getRepository(User).findOne({
        where: { id: folder.owner_id },
        relations: ['role'],
      })
      : null;
    const ownerRoleId = folder.role_id || ownerUser?.role?.id || null;

    // --- SINKRONISASI GRUP ROLE SHARING ---
    if (updateFolderDto.share_with_roles) {
      const targetRoleIds: string[] = [];
      for (const roleLabel of updateFolderDto.share_with_roles) {
        const role = await this.findRoleByLabel(roleLabel);
        if (role) targetRoleIds.push(role.id);
      }

      // Track changes for recursive propagation to descendants
      const addedRoleIds: string[] = [];
      const removedRoleIds: string[] = [];

      // Hapus izin role yang tidak ada di targetRoleIds untuk folder ini
      // PENTING: Jangan hapus permission role milik owner folder sendiri
      const currentRolePerms = folder.permissions.filter(p => !!p.role_id);
      for (const p of currentRolePerms) {
        // Protect owner's own role permission
        if (p.role_id === ownerRoleId) continue;
        if (!targetRoleIds.includes(p.role_id!)) {
          await this.permissionRepository.delete(p.id);
          removedRoleIds.push(p.role_id!);
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
          addedRoleIds.push(roleId);
        }
      }

      // Propagate permission changes recursively to all existing subfolders
      await this.propagatePermissionsToDescendants(folder.id, addedRoleIds, removedRoleIds, ownerRoleId);
    }

    // --- SINKRONISASI USER PERMISSIONS ---
    // Identity key = (user_id + role_id) pair so that role-scoped grants are
    // handled independently from unscoped (role_id IS NULL) grants.
    if (updateFolderDto.user_permissions) {
      const currentUserPerms = folder.permissions.filter(p => !!p.user_id);

      // Delete permissions no longer in the target list (matched by user_id + role_id)
      for (const p of currentUserPerms) {
        const inTarget = updateFolderDto.user_permissions.some(
          up => up.user_id === p.user_id && (up.role_id ?? null) === p.role_id,
        );
        if (!inTarget) {
          await this.permissionRepository.delete(p.id);
        }
      }

      // Add / Update
      for (const up of updateFolderDto.user_permissions) {
        const upRoleId: string | null = up.role_id ?? null;
        // Skip redundant self-permissions only when role context matches the owner's
        // workspace role or is unscoped — the owner already has full access there.
        // Cross-role explicit grants (different role_id) must be saved.
        if (up.user_id === folder.owner_id && (upRoleId === null || upRoleId === folder.role_id)) continue;
        const existing = currentUserPerms.find(
          p => p.user_id === up.user_id && p.role_id === upRoleId,
        );
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
            role_id: upRoleId,
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
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];
    const now = new Date();

    const activeRole = await this.roleRepository.findOne({ where: { id: activeRoleId } });

    // 1. Workspace folders for the active role.
    //    Private roles (Dosen/Tendik) are scoped to the owner — other users' private folders
    //    must not appear even within the same role workspace.
    const workspaceQuery = this.folderRepository
      .createQueryBuilder('folder')
      .select('folder.id', 'id')
      .where('folder.role_id = :activeRoleId', { activeRoleId })
      .andWhere('folder.deleted_at IS NULL');
    if (activeRole?.is_private) {
      workspaceQuery.andWhere('folder.owner_id = :userId', { userId: user.id });
    }
    const workspaceFolders = await workspaceQuery.getRawMany();

    // 2. Role-based shared folders: grants issued to the entire active role group,
    //    pointing at folders in a different workspace.  Private-workspace folders are
    //    excluded even if they somehow have a cross-role permission record.
    const roleSharedPerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .innerJoin('folders', 'f2', 'f2.id = fp.folder_id AND f2.deleted_at IS NULL')
      .leftJoin('roles', 'r2', 'r2.id = f2.role_id')
      .select('fp.folder_id', 'folder_id')
      .where('fp.role_id = :activeRoleId', { activeRoleId })
      .andWhere('fp.user_id IS NULL')
      .andWhere('(fp.can_read = true OR fp.can_create = true OR fp.can_update = true OR fp.can_delete = true)')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .andWhere('f2.role_id != :activeRoleId', { activeRoleId })
      .andWhere('NOT (r2.is_private = true AND f2.role_id != :activeRoleId)', { activeRoleId })
      .getRawMany();

    // 3. User-specific shared folders: personal grants scoped to the active role
    //    (or role-agnostic grants with role_id IS NULL).  Same private guard applied.
    const userSharedPerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .innerJoin('folders', 'f2', 'f2.id = fp.folder_id AND f2.deleted_at IS NULL')
      .leftJoin('roles', 'r2', 'r2.id = f2.role_id')
      .select('fp.folder_id', 'folder_id')
      .where('fp.user_id = :userId', { userId: user.id })
      .andWhere('(fp.role_id = :activeRoleId OR fp.role_id IS NULL)', { activeRoleId })
      .andWhere('(fp.can_read = true OR fp.can_create = true OR fp.can_update = true OR fp.can_delete = true)')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .andWhere('NOT (r2.is_private = true AND f2.role_id != :activeRoleId)', { activeRoleId })
      .getRawMany();

    return Array.from(new Set([
      ...workspaceFolders.map((f) => f.id),
      ...roleSharedPerms.map((p) => p.folder_id),
      ...userSharedPerms.map((p) => p.folder_id),
    ]));
  }

  async checkPermission(
    userId: string,
    roleId: string,
    folderId: string,
    permissionType: 'read' | 'create' | 'update' | 'delete' | 'download',
  ): Promise<boolean> {
    const now = new Date();

    // Load folder with role relation and permission records in parallel.
    // The role relation is required to enforce private workspace isolation.
    const [folder, permissions] = await Promise.all([
      this.folderRepository.findOne({
        where: { id: folderId },
        relations: ['role'],
      }),
      this.permissionRepository
        .createQueryBuilder('fp')
        .where('fp.folder_id = :folderId', { folderId })
        .andWhere('(fp.user_id = :userId OR fp.role_id = :roleId)', { userId, roleId })
        .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
        .getMany(),
    ]);

    if (!folder) return false;

    // Private-role folders are bound to the exact (user, role) combination at creation.
    // Only the owner, operating under the folder's own role, may access it.
    // This prevents the owner from accessing their own private folder via a different role.
    if (folder.role?.is_private) {
      return folder.owner_id === userId && roleId === folder.role_id;
    }

    // Non-private: folder owner always has full access regardless of permission records.
    if (folder.owner_id === userId) return true;

    if (permissions.length === 0) {
      // No direct permission — check if user inherits access from an ancestor folder
      // that was explicitly shared with them.
      const ancestorIds: string[] = [];
      let parentId = folder.parent_id;
      while (parentId && ancestorIds.length < 10) {
        const parent = await this.folderRepository.findOne({
          where: { id: parentId },
          select: ['id', 'owner_id', 'parent_id'],
        });
        if (!parent) break;
        if (parent.owner_id === userId) return true;
        ancestorIds.push(parent.id);
        parentId = parent.parent_id ?? null;
      }
      if (!ancestorIds.length) return false;

      const ancestorPerms = await this.permissionRepository
        .createQueryBuilder('fp')
        .where('fp.folder_id IN (:...folderIds)', { folderIds: ancestorIds })
        .andWhere('(fp.user_id = :userId OR fp.role_id = :roleId)', { userId, roleId })
        .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
        .getMany();

      return ancestorPerms.some(permission => {
        switch (permissionType) {
          case 'read': return permission.can_read;
          case 'create': return permission.can_create;
          case 'update': return permission.can_update;
          case 'delete': return permission.can_delete;
          case 'download': return permission.can_download;
          default: return false;
        }
      });
    }

    // OR logic: if ANY permission record grants the requested type, allow it
    return permissions.some(permission => {
      switch (permissionType) {
        case 'read': return permission.can_read;
        case 'create': return permission.can_create;
        case 'update': return permission.can_update;
        case 'delete': return permission.can_delete;
        case 'download': return permission.can_download;
        default: return false;
      }
    });
  }

}

