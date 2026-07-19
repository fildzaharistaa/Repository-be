import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { FolderPermission } from '../entities/folder-permission.entity';
import { FilePermission } from '../entities/file-permission.entity';
import { SystemSetting } from '../entities/system-setting.entity';
import { canShareOrModifyFile } from '../common/utils/file-access';

@Injectable()
export class AccessRequestsService {

  constructor(
    @InjectRepository(AccessRequest)
    private accessRequestRepo: Repository<AccessRequest>,

    @InjectRepository(Folder)
    private folderRepo: Repository<Folder>,

    @InjectRepository(File)
    private fileRepo: Repository<File>,

    @InjectRepository(FolderPermission)
    private folderPermissionRepo: Repository<FolderPermission>,

    @InjectRepository(FilePermission)
    private filePermissionRepo: Repository<FilePermission>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(Role)
    private roleRepository: Repository<Role>,

    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  private mapRoleLabelToName(label: string): string {
    const norm = label.toLowerCase().trim();
    if (norm === 'wakil dekan 1' || norm === 'wd 1' || norm === 'wd1') return 'wd1';
    if (norm === 'wakil dekan 2' || norm === 'wd 2' || norm === 'wd2') return 'wd2';
    if (norm === 'wakil dekan 3' || norm === 'wd 3' || norm === 'wd3') return 'wd3';
    if (norm.includes('dosen')) return 'dosen';
    if (norm.includes('tendik')) return 'tendik';
    return norm;
  }

  // =============================
  // USER REQUEST ACCESS
  // =============================
  async requestAccess(
    userId: string,
    folderId?: string,
    fileId?: string,
    message?: string
  ) {

    if (!folderId && !fileId) {
      throw new ForbiddenException('FolderId or FileId required');
    }

    const requester = { id: userId } as User;

    // =============================
    // REQUEST FOLDER ACCESS
    // =============================
    if (folderId) {

      const folder = await this.folderRepo.findOne({
        where: { id: folderId },
        relations: ['owner']
      });

      if (!folder || !folder.owner) {
        throw new NotFoundException('Folder not found');
      }

      if (folder.owner.id === userId) {
        throw new ForbiddenException('Owner already has access');
      }

      const existingRequest = await this.accessRequestRepo.findOne({
        where: {
          requester: { id: userId },
          folder: { id: folderId },
          status: 'pending'
        }
      });

      if (existingRequest) {
        throw new ForbiddenException('Request already pending');
      }

      const request = this.accessRequestRepo.create({
        requester,
        folder,
        owner: folder.owner,
        status: 'pending',
        message: message || null
      });

      return this.accessRequestRepo.save(request);
    }

    // =============================
    // REQUEST FILE ACCESS
    // =============================
    if (fileId) {

      const file = await this.fileRepo.findOne({
        where: { id: fileId },
        relations: ['folder', 'folder.owner']
      });

      if (!file || !file.folder || !file.folder.owner) {
        throw new NotFoundException('File not found');
      }

      const existingRequest = await this.accessRequestRepo.findOne({
        where: {
          requester: { id: userId },
          file: { id: fileId },
          status: 'pending'
        }
      });

      if (existingRequest) {
        throw new ForbiddenException('Request already pending');
      }

      const request = this.accessRequestRepo.create({
        requester,
        file,
        owner: file.folder.owner,
        status: 'pending',
        message: message || null
      });

      return this.accessRequestRepo.save(request);
    }
  }

  // =============================
  // USER LIHAT REQUEST SENDIRI
  // =============================
  async getUserRequests(userId: string) {

    return this.accessRequestRepo.find({
      where: {
        requester: { id: userId }
      },
      relations: ['folder', 'file'],
      order: {
        createdAt: 'DESC'
      }
    });

  }

  // =============================
  // OWNER LIHAT PENDING REQUEST
  // =============================
  async getPendingRequests(ownerId: string) {

    return this.accessRequestRepo.find({
      where: {
        owner: { id: ownerId },
        status: 'pending'
      },
      order: {
        createdAt: 'DESC'
      }
    });

  }

  // =============================
  // OWNER APPROVE REQUEST
  // =============================
  async approveRequest(
    requestId: number,
    ownerId: string,
    permissions: any,
    responseMessage?: string
  ) {

    const request = await this.accessRequestRepo.findOne({
      where: { id: requestId },
      relations: ['owner', 'requester', 'folder', 'file', 'file.folder']
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.owner.id !== ownerId) {
      throw new ForbiddenException('Not your resource');
    }

    const targetUser = await this.userRepo.findOne({ where: { id: request.requester.id }, relations: ['role'] });
    const roleName = targetUser?.role?.name?.toLowerCase() || '';
    const isDosenOrTendik = roleName.includes('dosen') || roleName.includes('tendik');

    if (request.request_type === 'delete_confirmation') {
      request.status = 'approved';
      request.response_message = responseMessage || 'Persetujuan penghapusan file dikonfirmasi';
      await this.accessRequestRepo.save(request);

      if (request.file) {
        await this.fileRepo.softRemove(request.file);
      }

      return { message: 'File berhasil dipindahkan ke Recycle Bin' };
    }

    request.status = 'approved';
    request.response_message = responseMessage || null;
    request.can_read = permissions?.can_read ?? true;
    request.can_download = permissions?.can_download ?? false;
    request.can_create = isDosenOrTendik ? true : (permissions?.can_create ?? false);
    request.can_update = isDosenOrTendik ? true : (permissions?.can_update ?? false);
    request.can_delete = isDosenOrTendik ? true : (permissions?.can_delete ?? false);

    await this.accessRequestRepo.save(request);

    if (request.folder) {

      await this.folderPermissionRepo.save({
        user: request.requester,
        folder: request.folder,
        can_read: request.can_read,
        can_download: request.can_download,
        can_create: request.can_create,
        can_update: request.can_update,
        can_delete: request.can_delete,
      });

    } else if (request.file) {

      // For file requests, grant read permission on the parent folder
      // so the user can access the file
      if (request.file.folder) {
        await this.folderPermissionRepo.save({
          user: request.requester,
          folder: request.file.folder,
          can_read: true,
          can_download: permissions?.can_download ?? true,
          can_create: false,
          can_update: false,
          can_delete: false,
        });
      }

    }

    return {
      message: 'Request approved'
    };
  }

  // =============================
  // OWNER REJECT REQUEST
  // =============================
  async rejectRequest(
    requestId: number,
    ownerId: string,
    responseMessage?: string
  ) {

    const request = await this.accessRequestRepo.findOne({
      where: { id: requestId },
      relations: ['owner']
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.owner.id !== ownerId) {
      throw new ForbiddenException('Not your resource');
    }

    request.status = 'rejected';
    request.response_message = responseMessage || null;

    return this.accessRequestRepo.save(request);
  }

  // =============================
  // SUPER ADMIN: LIHAT SEMUA PENDING
  // =============================
  async getAllPendingRequests() {
    return this.accessRequestRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }

  // =============================
  // NOTIFICATIONS: GABUNGAN DATA
  // =============================
  async getNotifications(userId: string) {
    // Cek apakah user adalah admin
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    const userRoleName = user?.role?.name?.toLowerCase() ?? '';
    const isAdmin = userRoleName === 'admin' || userRoleName === 'super admin' || userRoleName === 'superadmin';

    // Notifikasi untuk pemilik folder: pending requests yang ditujukan ke mereka
    const incomingRequests = isAdmin
      ? await this.accessRequestRepo.find({
          where: { status: 'pending' },
          order: { createdAt: 'DESC' },
        })
      : await this.accessRequestRepo.find({
          where: { owner: { id: userId }, status: 'pending' },
          order: { createdAt: 'DESC' },
        });

    // Notifikasi untuk requester: request mereka yang sudah di-approve/reject.
    // withDeleted: true — the resource may have been moved to Recycle Bin (soft
    // deleted) after being approved; the notification should still show its
    // original name instead of falling back to "Unknown".
    const myUpdatedRequests = await this.accessRequestRepo.find({
      where: [
        { requester: { id: userId }, status: 'approved' },
        { requester: { id: userId }, status: 'rejected' },
      ],
      relations: ['folder', 'file', 'requester', 'requester.role'],
      withDeleted: true,
      order: { createdAt: 'DESC' },
    });

    // Notifikasi untuk direct share: Folder yang dibagikan langsung tanpa request
    const directShares = await this.folderPermissionRepo.find({
      where: { user_id: userId },
      relations: ['folder', 'folder.owner'],
      order: { created_at: 'DESC' },
      take: 20
    });

    const filteredDirectShares = directShares.filter(
      (p) => p.folder && p.folder.owner && p.folder.owner.id !== userId
    );

    // Notifikasi untuk direct file share via file_permissions
    const directFileShares = await this.filePermissionRepo.find({
      where: { user_id: userId },
      relations: ['file'],
      order: { created_at: 'DESC' },
      take: 20,
    });

    const normalUpdates = myUpdatedRequests.map((r) => ({
      id: r.id,
      type: 'update' as const,
      requesterName: r.requester?.name || 'Unknown',
      requesterEmail: r.requester?.email || '',
      resourceName: r.folder?.name || r.file?.name || 'Unknown',
      resourceType: r.folder ? 'folder' : 'file' as const,
      status: r.status,
      response_message: r.response_message || null,
      createdAt: r.createdAt.toISOString(),
    }));

    const directShareUpdates = filteredDirectShares.map((p) => ({
      id: p.id ? Number(p.id.replace(/\D/g, '').substring(0, 8)) + 1000000 : Math.floor(Math.random() * 1000000),
      type: 'update' as const,
      resourceName: p.folder?.name || 'Unknown',
      resourceType: 'folder' as const,
      status: 'approved',
      createdAt: p.created_at.toISOString(),
    }));

    const directFileShareUpdates = directFileShares.map((p) => ({
      id: p.id ? Number(p.id.replace(/\D/g, '').substring(0, 8)) + 2000000 : Math.floor(Math.random() * 1000000),
      type: 'update' as const,
      resourceName: p.file?.name || 'Unknown',
      resourceType: 'file' as const,
      status: 'approved',
      createdAt: p.created_at.toISOString(),
    }));

    // Gabungkan notifikasi update dan urutkan berdasarkan waktu
    const allUpdates = [...normalUpdates, ...directShareUpdates, ...directFileShareUpdates].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );


    return {
      incoming: incomingRequests.map((r) => ({
        id: r.id,
        type: 'incoming' as const,
        requesterName: r.requester?.name || r.requester?.email || 'Unknown',
        requesterEmail: r.requester?.email || '',
        resourceName: r.folder?.name || r.file?.name || 'Unknown',
        resourceType: r.folder ? 'folder' : 'file',
        status: r.status,
        message: r.message || null,
        request_type: r.request_type || 'access',
        requested_depth: r.requested_depth || null,
        createdAt: r.createdAt.toISOString(),
      })),
      updates: allUpdates,
    };
  }

  // =============================
  // GET SHARED FILES
  // Role-aware: returns files shared with the user either (a) directly via a
  // file_permissions grant, or (b) because the user was granted access to the
  // file's parent folder via folder_permissions (e.g. an approved access
  // request from Global Search). The caller passes activeRoleId from JWT.
  // =============================
  async getSharedFiles(userId: string, activeRoleId: string) {
    const now = new Date();

    const toFileEntry = (file: File, can_read: boolean, can_download: boolean, sharedForRoleId: string | null) => ({
      id: file.id,
      name: file.name,
      mime_type: file.mime_type,
      size: file.size,
      created_at: file.created_at,
      updated_at: file.updated_at,
      owner_id: file.owner_id,
      owner_name: (file.owner as any)?.name || 'Unknown',
      owner_email: (file.owner as any)?.email || '(email tidak tersedia)',
      owner_role: (file as any).uploaded_by_role?.name ?? null,
      uploaded_by: (file.owner as any)?.name || 'Unknown',
      uploaded_by_role: (file as any).uploaded_by_role?.name ?? null,
      uploaded_by_role_id: (file as any).uploaded_by_role_id ?? null,
      can_read,
      can_download,
      can_create: false,
      can_update: false,
      can_delete: false,
      folder_id: file.folder_id ?? null,
      folder: file.folder ? { id: file.folder.id, name: file.folder.name } : null,
      // Expose which role_id this share targets so the frontend can show context
      shared_for_role_id: sharedForRoleId,
    });

    // Files shared directly WITH this user for their current active role
    // (role_id = activeRoleId) OR role-agnostic grants (role_id IS NULL).
    const sharedWithMePerms = await this.filePermissionRepo
      .createQueryBuilder('fp')
      .innerJoinAndSelect('fp.file', 'file')
      .leftJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('file.uploaded_by_role', 'uploadedByRole')
      .leftJoinAndSelect('file.owner', 'owner')
      .leftJoinAndSelect('owner.role', 'ownerRole')
      .where('fp.user_id = :userId', { userId })
      .andWhere('(fp.role_id = :roleId OR fp.role_id IS NULL)', { roleId: activeRoleId })
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .andWhere('file.deleted_at IS NULL')
      .getMany();

    const resultFiles = new Map<string, any>();

    // Process sharedWithMe
    for (const perm of sharedWithMePerms) {
      const file = perm.file;
      if (!file) continue;
      if (file.owner_id === userId) continue; // skip own files

      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, toFileEntry(file, perm.can_read, perm.can_download, perm.role_id ?? null));
      }
    }

    // Files inside folders shared WITH this user via folder_permissions (e.g.
    // an approved access request) — these never get an individual
    // file_permissions row, so they'd otherwise never show up here even
    // though the user can already browse into the folder itself.
    const sharedFolderPerms = await this.folderPermissionRepo
      .createQueryBuilder('fp')
      .where('fp.user_id = :userId', { userId })
      .andWhere('(fp.role_id = :roleId OR fp.role_id IS NULL)', { roleId: activeRoleId })
      .andWhere('fp.can_read = true')
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getMany();

    const sharedFolderIds = [...new Set(sharedFolderPerms.map((fp) => fp.folder_id))];

    if (sharedFolderIds.length > 0) {
      const filesInSharedFolders = await this.fileRepo
        .createQueryBuilder('file')
        .leftJoinAndSelect('file.folder', 'folder')
        .leftJoinAndSelect('file.uploaded_by_role', 'uploadedByRole')
        .leftJoinAndSelect('file.owner', 'owner')
        .where('file.folder_id IN (:...folderIds)', { folderIds: sharedFolderIds })
        .andWhere('file.deleted_at IS NULL')
        .getMany();

      for (const file of filesInSharedFolders) {
        if (file.owner_id === userId) continue; // skip own files
        if (resultFiles.has(file.id)) continue; // already included via direct file share

        const folderPerm = sharedFolderPerms.find((fp) => fp.folder_id === file.folder_id);
        resultFiles.set(
          file.id,
          toFileEntry(file, folderPerm?.can_read ?? true, folderPerm?.can_download ?? false, folderPerm?.role_id ?? null),
        );
      }
    }

    // Batch-fetch missing folder names
    const missingFolderIds = [...new Set(
      Array.from(resultFiles.values())
        .filter(f => !f.folder && f.folder_id)
        .map(f => f.folder_id)
    )];
    if (missingFolderIds.length > 0) {
      const folders = await this.folderRepo.findByIds(missingFolderIds);
      const folderMap = new Map(folders.map(f => [f.id, { id: f.id, name: f.name }]));
      for (const [id, file] of resultFiles) {
        if (!file.folder && file.folder_id && folderMap.has(file.folder_id)) {
          resultFiles.set(id, { ...file, folder: folderMap.get(file.folder_id) });
        }
      }
    }

    // Batch-fetch missing role names
    const missingRoleIds = [...new Set(
      Array.from(resultFiles.values())
        .filter(f => !f.owner_role && f.uploaded_by_role_id)
        .map(f => f.uploaded_by_role_id)
    )];
    if (missingRoleIds.length > 0) {
      const roles = await this.roleRepository.findByIds(missingRoleIds);
      const roleMap = new Map(roles.map(r => [r.id, r.name]));
      for (const [id, file] of resultFiles) {
        if (!file.owner_role && file.uploaded_by_role_id && roleMap.has(file.uploaded_by_role_id)) {
          const roleName = roleMap.get(file.uploaded_by_role_id);
          resultFiles.set(id, { ...file, owner_role: roleName, uploaded_by_role: roleName });
        }
      }
    }

    const filesArray = Array.from(resultFiles.values());
    filesArray.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return filesArray;
  }

