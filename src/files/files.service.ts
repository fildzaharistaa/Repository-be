import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { File, Folder, User, SystemSetting, AccessRequest, FileAccessLog } from '../entities';
import { FoldersService } from '../folders/folders.service';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(FileAccessLog)
    private accessLogRepo: Repository<FileAccessLog>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
    private foldersService: FoldersService,
  ) { }

  private async verifyOwnershipIfRestricted(file: File, user: User): Promise<void> {
    // Use the active role name from JWT (set at login/switch-role) rather than the
    // primary role from the DB. For multi-role users, user.role reflects the account's
    // original role, not the role they are currently operating under.
    const activeRoleName = ((user as any).active_role_name ?? '').toLowerCase();
    let roleName = activeRoleName;
    if (!roleName) {
      const fullUser = await this.fileRepository.manager.getRepository(User).findOne({ where: { id: user.id }, relations: ['role'] });
      roleName = fullUser?.role?.name?.toLowerCase() || '';
    }
    const isDosenOrTendik = roleName.includes('dosen') || roleName.includes('tendik');

    if (isDosenOrTendik && file.owner_id !== user.id) {
      // Bypass isolation when accessing a shared folder (folder not owned by this user)
      const folder = await this.folderRepository.findOne({ where: { id: file.folder_id } });
      if (folder && folder.owner_id !== user.id) {
        return; // Shared folder context — all files are visible to users with folder access
      }

      // Check if there is an approved share for this specific file
      const fileShare = await this.fileRepository.manager.findOne(AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_read: true
        }
      });

      if (!fileShare) {
        throw new ForbiddenException('Strict Isolation: Anda tidak dapat mengakses file milik pengguna lain di folder ini');
      }
    }
  }

  private async getMaxStoragePerUser(): Promise<number> {
    const setting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    return setting ? parseInt(setting.value, 10) : 104857600; // default 100MB
  }

  private async getUserStorageUsed(userId: string): Promise<number> {
    const result = await this.fileRepository
      .createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .select('SUM(file.size)', 'totalSize')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .getRawOne();
    return parseInt(result?.totalSize || '0');
  }

  async create(
    file: Express.Multer.File,
    folderId: string,
    user: User,
  ): Promise<File> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    // Use the role the user is currently operating under (active_role_id from JWT),
    // not their primary role_id which never changes during a session switch.
    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check permission
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      folderId,
      'create',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have create permission for this folder',
      );
    }

    // Validate per-user storage limit
    const maxStorage = await this.getMaxStoragePerUser();
    const currentUsage = await this.getUserStorageUsed(user.id);
    if (currentUsage + file.size > maxStorage) {
      const maxMB = (maxStorage / (1024 * 1024)).toFixed(0);
      const usedMB = (currentUsage / (1024 * 1024)).toFixed(2);
      throw new ForbiddenException(
        `Storage penuh! Anda sudah menggunakan ${usedMB} MB dari ${maxMB} MB. File ini (${(file.size / (1024 * 1024)).toFixed(2)} MB) melebihi batas storage.`,
      );
    }

    const fileEntity = this.fileRepository.create({
      name: file.originalname,
      path: file.path,
      mime_type: file.mimetype,
      size: file.size,
      folder_id: folderId,
      owner_id: user.id,
      owner: user,
      // Snapshot the active role at upload time, not the user's primary DB role.
      // user.role_id is set at account creation and never updated by switch-role.
      // active_role_id (from JWT) reflects what role the user is currently using.
      uploaded_by_role_id: activeRoleId,
    });

    return this.fileRepository.save(fileEntity);
  }

  async findAll(folderId: string, user: User): Promise<File[]> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check permission using the role the user is currently operating under.
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      folderId,
      'read',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have read permission for this folder',
      );
    }

    // Determine isolation based on the ACTIVE role name from the JWT (payload.role),
    // not the primary role stored in users.role_id which never changes on switch-role.
    const activeRoleName = ((user as any).active_role_name ?? '').toLowerCase();
    const isDosenOrTendik = activeRoleName.includes('dosen') || activeRoleName.includes('tendik');

    const whereCondition: any = { folder_id: folderId };
    // Apply ownership isolation only in the user's own folder.
    // Shared folders (owned by someone else) show all files to anyone with folder access.
    const isOwnFolder = folder.owner_id === user.id;
    if (isDosenOrTendik && isOwnFolder) {
      whereCondition.owner_id = user.id;
    }

    const files = await this.fileRepository.find({
      where: whereCondition,
      relations: ['owner', 'owner.role', 'uploaded_by_role'],
      order: { created_at: 'DESC' },
    });

    // Compute per-file can_download: owned files always downloadable,
    // shared files only if there's an approved AccessRequest with can_download.
    const nonOwnedFileIds = files.filter(f => f.owner_id !== user.id).map(f => f.id);
    let downloadableIds = new Set<string>();
    if (nonOwnedFileIds.length > 0) {
      const ars = await this.fileRepository.manager.getRepository(AccessRequest).find({
        where: {
          requester: { id: user.id },
          file: { id: In(nonOwnedFileIds) },
          status: 'approved',
          can_download: true,
        },
        relations: ['file'],
      });
      downloadableIds = new Set(ars.map(ar => ar.file.id));
    }

    // Batch-fetch last_accessed_at per (file, user, role) — single query, no N+1
    const accessMap = new Map<string, Date>();
    if (files.length > 0) {
      const logs = await this.accessLogRepo.find({
        where: {
          file_id: In(files.map(f => f.id)),
          user_id: user.id,
          role_id: activeRoleId,
        },
      });
      for (const log of logs) {
        accessMap.set(log.file_id, log.last_accessed_at);
      }
    }

    return files.map(f => ({
      ...f,
      uploaded_by: f.owner?.name ?? null,
      // Use the stored role snapshot (uploaded_by_role_id → uploaded_by_role relation).
      // Do NOT fall back to owner.role.name — that is the uploader's CURRENT primary role
      // which is wrong for multi-role users who uploaded under a different active role.
      uploaded_by_role: (f as any).uploaded_by_role?.name ?? null,
      owner_name: f.owner?.name ?? null,
      owner_email: (f.owner as any)?.email ?? null,
      owner_role: (f as any).uploaded_by_role?.name ?? f.owner?.role?.name ?? null,
      can_download: f.owner_id === user.id ? true : downloadableIds.has(f.id),
      last_accessed_at: accessMap.get(f.id)?.toISOString() ?? null,
    }));
  }

  async findOne(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check permission on parent folder
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'read',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have read permission for this file',
      );
    }

    await this.verifyOwnershipIfRestricted(file, user);

    return file;
  }

  async checkPreviewPermission(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check read permission on parent folder (view-only is enough for preview)
    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'read',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest (can_read is enough)
      const filePerm = await this.fileRepository.manager.findOne(AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_read: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to preview this file',
      );
    }

    await this.verifyOwnershipIfRestricted(file, user);

    file.last_accessed_at = new Date();
    await this.fileRepository.save(file);

    return file;
  }

  async checkDownloadPermission(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'read',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest
      const filePerm = await this.fileRepository.manager.findOne(require('../access-requests/access-request.entity').AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_download: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have download permission for this file',
      );
    }

    await this.verifyOwnershipIfRestricted(file, user);

    file.last_accessed_at = new Date();
    await this.fileRepository.save(file);

    return file;
  }

  async rename(id: string, name: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check update permission on parent folder
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'update',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have update permission for this file',
      );
    }

    await this.verifyOwnershipIfRestricted(file, user);

    file.name = name;
    return this.fileRepository.save(file);
  }

  async remove(id: string, user: User): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    // Check permission
    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'delete',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest
      const filePerm = await this.fileRepository.manager.findOne(require('../access-requests/access-request.entity').AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_delete: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have delete permission for this file',
      );
    }

    await this.fileRepository.softRemove(file);
  }

  async recordAccess(fileId: string, user: User): Promise<{ last_accessed_at: string }> {
    const file = await this.fileRepository.findOne({ where: { id: fileId }, relations: ['folder'] });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    const activeRoleId = (user as any).active_role_id || user.role_id;

    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      activeRoleId,
      file.folder_id,
      'read',
    );
    if (!hasPermission) {
      throw new ForbiddenException('You do not have read permission for this file');
    }

    const now = new Date();
    let log = await this.accessLogRepo.findOne({
      where: { file_id: fileId, user_id: user.id, role_id: activeRoleId },
    });
    if (log) {
      log.last_accessed_at = now;
    } else {
      log = this.accessLogRepo.create({
        file_id: fileId,
        user_id: user.id,
        role_id: activeRoleId,
        last_accessed_at: now,
      });
    }
    await this.accessLogRepo.save(log);

    return { last_accessed_at: now.toISOString() };
  }
}

