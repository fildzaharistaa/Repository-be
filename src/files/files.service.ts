import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FoldersService } from '../folders/folders.service';
import { canShareOrModifyFile } from '../common/utils/file-access';

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private foldersService: FoldersService,
  ) {}

  private async verifyOwnershipIfRestricted(file: any, user: any): Promise<void> {
    const activeRoleName = ((user as any).active_role_name ?? '').toLowerCase();
    let roleName = activeRoleName;
    if (!roleName) {
      const fullUser = await this.prisma.users.findUnique({
        where: { id: user.id },
        include: { roles: true },
      });
      roleName = fullUser?.roles?.name?.toLowerCase() || '';
    }
    const isDosenOrTendik = roleName.includes('dosen') || roleName.includes('tendik');

    if (isDosenOrTendik && file.owner_id !== user.id) {
      const activeRoleId = (user as any).active_role_id || user.role_id;
      const folder = await this.prisma.folders.findUnique({ where: { id: file.folder_id } });
      if (folder && (folder.owner_id !== user.id || folder.role_id !== activeRoleId)) {
        return;
      }
      const fileShare = await this.prisma.access_requests.findFirst({
        where: { requesterId: user.id, fileId: file.id, status: 'approved', can_read: true },
      });
      if (!fileShare) {
        throw new ForbiddenException('Strict Isolation: Anda tidak dapat mengakses file milik pengguna lain di folder ini');
      }
    }
  }

  private async getMaxStoragePerUser(): Promise<number> {
    const setting = await this.prisma.system_settings.findUnique({ where: { key: 'max_storage_per_user' } });
    return setting ? parseInt(setting.value, 10) : 104857600;
  }

  private async getUserStorageUsed(userId: string): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ totalSize: string }>>`
      SELECT COALESCE(SUM(file.size), 0)::text as "totalSize"
      FROM files file
      INNER JOIN folders folder ON folder.id = file.folder_id
      WHERE folder.owner_id = ${userId}::uuid
        AND file.deleted_at IS NULL
        AND folder.deleted_at IS NULL
    `;
    return parseInt(result[0]?.totalSize ?? '0');
  }

  async create(file: Express.Multer.File, folderId: string, user: any): Promise<any> {
    const folder = await this.prisma.folders.findUnique({ where: { id: folderId } });
    if (!folder) throw new NotFoundException('Folder not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;

    const hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, folderId, 'create');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have create permission for this folder');
    }

    const maxStorage = await this.getMaxStoragePerUser();
    const currentUsage = await this.getUserStorageUsed(user.id);
    if (currentUsage + file.size > maxStorage) {
      const maxMB = (maxStorage / (1024 * 1024)).toFixed(0);
      const usedMB = (currentUsage / (1024 * 1024)).toFixed(2);
      throw new ForbiddenException(
        `Storage penuh! Anda sudah menggunakan ${usedMB} MB dari ${maxMB} MB. File ini (${(file.size / (1024 * 1024)).toFixed(2)} MB) melebihi batas storage.`,
      );
    }

    return this.prisma.files.create({
      data: {
        name: file.originalname,
        path: file.path,
        mime_type: file.mimetype,
        size: file.size,
        folder_id: folderId,
        owner_id: user.id,
        uploaded_by_role_id: activeRoleId,
      },
    });
  }

  async findAll(folderId: string, user: any): Promise<any[]> {
    const folder = await this.prisma.folders.findUnique({ where: { id: folderId } });
    if (!folder) throw new NotFoundException('Folder not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;

    const hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, folderId, 'read');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have read permission for this folder');
    }

    const activeRoleName = ((user as any).active_role_name ?? '').toLowerCase();
    const isDosenOrTendik = activeRoleName.includes('dosen') || activeRoleName.includes('tendik');

    const whereCondition: any = { folder_id: folderId, deleted_at: null };
    const isOwnFolder = folder.owner_id === user.id && folder.role_id === activeRoleId;
    if (isDosenOrTendik && isOwnFolder) {
      whereCondition.owner_id = user.id;
    }

    const files = await this.prisma.files.findMany({
      where: whereCondition,
      include: { users: { include: { roles: true } }, roles: true },
      orderBy: { created_at: 'desc' },
    });

    const folderDownloadAllowed = await this.foldersService.checkPermission(
      user.id, activeRoleId, folderId, 'download',
    );

    const nonOwnedFileIds = files.filter((f) => f.owner_id !== user.id).map((f) => f.id);
    let legacyDownloadableIds = new Set<string>();
    if (!folderDownloadAllowed && nonOwnedFileIds.length > 0) {
      const ars = await this.prisma.access_requests.findMany({
        where: {
          requesterId: user.id,
          fileId: { in: nonOwnedFileIds },
          status: 'approved',
          can_download: true,
        },
      });
      legacyDownloadableIds = new Set(ars.map((ar) => ar.fileId).filter(Boolean) as string[]);
    }

    const accessMap = new Map<string, Date>();
    if (files.length > 0) {
      const logs = await this.prisma.file_access_logs.findMany({
        where: {
          file_id: { in: files.map((f) => f.id) },
          user_id: user.id,
          role_id: activeRoleId,
        },
      });
      for (const log of logs) {
        accessMap.set(log.file_id, log.last_accessed_at);
      }
    }

    return files.map((f) => ({
      ...f,
      size: Number(f.size),
      uploaded_by: f.users?.name ?? null,
      uploaded_by_role: f.roles?.name ?? null,
      uploaded_by_role_id: f.uploaded_by_role_id ?? null,
      folder_owner_id: folder.owner_id ?? null,
      owner_name: f.users?.name ?? null,
      owner_email: f.users?.email ?? null,
      owner_role: f.roles?.name ?? null,
      can_download: f.owner_id === user.id
        ? true
        : folderDownloadAllowed || legacyDownloadableIds.has(f.id),
      last_accessed_at: accessMap.get(f.id)?.toISOString() ?? null,
    }));
  }

  async findOne(id: string, user: any): Promise<any> {
    const file = await this.prisma.files.findUnique({
      where: { id },
      include: { folders: true },
    });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'read');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have read permission for this file');
    }

    await this.verifyOwnershipIfRestricted(file, user);
    return file;
  }

  async checkPreviewPermission(id: string, user: any): Promise<any> {
    const file = await this.prisma.files.findUnique({
      where: { id },
      include: { folders: true },
    });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;

    let hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'read');

    if (!hasPermission) {
      const filePerm = await this.prisma.file_permissions.findFirst({
        where: {
          file_id: file.id,
          user_id: user.id,
          can_read: true,
          OR: [{ role_id: activeRoleId }, { role_id: null }],
        },
      });
      if (filePerm) hasPermission = true;
    }

    if (!hasPermission) {
      const legacyPerm = await this.prisma.access_requests.findFirst({
        where: { requesterId: user.id, fileId: file.id, status: 'approved', can_read: true },
      });
      if (legacyPerm) hasPermission = true;
    }

    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to preview this file');
    }

    await this.verifyOwnershipIfRestricted(file, user);

    await this.prisma.files.update({
      where: { id },
      data: { last_accessed_at: new Date() },
    });

    return { ...file, size: Number(file.size) };
  }

  async checkDownloadPermission(id: string, user: any): Promise<any> {
    const file = await this.prisma.files.findUnique({
      where: { id },
      include: { folders: true },
    });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const activeRoleName = (user as any).active_role_name ?? 'unknown';

    console.log(`[Download] user=${user.id} role=${activeRoleId}(${activeRoleName}) file=${id} folder=${file.folder_id}`);

    let hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'download');
    console.log(`[Download] folder-level can_download=${hasPermission}`);

    if (!hasPermission) {
      const filePerm = await this.prisma.file_permissions.findFirst({
        where: {
          file_id: file.id,
          user_id: user.id,
          can_download: true,
          OR: [{ role_id: activeRoleId }, { role_id: null }],
        },
      });
      if (filePerm) {
        console.log(`[Download] granted via file_permissions record`);
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      const legacyPerm = await this.prisma.access_requests.findFirst({
        where: { requesterId: user.id, fileId: file.id, status: 'approved', can_download: true },
      });
      if (legacyPerm) {
        console.log(`[Download] granted via legacy AccessRequest`);
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      console.warn(`[Download] DENIED user=${user.id} role=${activeRoleId} file=${id} folder=${file.folder_id}`);
      throw new ForbiddenException('You do not have download permission for this file');
    }

    await this.verifyOwnershipIfRestricted(file, user);

    await this.prisma.files.update({ where: { id }, data: { last_accessed_at: new Date() } });

    return { ...file, size: Number(file.size) };
  }

  async rename(id: string, name: string, user: any): Promise<any> {
    const file = await this.prisma.files.findUnique({
      where: { id },
      include: { folders: { include: { users: true } }, roles: true },
    });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'update');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have update permission for this file');
    }

    const fileLike = {
      id: file.id,
      owner_id: file.owner_id,
      folder_id: file.folder_id,
      uploaded_by_role_id: file.uploaded_by_role_id,
      folder: file.folders ? { owner_id: file.folders.owner_id, role_id: file.folders.role_id } : null,
      uploaded_by_role: file.roles ? { name: file.roles.name } : null,
    };
    const allowed = await canShareOrModifyFile(fileLike, user as any, {
      findRole: (roleId) => this.prisma.roles.findUnique({ where: { id: roleId } }),
    });
    if (!allowed) {
      throw new ForbiddenException('Anda tidak berhak mengubah nama file ini');
    }

    return this.prisma.files.update({ where: { id }, data: { name } });
  }

  async remove(id: string, user: any): Promise<void> {
    const file = await this.prisma.files.findUnique({
      where: { id },
      include: { folders: true },
    });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    let hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'delete');

    if (!hasPermission) {
      const filePerm = await this.prisma.access_requests.findFirst({
        where: { requesterId: user.id, fileId: file.id, status: 'approved', can_delete: true },
      });
      if (filePerm) hasPermission = true;
    }

    if (!hasPermission) {
      throw new ForbiddenException('You do not have delete permission for this file');
    }

    await this.prisma.files.update({ where: { id }, data: { deleted_at: new Date() } });
  }

  async recordAccess(fileId: string, user: any): Promise<{ last_accessed_at: string }> {
    const file = await this.prisma.files.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    const activeRoleId = (user as any).active_role_id || user.role_id;
    const hasPermission = await this.foldersService.checkPermission(user.id, activeRoleId, file.folder_id, 'read');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have read permission for this file');
    }

    const now = new Date();
    await this.prisma.file_access_logs.upsert({
      where: { file_id_user_id_role_id: { file_id: fileId, user_id: user.id, role_id: activeRoleId } },
      create: { file_id: fileId, user_id: user.id, role_id: activeRoleId, last_accessed_at: now },
      update: { last_accessed_at: now },
    });

    return { last_accessed_at: now.toISOString() };
  }
}
