import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface FolderOverviewItem {
  id: string;
  name: string;
  subfolder_count: number;
  file_count: number;
  storage_size: number;
  updated_at: Date;
  owner_name: string | null;
  owner_email: string | null;
  owner_role: string | null;
  is_shared: boolean;
}

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private prisma: PrismaService) {}

  @Get('super-admin')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getSuperAdminStats() {
    const totalRoles = await this.prisma.roles.count();
    const totalFolders = await this.prisma.folders.count({ where: { deleted_at: null } });
    const totalFiles = await this.prisma.files.count({ where: { deleted_at: null } });

    const foldersPerUnit = await this.prisma.$queryRaw<Array<{ unit: string; count: string }>>`
      SELECT r.name as unit, COUNT(*)::text as count
      FROM folders f
      INNER JOIN roles r ON r.id = f.role_id
      WHERE f.deleted_at IS NULL AND f.role_id IS NOT NULL
      GROUP BY r.name
    `;

    const usersPerRole = await this.prisma.$queryRaw<Array<{ roleName: string; count: string }>>`
      SELECT r.name as "roleName", COUNT(DISTINCT ur.user_id)::text as count
      FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE ur.deleted_at IS NULL AND ur.status = 'ACTIVE'
      GROUP BY r.name
      ORDER BY count DESC
    `;

    const recentFolders = await this.prisma.folders.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 15,
      include: { users: true },
    });

    const recentFiles = await this.prisma.files.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 15,
      include: { folders: { include: { users: true } } },
    });

    const recentUsers = await this.prisma.users.findMany({
      orderBy: { updated_at: 'desc' },
      take: 15,
      include: { roles: true },
    });

    const recentActivity = [
      ...recentFolders.map((f) => ({
        timestamp: f.created_at,
        user: f.users?.email || 'System',
        action: `Create Folder "${f.name}"`,
        type: 'user',
      })),
      ...recentFiles.map((f) => ({
        timestamp: f.created_at,
        user: f.folders?.users?.email || 'System',
        action: `Upload File "${f.name}"`,
        type: 'user',
      })),
      ...recentUsers.map((u) => {
        const isNew = new Date(u.updated_at).getTime() - new Date(u.created_at).getTime() < 2000;
        return {
          timestamp: u.updated_at,
          user: 'Super Admin',
          action: isNew ? `Create User "${u.name}"` : `Update User "${u.name}"`,
          type: 'superadmin',
        };
      }),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30);

    const storageAgg = await this.prisma.files.aggregate({
      where: { deleted_at: null },
      _sum: { size: true },
    });
    const totalSize = Number(storageAgg._sum.size ?? 0);

    const storagePerUnit = await this.prisma.$queryRaw<Array<{ unit: string; totalSize: string }>>`
      SELECT r.name as unit, COALESCE(SUM(f.size), 0)::text as "totalSize"
      FROM files f
      INNER JOIN folders folder ON folder.id = f.folder_id
      INNER JOIN roles r ON r.id = folder.role_id
      WHERE f.deleted_at IS NULL AND folder.deleted_at IS NULL AND folder.role_id IS NOT NULL
      GROUP BY r.name
    `;

    const maxDepthSetting = await this.prisma.system_settings.findUnique({ where: { key: 'max_folder_depth' } });
    const maxStorageSetting = await this.prisma.system_settings.findUnique({ where: { key: 'max_storage_per_user' } });
    const maxUploadSetting = await this.prisma.system_settings.findUnique({ where: { key: 'max_upload_size' } });
    const maxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;
    const maxUploadSize = maxUploadSetting ? parseInt(maxUploadSetting.value, 10) : 5242880;

    return {
      totalRoles,
      totalFolders,
      totalFiles,
      totalSize,
      maxFolderDepth,
      maxStoragePerUser,
      maxUploadSize,
      foldersPerUnit: foldersPerUnit.map((r) => ({ unit: r.unit, count: r.count })),
      storagePerUnit: storagePerUnit.map((r) => ({ unit: r.unit, totalSize: r.totalSize })),
      usersPerRole: usersPerRole.map((r) => ({ roleName: r.roleName, count: r.count })),
      recentActivity,
    };
  }

  @Get('user')
  async getUserStats(@Request() req) {
    const userId = req.user.id;

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    (user as any).role = user?.roles;

    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;
    const accessibleFolderIds = await this.getAccessibleFolderIds(userId, activeRoleId);

    let totalFolders = 0;
    let totalFiles = 0;
    let totalSize = 0;
    let recentFiles: any[] = [];

    if (accessibleFolderIds.length > 0) {
      totalFolders = await this.prisma.folders.count({
        where: { id: { in: accessibleFolderIds }, deleted_at: null },
      });

      totalFiles = await this.prisma.files.count({
        where: {
          folder_id: { in: accessibleFolderIds },
          deleted_at: null,
          folders: { deleted_at: null },
        },
      });

      const storageAgg = await this.prisma.files.aggregate({
        where: {
          folder_id: { in: accessibleFolderIds },
          deleted_at: null,
          folders: { deleted_at: null },
        },
        _sum: { size: true },
      });
      totalSize = Number(storageAgg._sum.size ?? 0);

      recentFiles = await this.prisma.files.findMany({
        where: {
          folder_id: { in: accessibleFolderIds },
          deleted_at: null,
          folders: { deleted_at: null },
        },
        include: { folders: true },
        orderBy: { created_at: 'desc' },
        take: 15,
      });
    }

    const maxStorageSetting = await this.prisma.system_settings.findUnique({ where: { key: 'max_storage_per_user' } });
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;

    const maxDepthSetting = await this.prisma.system_settings.findUnique({ where: { key: 'max_folder_depth' } });
    const globalMaxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;

    const activeRole = activeRoleId
      ? await this.prisma.roles.findUnique({ where: { id: activeRoleId } })
      : null;

    const maxFolderDepth =
      user?.max_folder_depth != null
        ? user.max_folder_depth
        : activeRole?.max_folder_depth != null
        ? activeRole.max_folder_depth
        : globalMaxFolderDepth;

    return {
      totalFolders,
      totalFiles,
      totalSize,
      maxStoragePerUser,
      maxFolderDepth,
      recentFiles: recentFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: Number(f.size),
        created_at: f.created_at,
        folder_name: f.folders?.name || '-',
      })),
    };
  }

  @Get('folder-overview')
  async getFolderOverview(@Request() req): Promise<FolderOverviewItem[]> {
    const userId = req.user.id;
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;

    const accessibleFolderIds = await this.getAccessibleFolderIds(userId, activeRoleId);
    if (accessibleFolderIds.length === 0) return [];

    const folders = await this.prisma.folders.findMany({
      where: { id: { in: accessibleFolderIds }, deleted_at: null },
      include: { users: true, roles: true },
    });

    const accessibleSet = new Set(accessibleFolderIds);
    const rootFolders = folders.filter((f) => !f.parent_id || !accessibleSet.has(f.parent_id));

    const childrenMap = new Map<string, string[]>();
    for (const folder of folders) {
      if (folder.parent_id && accessibleSet.has(folder.parent_id)) {
        if (!childrenMap.has(folder.parent_id)) childrenMap.set(folder.parent_id, []);
        childrenMap.get(folder.parent_id)!.push(folder.id);
      }
    }

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

    const results = await Promise.all(
      rootFolders.map(async (root) => {
        const allIds = collectDescendants(root.id);
        const subfolderCount = allIds.length - 1;

        const fileStats = await this.prisma.$queryRaw<Array<{ count: string; totalSize: string }>>`
          SELECT COUNT(*)::text as count, COALESCE(SUM(size), 0)::text as "totalSize"
          FROM files
          WHERE folder_id = ANY(${allIds}::uuid[]) AND deleted_at IS NULL
        `;

        return {
          id: root.id,
          name: root.name,
          subfolder_count: subfolderCount,
          file_count: parseInt(fileStats[0]?.count ?? '0', 10),
          storage_size: parseInt(fileStats[0]?.totalSize ?? '0', 10),
          updated_at: root.updated_at,
          owner_name: root.users?.name ?? null,
          owner_email: root.users?.email ?? null,
          owner_role: root.roles?.name ?? null,
          is_shared: root.role_id !== activeRoleId,
        };
      }),
    );

    return results;
  }

  @Get('folder-children/:folderId')
  async getFolderChildrenStats(
    @Param('folderId') folderId: string,
    @Request() req,
  ): Promise<FolderOverviewItem[]> {
    const userId = req.user.id;
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id ?? null;

    const accessibleFolderIds = await this.getAccessibleFolderIds(userId, activeRoleId);
    if (accessibleFolderIds.length === 0) return [];
    if (!accessibleFolderIds.includes(folderId)) return [];

    const allAccessibleFolders = await this.prisma.folders.findMany({
      where: { id: { in: accessibleFolderIds }, deleted_at: null },
      select: { id: true, name: true, parent_id: true, updated_at: true },
    });

    const accessibleSet = new Set(accessibleFolderIds);
    const childrenMap = new Map<string, typeof allAccessibleFolders>();
    for (const folder of allAccessibleFolders) {
      if (folder.parent_id && accessibleSet.has(folder.parent_id)) {
        if (!childrenMap.has(folder.parent_id)) childrenMap.set(folder.parent_id, []);
        childrenMap.get(folder.parent_id)!.push(folder);
      }
    }

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

    const directChildren = childrenMap.get(folderId) ?? [];
    if (directChildren.length === 0) return [];

    const results = await Promise.all(
      directChildren.map(async (child) => {
        const allIds = collectDescendantIds(child.id);
        const subfolderCount = allIds.length - 1;

        const fileStats = await this.prisma.$queryRaw<Array<{ count: string; totalSize: string }>>`
          SELECT COUNT(*)::text as count, COALESCE(SUM(size), 0)::text as "totalSize"
          FROM files
          WHERE folder_id = ANY(${allIds}::uuid[]) AND deleted_at IS NULL
        `;

        return {
          id: child.id,
          name: child.name,
          subfolder_count: subfolderCount,
          file_count: parseInt(fileStats[0]?.count ?? '0', 10),
          storage_size: parseInt(fileStats[0]?.totalSize ?? '0', 10),
          updated_at: child.updated_at,
          owner_name: null,
          owner_email: null,
          owner_role: null,
          is_shared: false,
        };
      }),
    );

    return results;
  }

  private async getAccessibleFolderIds(userId: string, activeRoleId: string | null): Promise<string[]> {
    if (!activeRoleId) return [];

    const now = new Date();
    const activeRole = await this.prisma.roles.findUnique({ where: { id: activeRoleId } });

    let workspaceFolders: Array<{ id: string }>;
    if (activeRole?.is_private) {
      workspaceFolders = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM folders
        WHERE role_id = ${activeRoleId}::uuid AND deleted_at IS NULL AND owner_id = ${userId}::uuid
      `;
    } else {
      workspaceFolders = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM folders
        WHERE role_id = ${activeRoleId}::uuid AND deleted_at IS NULL
      `;
    }

    const roleSharedPerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders folder ON folder.id = fp.folder_id AND folder.deleted_at IS NULL
      LEFT JOIN roles folderRole ON folderRole.id = folder.role_id
      WHERE fp.role_id = ${activeRoleId}::uuid
        AND fp.user_id IS NULL
        AND fp.can_read = true
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND folder.role_id != ${activeRoleId}::uuid
        AND NOT (folderRole.is_private = true AND folder.role_id != ${activeRoleId}::uuid)
    `;

    const userSharedPerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders f2 ON f2.id = fp.folder_id AND f2.deleted_at IS NULL
      LEFT JOIN roles r2 ON r2.id = f2.role_id
      WHERE fp.user_id = ${userId}::uuid
        AND (fp.role_id = ${activeRoleId}::uuid OR fp.role_id IS NULL)
        AND fp.can_read = true
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND NOT (r2.is_private = true AND f2.role_id != ${activeRoleId}::uuid)
    `;

    return Array.from(new Set([
      ...workspaceFolders.map((f) => f.id),
      ...roleSharedPerms.map((p) => p.folder_id),
      ...userSharedPerms.map((p) => p.folder_id),
    ]));
  }
}
