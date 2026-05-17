import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Role, User, Folder, File, SystemSetting, FolderPermission } from '../entities';

interface FolderOverviewItem {
  id: string;
  name: string;
  subfolder_count: number;
  file_count: number;
  storage_size: number;
  updated_at: Date;
}

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
    @InjectRepository(FolderPermission)
    private permissionRepository: Repository<FolderPermission>,
  ) {}

  @Get('super-admin')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getSuperAdminStats() {
    // Total roles
    const totalRoles = await this.roleRepository.count();

    // Total folders (not deleted)
    const totalFolders = await this.folderRepository.count({
      where: { deleted_at: IsNull() },
    });

    // Total files (not deleted)
    const totalFiles = await this.fileRepository.count({
      where: { deleted_at: IsNull() },
    });

    // Folders per unit
    const foldersPerUnit = await this.folderRepository
      .createQueryBuilder('folder')
      .select('folder.unit', 'unit')
      .addSelect('COUNT(*)', 'count')
      .where('folder.deleted_at IS NULL')
      .groupBy('folder.unit')
      .getRawMany();

    // Users per role
    const usersPerRole = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.role', 'role')
      .select('role.name', 'roleName')
      .addSelect('COUNT(*)', 'count')
      .groupBy('role.name')
      .getRawMany();

    // Recent activity
    // 1. Folders
    const recentFolders = await this.folderRepository.find({
      where: { deleted_at: IsNull() },
      order: { created_at: 'DESC' },
      take: 15,
      relations: ['owner'],
    });

    // 2. Files
    const recentFiles = await this.fileRepository.find({
      where: { deleted_at: IsNull() },
      order: { created_at: 'DESC' },
      take: 15,
      relations: ['folder', 'folder.owner'],
    });

    // 3. User creations/updates (Super Admin activity)
    // We assume if a user's updated_at is recent, it's either an update or creation
    const recentUsers = await this.userRepository.find({
      order: { updated_at: 'DESC' },
      take: 15,
      relations: ['role'],
    });

    // Combine and sort recent activity
    const recentActivity = [
      ...recentFolders.map((f) => ({
        timestamp: f.created_at,
        user: f.owner?.email || 'System',
        action: `Create Folder "${f.name}"`,
        type: 'user', // regular user activity
      })),
      ...recentFiles.map((f) => ({
        timestamp: f.created_at,
        user: f.folder?.owner?.email || 'System',
        action: `Upload File "${f.name}"`,
        type: 'user', // regular user activity
      })),
      ...recentUsers.map((u) => {
        // If created_at and updated_at are very close (< 2 seconds), it's a creation
        const isNew = new Date(u.updated_at).getTime() - new Date(u.created_at).getTime() < 2000;
        return {
          timestamp: u.updated_at,
          user: 'Super Admin',
          action: isNew ? `Create User "${u.name}"` : `Update User "${u.name}"`,
          type: 'superadmin', // super admin activity
        };
      }),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30); // Take top 30 items for Hari Ini / Sebelumnya grouping

    // Total storage size
    const storageResult = await this.fileRepository
      .createQueryBuilder('file')
      .select('SUM(file.size)', 'totalSize')
      .where('file.deleted_at IS NULL')
      .getRawOne();
    
    const totalSize = parseInt(storageResult?.totalSize || '0');

    // Get system settings
    const maxDepthSetting = await this.settingRepository.findOne({ where: { key: 'max_folder_depth' } });
    const maxStorageSetting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    const maxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;

    return {
      totalRoles,
      totalFolders,
      totalFiles,
      totalSize,
      maxFolderDepth,
      maxStoragePerUser,
      foldersPerUnit,
      usersPerRole,
      recentActivity,
    };
  }

  // =============================
  // STATS PER USER (SEMUA ROLE)
  // =============================
  @Get('user')
  async getUserStats(@Request() req) {
    const userId = req.user.id;

    // Get user and their role
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role']
    });

    // Use active_role_id from JWT (set by /users/switch-role), not primary role from DB.
    // Same pattern used in folders.service.ts:331, files.service.ts:90, users.controller.ts:62.
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;

    // Build accessible folder IDs as the union of:
    //   1. Workspace folders  — owned by this role (folder.role_id = activeRoleId)
    //   2. Role-based shared  — explicit FolderPermission grants to the whole role group
    //   3. User-specific shared — personal FolderPermission grants scoped to this role (or role-agnostic)
    // This mirrors the two-source model used in getSharedTree() in folders.service.ts, ensuring
    // that dashboard counters, storage, and recent files reflect all resources accessible to the
    // active role — not just folders the role owns. Cross-role contamination is prevented because
    // shared entries require an explicit FolderPermission record with the correct role_id.
    let accessibleFolderIds: string[] = [];

    if (activeRoleId) {
      const now = new Date();

      // 1. Workspace folders owned by this role
      const workspaceFolders = await this.folderRepository
        .createQueryBuilder('folder')
        .select('folder.id', 'id')
        .where('folder.role_id = :activeRoleId', { activeRoleId })
        .andWhere('folder.deleted_at IS NULL')
        .getRawMany();

      // 2. Role-based shared folders: grants issued to the entire role group (user_id IS NULL)
      const roleSharedPerms = await this.permissionRepository
        .createQueryBuilder('fp')
        .select('fp.folder_id', 'folder_id')
        .where('fp.role_id = :activeRoleId', { activeRoleId })
        .andWhere('fp.user_id IS NULL')
        .andWhere('fp.can_read = true')
        .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
        .getRawMany();

      // 3. User-specific shared folders: personal grants in this role context or role-agnostic
      const userSharedPerms = await this.permissionRepository
        .createQueryBuilder('fp')
        .select('fp.folder_id', 'folder_id')
        .where('fp.user_id = :userId', { userId })
        .andWhere('(fp.role_id = :activeRoleId OR fp.role_id IS NULL)', { activeRoleId })
        .andWhere('fp.can_read = true')
        .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
        .getRawMany();

      accessibleFolderIds = Array.from(new Set([
        ...workspaceFolders.map((f) => f.id),
        ...roleSharedPerms.map((p) => p.folder_id),
        ...userSharedPerms.map((p) => p.folder_id),
      ]));
    }

    let totalFolders = 0;
    let totalFiles = 0;
    let totalSize = 0;
    let recentFiles: any[] = [];

    if (accessibleFolderIds.length > 0) {
      // Total accessible folders (not deleted)
      totalFolders = await this.folderRepository.count({
        where: { id: In(accessibleFolderIds), deleted_at: IsNull() },
      });

      // Total files di dalam accessible folders
      totalFiles = await this.fileRepository
        .createQueryBuilder('file')
        .innerJoin('file.folder', 'folder')
        .where('folder.id IN (:...accessibleFolderIds)', { accessibleFolderIds })
        .andWhere('file.deleted_at IS NULL')
        .andWhere('folder.deleted_at IS NULL')
        .getCount();

      // Total storage dari file di dalam accessible folders
      const storageResult = await this.fileRepository
        .createQueryBuilder('file')
        .innerJoin('file.folder', 'folder')
        .select('SUM(file.size)', 'totalSize')
        .where('folder.id IN (:...accessibleFolderIds)', { accessibleFolderIds })
        .andWhere('file.deleted_at IS NULL')
        .andWhere('folder.deleted_at IS NULL')
        .getRawOne();

      totalSize = parseInt(storageResult?.totalSize || '0');

      //  milik user ini (15 terbaru)
      recentFiles = await this.fileRepository
        .createQueryBuilder('file')
        .innerJoinAndSelect('file.folder', 'folder')
        .where('folder.id IN (:...accessibleFolderIds)', { accessibleFolderIds })
        .andWhere('file.deleted_at IS NULL')
        .andWhere('folder.deleted_at IS NULL')
        .orderBy('file.created_at', 'DESC')
        .take(15)
        .getMany();
    }

    // Get max storage per user setting
    const maxStorageSetting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;

    // Get max folder depth setting
    const maxDepthSetting = await this.settingRepository.findOne({ where: { key: 'max_folder_depth' } });
    const globalMaxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;
    
    // Load active role entity to get its max_folder_depth.
    // user.role is always the primary role and does not reflect role switches.
    const activeRole = activeRoleId
      ? await this.roleRepository.findOne({ where: { id: activeRoleId } })
      : null;

    const maxFolderDepth = user?.max_folder_depth != null
      ? user.max_folder_depth
      : (activeRole?.max_folder_depth != null ? activeRole.max_folder_depth : globalMaxFolderDepth);

    return {
      totalFolders,
      totalFiles,
      totalSize,
      maxStoragePerUser,
      maxFolderDepth,
      recentFiles: recentFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        created_at: f.created_at,
        folder_name: f.folder?.name || '-',
      })),
    };
  }

  // =============================
  // FOLDER OVERVIEW (PER ROOT FOLDER STATS)
  // =============================
  @Get('folder-overview')
  async getFolderOverview(@Request() req): Promise<FolderOverviewItem[]> {
    const userId = req.user.id;
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;

    const accessibleFolderIds = await this.getAccessibleFolderIds(userId, activeRoleId);
    if (accessibleFolderIds.length === 0) return [];

    // Fetch all accessible folders (minimal fields)
    const folders = await this.folderRepository.find({
      where: { id: In(accessibleFolderIds), deleted_at: IsNull() },
      select: ['id', 'name', 'parent_id', 'updated_at'],
    });

    // Identify root folders: parent_id is null OR parent is outside the accessible set
    const accessibleSet = new Set(accessibleFolderIds);
    const rootFolders = folders.filter(
      (f) => !f.parent_id || !accessibleSet.has(f.parent_id),
    );

    // Build parent → children map for BFS
    const childrenMap = new Map<string, string[]>();
    for (const folder of folders) {
      if (folder.parent_id && accessibleSet.has(folder.parent_id)) {
        if (!childrenMap.has(folder.parent_id)) childrenMap.set(folder.parent_id, []);
        childrenMap.get(folder.parent_id)!.push(folder.id);
      }
    }

    // BFS: collect all folder IDs under a root (inclusive)
    const collectDescendants = (rootId: string): string[] => {
      const result: string[] = [rootId];
      const queue = [rootId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = childrenMap.get(current) ?? [];
        result.push(...children);
        queue.push(...children);
      }
      return result;
    };

    // For each root folder, count files + storage across all descendants
    const results = await Promise.all(
      rootFolders.map(async (root) => {
        const allIds = collectDescendants(root.id);
        const subfolderCount = allIds.length - 1;

        const fileStats = await this.fileRepository
          .createQueryBuilder('file')
          .select('COUNT(*)', 'count')
          .addSelect('COALESCE(SUM(file.size), 0)', 'totalSize')
          .where('file.folder_id IN (:...folderIds)', { folderIds: allIds })
          .andWhere('file.deleted_at IS NULL')
          .getRawOne();

        return {
          id: root.id,
          name: root.name,
          subfolder_count: subfolderCount,
          file_count: parseInt(fileStats?.count ?? '0', 10),
          storage_size: parseInt(fileStats?.totalSize ?? '0', 10),
          updated_at: root.updated_at,
        };
      }),
    );

    return results;
  }

  // =============================
  // FOLDER CHILDREN STATS (LAZY EXPAND)
  // =============================
  @Get('folder-children/:folderId')
  async getFolderChildrenStats(
    @Param('folderId') folderId: string,
    @Request() req,
  ): Promise<FolderOverviewItem[]> {
    const userId = req.user.id;
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;

    const accessibleFolderIds = await this.getAccessibleFolderIds(userId, activeRoleId);
    if (accessibleFolderIds.length === 0) return [];

    // Verify the requested folder is accessible
    if (!accessibleFolderIds.includes(folderId)) return [];

    // Fetch all accessible folders for BFS
    const allAccessibleFolders = await this.folderRepository.find({
      where: { id: In(accessibleFolderIds), deleted_at: IsNull() },
      select: ['id', 'name', 'parent_id', 'updated_at'],
    });

    // Build parent → children map
    const accessibleSet = new Set(accessibleFolderIds);
    const childrenMap = new Map<string, typeof allAccessibleFolders>();
    for (const folder of allAccessibleFolders) {
      if (folder.parent_id && accessibleSet.has(folder.parent_id)) {
        if (!childrenMap.has(folder.parent_id)) childrenMap.set(folder.parent_id, []);
        childrenMap.get(folder.parent_id)!.push(folder);
      }
    }

    // BFS: collect all descendant IDs under a node (inclusive)
    const collectDescendantIds = (nodeId: string): string[] => {
      const result: string[] = [nodeId];
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = (childrenMap.get(current) ?? []).map((f) => f.id);
        result.push(...children);
        queue.push(...children);
      }
      return result;
    };

    // Direct children of the requested folder
    const directChildren = childrenMap.get(folderId) ?? [];
    if (directChildren.length === 0) return [];

    // For each direct child, compute recursive stats
    const results = await Promise.all(
      directChildren.map(async (child) => {
        const allIds = collectDescendantIds(child.id);
        const subfolderCount = allIds.length - 1;

        const fileStats = await this.fileRepository
          .createQueryBuilder('file')
          .select('COUNT(*)', 'count')
          .addSelect('COALESCE(SUM(file.size), 0)', 'totalSize')
          .where('file.folder_id IN (:...folderIds)', { folderIds: allIds })
          .andWhere('file.deleted_at IS NULL')
          .getRawOne();

        return {
          id: child.id,
          name: child.name,
          subfolder_count: subfolderCount,
          file_count: parseInt(fileStats?.count ?? '0', 10),
          storage_size: parseInt(fileStats?.totalSize ?? '0', 10),
          updated_at: child.updated_at,
        };
      }),
    );

    return results;
  }

  // Shared helper: returns all folder IDs accessible to the given user + active role
  private async getAccessibleFolderIds(userId: string, activeRoleId: string | null): Promise<string[]> {
    if (!activeRoleId) return [];

    const now = new Date();

    const workspaceFolders = await this.folderRepository
      .createQueryBuilder('folder')
      .select('folder.id', 'id')
      .where('folder.role_id = :activeRoleId', { activeRoleId })
      .andWhere('folder.deleted_at IS NULL')
      .getRawMany();

    const roleSharedPerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('fp.role_id = :activeRoleId', { activeRoleId })
      .andWhere('fp.user_id IS NULL')
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getRawMany();

    const userSharedPerms = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('fp.user_id = :userId', { userId })
      .andWhere('(fp.role_id = :activeRoleId OR fp.role_id IS NULL)', { activeRoleId })
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getRawMany();

    return Array.from(new Set([
      ...workspaceFolders.map((f) => f.id),
      ...roleSharedPerms.map((p) => p.folder_id),
      ...userSharedPerms.map((p) => p.folder_id),
    ]));
  }
}
