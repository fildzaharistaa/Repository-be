import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

  private async calculateDepth(parentId: string | null | undefined): Promise<number> {
    if (!parentId) return 0;
    let depth = 0;
    let currentId: string | null = parentId;
    while (currentId) {
      depth++;
      const folder = await this.prisma.folders.findUnique({ where: { id: currentId } });
      currentId = folder?.parent_id ?? null;
    }
    return depth;
  }

  async getMaxFolderDepth(userId: string): Promise<number> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (user?.max_folder_depth != null) return user.max_folder_depth;
    if (user?.roles?.max_folder_depth != null) return user.roles.max_folder_depth;
    const setting = await this.prisma.system_settings.findUnique({ where: { key: 'max_folder_depth' } });
    return setting ? parseInt(setting.value, 10) : 5;
  }

  private async findRoleByLabel(label: string): Promise<any | null> {
    const norm = label.toLowerCase().trim();
    const variants: string[] = [label];
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
    const uniqueNames = [...new Set(variants.map((v) => v.toLowerCase()))];
    const results = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM roles WHERE LOWER(name) = ANY(${uniqueNames}::text[]) AND deleted_at IS NULL LIMIT 1
    `;
    return results[0] ?? null;
  }

  private isDosenOrTendikRole(roleName: string): boolean {
    const norm = roleName.toLowerCase().trim();
    return norm.includes('dosen') || norm.includes('tendik');
  }

  async create(createFolderDto: CreateFolderDto, userId: string, activeRoleId?: string): Promise<any> {
    if (createFolderDto.parent_id) {
      const parent = await this.prisma.folders.findUnique({ where: { id: createFolderDto.parent_id } });
      if (!parent) throw new NotFoundException('Parent folder not found');
    }

    const maxDepth = await this.getMaxFolderDepth(userId);
    const parentDepth = await this.calculateDepth(createFolderDto.parent_id);
    const newDepth = parentDepth + 1;
    if (newDepth > maxDepth) {
      throw new ForbiddenException(
        `Melebihi batas kedalaman folder maksimal (${maxDepth} level). Silakan request ke Super Admin untuk menambah kedalaman.`,
      );
    }

    if (createFolderDto.parent_id) {
      const childCount = await this.prisma.folders.count({
        where: { parent_id: createFolderDto.parent_id, deleted_at: null },
      });
      if (childCount >= maxDepth) {
        throw new BadRequestException(`Maksimal hanya ${maxDepth} subfolder dalam folder ini`);
      }
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    const activeRole = activeRoleId
      ? await this.prisma.roles.findUnique({ where: { id: activeRoleId } })
      : null;

    let folderRoleId = activeRoleId || null;
    if (createFolderDto.parent_id) {
      const shouldInherit = !activeRole?.is_private || createFolderDto.is_shared_subfolder;
      if (shouldInherit) {
        const parent = await this.prisma.folders.findUnique({ where: { id: createFolderDto.parent_id } });
        if (parent?.role_id) folderRoleId = parent.role_id;
      }
    }

    let folderUnit = 'general';
    if (folderRoleId) {
      const folderRole = await this.prisma.roles.findUnique({ where: { id: folderRoleId } });
      folderUnit = folderRole?.name?.toLowerCase().substring(0, 50) || 'general';
    } else if (user?.roles?.name) {
      folderUnit = user.roles.name.toLowerCase().substring(0, 50);
    }

    const savedFolder = await this.prisma.folders.create({
      data: {
        name: createFolderDto.name,
        parent_id: createFolderDto.parent_id ?? null,
        role_id: folderRoleId,
        owner_id: userId,
        unit: folderUnit,
      },
    });

    const creatorRoleId = activeRoleId || user?.roles?.id || null;
    if (creatorRoleId) {
      const existingRolePerm = await this.prisma.folder_permissions.findFirst({
        where: { folder_id: savedFolder.id, role_id: creatorRoleId },
      });
      if (!existingRolePerm) {
        await this.prisma.folder_permissions.create({
          data: {
            folder_id: savedFolder.id,
            role_id: creatorRoleId,
            can_read: true,
            can_create: true,
            can_update: true,
            can_delete: true,
            can_download: true,
          },
        });
      } else {
        await this.prisma.folder_permissions.update({
          where: { id: existingRolePerm.id },
          data: { can_read: true, can_create: true, can_update: true, can_delete: true, can_download: true },
        });
      }
    }

    if (createFolderDto.parent_id && !createFolderDto.share_with_roles?.length && !activeRole?.is_private) {
      const parentRolePerms = await this.prisma.folder_permissions.findMany({
        where: { folder_id: createFolderDto.parent_id, user_id: null },
      });
      for (const parentPerm of parentRolePerms) {
        if (!parentPerm.role_id) continue;
        if (parentPerm.role_id === creatorRoleId) continue;
        const existing = await this.prisma.folder_permissions.findFirst({
          where: { folder_id: savedFolder.id, role_id: parentPerm.role_id, user_id: null },
        });
        if (!existing) {
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: savedFolder.id,
              role_id: parentPerm.role_id,
              can_read: parentPerm.can_read,
              can_create: parentPerm.can_create,
              can_update: parentPerm.can_update,
              can_delete: parentPerm.can_delete,
              can_download: parentPerm.can_download,
              expires_at: parentPerm.expires_at ?? null,
            },
          });
        }
      }
    }

    if (createFolderDto.share_with_roles && createFolderDto.share_with_roles.length > 0) {
      for (const roleLabel of createFolderDto.share_with_roles) {
        const role = await this.findRoleByLabel(roleLabel);
        if (role) {
          const isDosenOrTendik = this.isDosenOrTendikRole(role.name);
          const existing = await this.prisma.folder_permissions.findFirst({
            where: { folder_id: savedFolder.id, role_id: role.id },
          });
          const canDownload = createFolderDto.role_download_map?.[role.id] ?? false;
          if (!existing) {
            await this.prisma.folder_permissions.create({
              data: {
                folder_id: savedFolder.id,
                role_id: role.id,
                can_read: true,
                can_download: canDownload,
                can_create: isDosenOrTendik,
                can_update: isDosenOrTendik,
                can_delete: isDosenOrTendik,
              },
            });
          } else if (createFolderDto.role_download_map !== undefined) {
            await this.prisma.folder_permissions.update({
              where: { id: existing.id },
              data: { can_download: canDownload },
            });
          }
        }
      }
    }

    if (createFolderDto.user_permissions && createFolderDto.user_permissions.length > 0) {
      for (const perm of createFolderDto.user_permissions) {
        const permRoleId: string | null = perm.role_id ?? null;
        const existing = await this.prisma.folder_permissions.findFirst({
          where: { folder_id: savedFolder.id, user_id: perm.user_id, role_id: permRoleId },
        });
        if (existing) {
          await this.prisma.folder_permissions.update({
            where: { id: existing.id },
            data: {
              can_read: !!perm.can_read,
              can_create: !!perm.can_create,
              can_update: !!perm.can_update,
              can_delete: !!perm.can_delete,
              can_download: !!perm.can_download,
            },
          });
        } else {
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: savedFolder.id,
              user_id: perm.user_id,
              role_id: permRoleId,
              can_read: !!perm.can_read,
              can_create: !!perm.can_create,
              can_update: !!perm.can_update,
              can_delete: !!perm.can_delete,
              can_download: !!perm.can_download,
            },
          });
        }
      }
    }

    if (createFolderDto.initial_subfolders?.length) {
      const parentPerms = await this.prisma.folder_permissions.findMany({
        where: { folder_id: savedFolder.id },
      });
      for (const subName of createFolderDto.initial_subfolders) {
        const trimmed = subName.trim();
        if (!trimmed) continue;
        const savedSub = await this.prisma.folders.create({
          data: {
            name: trimmed,
            parent_id: savedFolder.id,
            role_id: savedFolder.role_id,
            owner_id: userId,
            unit: savedFolder.unit,
          },
        });
        for (const perm of parentPerms) {
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: savedSub.id,
              user_id: perm.user_id ?? null,
              role_id: perm.role_id ?? null,
              can_read: perm.can_read,
              can_create: perm.can_create,
              can_update: perm.can_update,
              can_delete: perm.can_delete,
              can_download: perm.can_download,
              expires_at: perm.expires_at ?? null,
            },
          });
        }
      }
    }

    return savedFolder;
  }

  async findOne(id: string) {
    const folder = await this.prisma.folders.findUnique({
      where: { id },
      include: {
        folders: true,
        other_folders: { where: { deleted_at: null }, orderBy: { name: 'asc' } },
        folder_permissions: { include: { roles: true, users: true } },
        users: true,
        roles: true,
      },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  async findOneForUser(id: string, user: any): Promise<any> {
    const folder = await this.prisma.folders.findUnique({
      where: { id },
      include: {
        folders: true,
        folder_permissions: { include: { roles: true, users: true } },
        users: true,
        roles: true,
      },
    });
    if (!folder) throw new NotFoundException('Folder not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const isOwner = folder.owner_id === user.id;

    if (folder.roles?.is_private) {
      if (!isOwner || activeRoleId !== folder.role_id) {
        throw new ForbiddenException('Access denied');
      }
    }

    if (!isOwner) {
      const hasSharedAccess = await this.checkPermission(user.id, activeRoleId, id, 'read');
      if (!hasSharedAccess) throw new ForbiddenException('Access denied');
    }

    const allChildren = await this.prisma.folders.findMany({
      where: { parent_id: id, deleted_at: null },
      include: { users: { include: { roles: true } }, roles: true },
      orderBy: { name: 'asc' },
    });

    const filteredChildren = allChildren.filter((child) => {
      if (child.roles?.is_private) {
        return child.owner_id === user.id && child.role_id === activeRoleId;
      }
      if (child.users?.roles?.is_private && child.owner_id !== user.id) return false;
      return true;
    });

    return { ...folder, other_folders: filteredChildren };
  }

  async findAllAccessible(user: any): Promise<any[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];

    const role = await this.prisma.roles.findUnique({ where: { id: activeRoleId } });
    const isPrivate = role?.is_private === true;

    const where = isPrivate
      ? { role_id: activeRoleId, owner_id: user.id, deleted_at: null as any }
      : { role_id: activeRoleId, deleted_at: null as any };

    return this.prisma.folders.findMany({
      where,
      include: { folders: true, users: { include: { roles: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findAllForAdmin(): Promise<any[]> {
    return this.prisma.folders.findMany({
      where: { deleted_at: null },
      include: { folders: true },
      orderBy: { name: 'asc' },
    });
  }

  async getTreeForAdmin(): Promise<FolderTreeNode[]> {
    const folders = await this.prisma.folders.findMany({
      where: { deleted_at: null },
      orderBy: { name: 'asc' },
    });
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
        folderMap.get(folder.parent_id)!.children!.push(node);
      } else {
        rootFolders.push(node);
      }
    });
    return rootFolders;
  }

  async getTree(user: any): Promise<FolderTreeNode[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];

    const role = await this.prisma.roles.findUnique({ where: { id: activeRoleId } });
    const isPrivate = role?.is_private === true;

    const where = isPrivate
      ? { role_id: activeRoleId, owner_id: user.id, deleted_at: null as any }
      : { role_id: activeRoleId, deleted_at: null as any };

    const folders = await this.prisma.folders.findMany({ where, orderBy: { name: 'asc' } });

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
        const parents = await this.prisma.folders.findMany({
          where: { id: { in: orphanParentIds } },
          select: { id: true, name: true },
        });
        const parentMap = new Map(parents.map((p) => [p.id, p.name]));
        for (const folder of folders) {
          if (folder.parent_id && !folderIds.has(folder.parent_id)) {
            (folder as any).shared_parent_name = parentMap.get(folder.parent_id) ?? null;
          }
        }
      }
    }

    return this.buildTree(folders as any[]);
  }

  private async expandDescendants(folderIds: string[]): Promise<string[]> {
    const allIds = new Set(folderIds);
    const queue = [...folderIds];
    while (queue.length > 0) {
      const batch = queue.splice(0, 100);
      const children = await this.prisma.folders.findMany({
        where: { parent_id: { in: batch }, deleted_at: null },
        select: { id: true },
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

  async getSharedTree(user: any): Promise<any[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    const now = new Date();

    const rolePerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders f3 ON f3.id = fp.folder_id AND f3.deleted_at IS NULL
      LEFT JOIN roles r3 ON r3.id = f3.role_id
      WHERE fp.role_id = ${activeRoleId}::uuid
        AND fp.user_id IS NULL
        AND fp.can_read = true
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND NOT (r3.is_private = true AND f3.role_id != ${activeRoleId}::uuid)
    `;

    const userPerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders f2 ON f2.id = fp.folder_id AND f2.deleted_at IS NULL
      LEFT JOIN roles r2 ON r2.id = f2.role_id
      WHERE fp.user_id = ${user.id}::uuid
        AND (fp.role_id = ${activeRoleId}::uuid OR fp.role_id IS NULL)
        AND fp.can_read = true
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND NOT (r2.is_private = true AND f2.role_id != ${activeRoleId}::uuid)
    `;

    const roleSharedIds = new Set(rolePerms.map((p) => p.folder_id));
    const userSharedIds = new Set(userPerms.map((p) => p.folder_id));
    const directSharedIds = [...new Set([...roleSharedIds, ...userSharedIds])];
    if (!directSharedIds.length) return [];

    const allSharedIds = await this.expandDescendants(directSharedIds);

    const folders = await this.prisma.folders.findMany({
      where: { id: { in: allSharedIds }, deleted_at: null },
      include: { users: { include: { roles: true } }, roles: true },
      orderBy: { name: 'asc' },
    });

    const sharedFolders = folders.filter((f) => {
      if (f.roles?.is_private && f.role_id !== activeRoleId) return false;
      if (userSharedIds.has(f.id)) return true;
      if (f.owner_id === user.id && f.role_id === activeRoleId) return false;
      return f.role_id !== activeRoleId;
    });

    return this.buildTreeWithOwner(sharedFolders as any[]);
  }

  private buildTree(folders: any[]): FolderTreeNode[] {
    const folderMap = new Map<string, any>();
    const rootFolders: any[] = [];
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        shared_parent_name: (folder as any).shared_parent_name ?? null,
        children: [],
      });
    });
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        folderMap.get(folder.parent_id)!.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });
    return rootFolders;
  }

  private buildTreeWithOwner(folders: any[]): any[] {
    const folderMap = new Map<string, any>();
    const rootFolders: any[] = [];
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        owner_name: folder.users?.name || 'Unknown',
        owner_email: folder.users?.email || '',
        owner_role: folder.roles?.name ?? null,
        children: [],
      });
    });
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        folderMap.get(folder.parent_id)!.children.push(node);
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
    roleDownloadMap: Record<string, boolean> = {},
  ): Promise<void> {
    if (!addedRoleIds.length && !removedRoleIds.length) return;
    const children = await this.prisma.folders.findMany({
      where: { parent_id: parentId, deleted_at: null },
      select: { id: true },
    });
    for (const child of children) {
      if (removedRoleIds.length) {
        await this.prisma.folder_permissions.deleteMany({
          where: { folder_id: child.id, role_id: { in: removedRoleIds }, user_id: null },
        });
      }
      for (const roleId of addedRoleIds) {
        if (roleId === ownerRoleId) continue;
        const existing = await this.prisma.folder_permissions.findFirst({
          where: { folder_id: child.id, role_id: roleId, user_id: null },
        });
        const canDownload = roleDownloadMap[roleId] ?? false;
        if (!existing) {
          const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
          const isDosenOrTendik = role ? this.isDosenOrTendikRole(role.name) : false;
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: child.id,
              role_id: roleId,
              can_read: true,
              can_download: canDownload,
              can_create: isDosenOrTendik,
              can_update: isDosenOrTendik,
              can_delete: isDosenOrTendik,
            },
          });
        } else if (existing.can_download !== canDownload) {
          await this.prisma.folder_permissions.update({
            where: { id: existing.id },
            data: { can_download: canDownload },
          });
        }
      }
      await this.propagatePermissionsToDescendants(child.id, addedRoleIds, removedRoleIds, ownerRoleId, roleDownloadMap);
    }
  }

  async update(id: string, updateFolderDto: UpdateFolderDto): Promise<any> {
    const folder = await this.findOne(id);

    const ownerUser = folder.owner_id
      ? await this.prisma.users.findUnique({ where: { id: folder.owner_id }, include: { roles: true } })
      : null;
    const ownerRoleId = folder.role_id || ownerUser?.roles?.id || null;

    if (updateFolderDto.share_with_roles) {
      const targetRoleIds: string[] = [];
      for (const roleLabel of updateFolderDto.share_with_roles) {
        const role = await this.findRoleByLabel(roleLabel);
        if (role) targetRoleIds.push(role.id);
      }

      const addedRoleIds: string[] = [];
      const removedRoleIds: string[] = [];

      const currentRolePerms = folder.folder_permissions.filter((p: any) => !!p.role_id && !p.user_id);
      for (const p of currentRolePerms) {
        if (p.role_id === ownerRoleId) continue;
        if (!targetRoleIds.includes(p.role_id!)) {
          await this.prisma.folder_permissions.delete({ where: { id: p.id } });
          removedRoleIds.push(p.role_id!);
        }
      }

      for (const roleId of targetRoleIds) {
        if (roleId === ownerRoleId) continue;
        const existingPerm = currentRolePerms.find((p: any) => p.role_id === roleId);
        const canDownload = updateFolderDto.role_download_map?.[roleId] ?? existingPerm?.can_download ?? false;
        if (!existingPerm) {
          const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
          const isDosenOrTendik = role ? this.isDosenOrTendikRole(role.name) : false;
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: folder.id,
              role_id: roleId,
              can_read: true,
              can_download: canDownload,
              can_create: isDosenOrTendik,
              can_update: isDosenOrTendik,
              can_delete: isDosenOrTendik,
            },
          });
          addedRoleIds.push(roleId);
        } else if (updateFolderDto.role_download_map !== undefined && existingPerm.can_download !== canDownload) {
          await this.prisma.folder_permissions.update({
            where: { id: existingPerm.id },
            data: { can_download: canDownload },
          });
          console.log(`[FolderPerm] Updated can_download=${canDownload} for role=${roleId} folder=${folder.id}`);
        }
      }

      await this.propagatePermissionsToDescendants(
        folder.id,
        addedRoleIds,
        removedRoleIds,
        ownerRoleId,
        updateFolderDto.role_download_map ?? {},
      );
    }

    if (updateFolderDto.user_permissions) {
      const currentUserPerms = folder.folder_permissions.filter((p: any) => !!p.user_id);

      for (const p of currentUserPerms) {
        const inTarget = updateFolderDto.user_permissions.some(
          (up) => up.user_id === p.user_id && (up.role_id ?? null) === p.role_id,
        );
        if (!inTarget) await this.prisma.folder_permissions.delete({ where: { id: p.id } });
      }

      for (const up of updateFolderDto.user_permissions) {
        const upRoleId: string | null = up.role_id ?? null;
        if (up.user_id === folder.owner_id && (upRoleId === null || upRoleId === folder.role_id)) continue;
        const existing = currentUserPerms.find(
          (p: any) => p.user_id === up.user_id && p.role_id === upRoleId,
        );
        if (existing) {
          await this.prisma.folder_permissions.update({
            where: { id: existing.id },
            data: {
              can_read: !!up.can_read,
              can_download: !!up.can_download,
              can_create: !!up.can_create,
              can_update: !!up.can_update,
              can_delete: !!up.can_delete,
            },
          });
        } else {
          await this.prisma.folder_permissions.create({
            data: {
              folder_id: folder.id,
              user_id: up.user_id,
              role_id: upRoleId,
              can_read: !!up.can_read,
              can_download: !!up.can_download,
              can_create: !!up.can_create,
              can_update: !!up.can_update,
              can_delete: !!up.can_delete,
            },
          });
        }
      }
    }

    if (updateFolderDto.name) {
      await this.prisma.folders.update({ where: { id }, data: { name: updateFolderDto.name } });
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const folder = await this.findOne(id);
    await this.cascadeSoftDelete(folder.id);
    await this.prisma.folders.update({ where: { id }, data: { deleted_at: new Date() } });
  }

  private async cascadeSoftDelete(folderId: string): Promise<void> {
    await this.prisma.files.updateMany({
      where: { folder_id: folderId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    const children = await this.prisma.folders.findMany({
      where: { parent_id: folderId, deleted_at: null },
      select: { id: true },
    });
    for (const child of children) {
      await this.cascadeSoftDelete(child.id);
      await this.prisma.folders.update({ where: { id: child.id }, data: { deleted_at: new Date() } });
    }
  }

  public async getAccessibleFolderIds(user: any): Promise<string[]> {
    const activeRoleId = (user as any).active_role_id || user.role_id;
    if (!activeRoleId) return [];
    const now = new Date();

    const activeRole = await this.prisma.roles.findUnique({ where: { id: activeRoleId } });

    let workspaceFolders: Array<{ id: string }>;
    if (activeRole?.is_private) {
      workspaceFolders = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM folders
        WHERE role_id = ${activeRoleId}::uuid AND deleted_at IS NULL AND owner_id = ${user.id}::uuid
      `;
    } else {
      workspaceFolders = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM folders
        WHERE role_id = ${activeRoleId}::uuid AND deleted_at IS NULL
      `;
    }

    const roleSharedPerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders f2 ON f2.id = fp.folder_id AND f2.deleted_at IS NULL
      LEFT JOIN roles r2 ON r2.id = f2.role_id
      WHERE fp.role_id = ${activeRoleId}::uuid
        AND fp.user_id IS NULL
        AND (fp.can_read = true OR fp.can_create = true OR fp.can_update = true OR fp.can_delete = true)
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND f2.role_id != ${activeRoleId}::uuid
        AND NOT (r2.is_private = true AND f2.role_id != ${activeRoleId}::uuid)
    `;

    const userSharedPerms = await this.prisma.$queryRaw<Array<{ folder_id: string }>>`
      SELECT fp.folder_id FROM folder_permissions fp
      INNER JOIN folders f2 ON f2.id = fp.folder_id AND f2.deleted_at IS NULL
      LEFT JOIN roles r2 ON r2.id = f2.role_id
      WHERE fp.user_id = ${user.id}::uuid
        AND (fp.role_id = ${activeRoleId}::uuid OR fp.role_id IS NULL)
        AND (fp.can_read = true OR fp.can_create = true OR fp.can_update = true OR fp.can_delete = true)
        AND (fp.expires_at IS NULL OR fp.expires_at > ${now})
        AND NOT (r2.is_private = true AND f2.role_id != ${activeRoleId}::uuid)
    `;

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

    const [folder, permissions] = await Promise.all([
      this.prisma.folders.findUnique({ where: { id: folderId }, include: { roles: true } }),
      this.prisma.folder_permissions.findMany({
        where: {
          folder_id: folderId,
          AND: [
            { OR: [{ user_id: userId }, { role_id: roleId }] },
            { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
          ],
        },
      }),
    ]);

    if (!folder) return false;

    if (folder.roles?.is_private) {
      return folder.owner_id === userId && roleId === folder.role_id;
    }

    if (folder.owner_id === userId) return true;

    if (permissions.length === 0) {
      const ancestorIds: string[] = [];
      let parentId = folder.parent_id;
      while (parentId && ancestorIds.length < 10) {
        const parent = await this.prisma.folders.findUnique({
          where: { id: parentId },
          select: { id: true, owner_id: true, parent_id: true },
        });
        if (!parent) break;
        if (parent.owner_id === userId) return true;
        ancestorIds.push(parent.id);
        parentId = parent.parent_id ?? null;
      }
      if (!ancestorIds.length) return false;

      const ancestorPerms = await this.prisma.folder_permissions.findMany({
        where: {
          folder_id: { in: ancestorIds },
          AND: [
            { OR: [{ user_id: userId }, { role_id: roleId }] },
            { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
          ],
        },
      });

      return ancestorPerms.some((permission) => {
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

    const result = permissions.some((permission) => {
      switch (permissionType) {
        case 'read': return permission.can_read;
        case 'create': return permission.can_create;
        case 'update': return permission.can_update;
        case 'delete': return permission.can_delete;
        case 'download': return permission.can_download;
        default: return false;
      }
    });

    if (permissionType === 'download') {
      console.log(
        `[FolderPerm] checkPermission folder=${folderId} user=${userId} role=${roleId} type=download result=${result} ` +
          `records=${JSON.stringify(permissions.map((p) => ({ uid: p.user_id, rid: p.role_id, dl: p.can_download })))}`,
      );
    }

    return result;
  }
}