  // =============================
  // DIRECT FILE SHARE (BY OWNER)
  // Stores one file_permissions record per (user_id, role_id) pair so that
  // access is gated to the exact role the sharer selected — consistent with
  // how folder Spesifik User Permission works.
  // =============================
  async directShareFile(
    fileId: string,
    data: {
      user_permissions?: Array<{
        user_id: string;
        role_id?: string | null;
        can_read?: boolean;
        can_download?: boolean;
      }>;
      message?: string;
    },
    requester: User & { active_role_id?: string; active_role_name?: string },
  ) {
    const file = await this.fileRepo.findOne({
      where: { id: fileId },
      relations: ['folder', 'folder.owner', 'uploaded_by_role'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const allowed = await canShareOrModifyFile(
      file as any,
      requester as any,
      { roleRepo: this.roleRepository },
    );
    if (!allowed) {
      throw new ForbiddenException('Anda tidak berhak men-share file ini');
    }

    // Build the target set of (user_id, role_id) pairs from the payload.
    // Each entry represents one role context for one user.
    const targetEntries: Array<{ user_id: string; role_id: string | null; can_read: boolean; can_download: boolean }> = [];

    if (data.user_permissions) {
      for (const p of data.user_permissions) {
        targetEntries.push({
          user_id: p.user_id,
          role_id: p.role_id ?? null,
          can_read: p.can_read ?? true,
          can_download: p.can_download ?? false,
        });
      }
    }

    // Sync: remove entries that are no longer in the target list
    const existingPerms = await this.filePermissionRepo.find({
      where: { file_id: fileId },
    });

    for (const ep of existingPerms) {
      const stillTarget = targetEntries.some(
        t => t.user_id === ep.user_id && (t.role_id ?? null) === ep.role_id,
      );
      if (!stillTarget) {
        await this.filePermissionRepo.delete(ep.id);
      }
    }

    // Upsert each target entry
    let count = 0;
    for (const entry of targetEntries) {
      const existing = existingPerms.find(
        ep => ep.user_id === entry.user_id && ep.role_id === (entry.role_id ?? null),
      );

      if (existing) {
        await this.filePermissionRepo.update(existing.id, {
          can_read: entry.can_read,
          can_download: entry.can_download,
        });
      } else {
        await this.filePermissionRepo.save(
          this.filePermissionRepo.create({
            file_id: fileId,
            user_id: entry.user_id,
            role_id: entry.role_id,
            can_read: entry.can_read,
            can_download: entry.can_download,
          }),
        );
      }
      count++;
    }

    return {
      message: `${count} entri akses file berhasil disimpan`,
      count,
    };
  }

  // =============================
  // GET FILE SHARES
  // Returns all active file_permissions for a file, with user and role info.
  // =============================
  async getFileShares(fileId: string) {
    const perms = await this.filePermissionRepo.find({
      where: { file_id: fileId },
      relations: ['user', 'role'],
    });

    return perms.map(p => ({
      id: p.id,
      file_id: p.file_id,
      user_id: p.user_id,
      role_id: p.role_id,
      can_read: p.can_read,
      can_download: p.can_download,
      expires_at: p.expires_at,
      created_at: p.created_at,
      // Expose nested user and role so the frontend can reconstruct state
      user: p.user
        ? { id: p.user.id, name: (p.user as any).name, email: (p.user as any).email }
        : null,
      role: p.role
        ? { id: p.role.id, name: (p.role as any).name }
        : null,
    }));
  }

  // =============================
  // USER REQUEST HIERARCHY INCREASE
  // =============================
  async requestHierarchyIncrease(
    userId: string,
    requestedDepth: number,
    message?: string,
    activeRoleId?: string,
  ) {
    const requester = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!requester) throw new NotFoundException('User not found');

    const roleIdToCheck = activeRoleId || requester.role_id;
    const activeRole = roleIdToCheck
      ? await this.roleRepository.findOne({ where: { id: roleIdToCheck } })
      : requester.role;

    if (activeRole?.is_private) {
      throw new ForbiddenException('Role ini tidak diizinkan untuk request tambah kedalaman folder');
    }

    const adminRole = await this.roleRepository.findOne({
      where: [
        { name: 'Super Admin' as any },
        { name: 'admin' as any },
        { name: 'superadmin' as any },
        { name: 'super admin' as any }
      ]
    });
    if (!adminRole) throw new NotFoundException('Admin role not found');

    const adminUser = await this.userRepo.findOne({ where: { role_id: adminRole.id } });
    if (!adminUser) throw new NotFoundException('Admin user not found');

    const existing = await this.accessRequestRepo.findOne({
      where: {
        requester: { id: userId },
        request_type: 'hierarchy',
        status: 'pending',
      },
    });

    if (existing) {
      throw new ForbiddenException('Anda sudah memiliki request hierarki yang masih pending');
    }

    const request = this.accessRequestRepo.create({
      requester,
      owner: adminUser,
      status: 'pending',
      request_type: 'hierarchy',
      requested_depth: requestedDepth,
      message: message || `Request tambah kedalaman folder ke ${requestedDepth} level`,
    });

    return this.accessRequestRepo.save(request);
  }

  // =============================
  // ADMIN APPROVE HIERARCHY REQUEST
  // =============================
  async approveHierarchyRequest(
    requestId: number,
    adminId: string,
    responseMessage?: string,
  ) {
    const request = await this.accessRequestRepo.findOne({
      where: { id: requestId },
      relations: ['requester'],
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.request_type !== 'hierarchy') {
      throw new ForbiddenException('This is not a hierarchy request');
    }

    request.status = 'approved';
    request.response_message = responseMessage || null;
    await this.accessRequestRepo.save(request);

    if (request.requested_depth) {
      request.requester.max_folder_depth = request.requested_depth;
      await this.userRepo.save(request.requester);
    }

    return { message: 'Hierarchy request approved' };
  }

  // =============================
  // GET PENDING HIERARCHY REQUESTS (for admin)
  // =============================
  async getPendingHierarchyRequests() {
    return this.accessRequestRepo.find({
      where: {
        request_type: 'hierarchy',
        status: 'pending',
      },
      order: { createdAt: 'DESC' },
    });
  }
}
