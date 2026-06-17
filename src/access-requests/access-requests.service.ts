import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { FolderPermission } from '../entities/folder-permission.entity';
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
      relations: ['owner', 'requester', 'folder', 'file']
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
    const isAdmin = user?.role?.name === 'admin';

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

    // Notifikasi untuk requester: request mereka yang sudah di-approve/reject
    const myUpdatedRequests = await this.accessRequestRepo.find({
      where: [
        { requester: { id: userId }, status: 'approved' },
        { requester: { id: userId }, status: 'rejected' },
      ],
      relations: ['folder', 'file', 'requester', 'requester.role'],
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
      id: p.id ? Number(p.id.replace(/\D/g, '').substring(0, 8)) + 1000000 : Math.floor(Math.random() * 1000000), // Fake integer ID for UI render keys
      type: 'update' as const,
      resourceName: p.folder?.name || 'Unknown',
      resourceType: 'folder' as const,
      status: 'approved',
      createdAt: p.created_at.toISOString(),
    }));

    // Gabungkan notifikasi update dan urutkan berdasarkan waktu
    const allUpdates = [...normalUpdates, ...directShareUpdates].sort(
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
  // =============================
  async getSharedFiles(userId: string) {
    // 1. Files shared WITH the user (only those with View permission)
    const sharedWithMe = await this.accessRequestRepo.find({
      where: {
        requester: { id: userId },
        status: 'approved',
        can_read: true,
      },
      relations: ['file', 'file.folder', 'file.uploaded_by_role', 'owner', 'owner.role'],
    });

    // 2. Files shared BY the user
    const sharedByMe = await this.accessRequestRepo.find({
      where: {
        owner: { id: userId },
        status: 'approved',
      },
      relations: ['file', 'file.folder', 'file.uploaded_by_role'],
    });

    // 3. Files uploaded by OTHERS in MY folders
    const othersFilesInMyFolders = await this.fileRepo.createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('file.owner', 'owner')
      .leftJoinAndSelect('owner.role', 'role')
      .leftJoinAndSelect('file.uploaded_by_role', 'uploadedByRole')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.owner_id != :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .getMany();

    const resultFiles = new Map<string, any>();
    const me = await this.userRepo.findOne({ where: { id: userId }, relations: ['role'] });

    // Process sharedWithMe
    for (const r of sharedWithMe) {
      if (!r.file) continue;
      const file = r.file;
      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size: file.size,
          created_at: file.created_at,
          updated_at: file.updated_at,
          owner_id: r.owner?.id,
          owner_name: r.owner?.name || 'Unknown',
          owner_email: r.owner?.email || '(email tidak tersedia)',
          owner_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by: r.owner?.name || 'Unknown',
          uploaded_by_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by_role_id: (file as any).uploaded_by_role_id ?? null,
          can_read: r.can_read,
          can_download: r.can_download,
          can_create: r.can_create,
          can_update: r.can_update,
          can_delete: r.can_delete,
          folder_id: file.folder_id ?? null,
          folder: file.folder ? { id: file.folder.id, name: file.folder.name } : null,
        });
      }
    }

    // Process sharedByMe
    for (const r of sharedByMe) {
      if (!r.file) continue;
      const file = r.file;
      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size: file.size,
          created_at: file.created_at,
          updated_at: file.updated_at,
          owner_id: userId,
          owner_name: me?.name || 'Anda',
          owner_email: me?.email || '(email tidak tersedia)',
          owner_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by: me?.name || 'Anda',
          uploaded_by_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by_role_id: (file as any).uploaded_by_role_id ?? null,
          can_read: true,
          can_download: true,
          can_create: true,
          can_update: true,
          can_delete: true,
          folder_id: file.folder_id ?? null,
          folder: file.folder ? { id: file.folder.id, name: file.folder.name } : null,
        });
      }
    }

    // Process othersFilesInMyFolders
    for (const file of othersFilesInMyFolders) {
      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size: file.size,
          created_at: file.created_at,
          updated_at: file.updated_at,
          owner_id: file.owner_id,
          owner_name: file.owner?.name || 'Unknown',
          owner_email: file.owner?.email || '(email tidak tersedia)',
          owner_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by: file.owner?.name || 'Unknown',
          uploaded_by_role: (file as any).uploaded_by_role?.name ?? null,
          uploaded_by_role_id: (file as any).uploaded_by_role_id ?? null,
          can_read: true,
          can_download: true,
          can_create: true,
          can_update: true,
          can_delete: true,
          folder_id: file.folder_id ?? null,
          folder: file.folder ? { id: file.folder.id, name: file.folder.name } : null,
        });
      }
    }

    // Batch-fetch folder names for files that didn't get folder loaded (eager-relation issue)
    const missingFolderIds = [...new Set(
      Array.from(resultFiles.values())
        .filter(f => !f.folder && f.folder_id)
        .map(f => f.folder_id)
    )];
    if (missingFolderIds.length > 0) {
      const folders = await this.folderRepo.find({ where: { id: In(missingFolderIds) } });
      const folderMap = new Map(folders.map(f => [f.id, { id: f.id, name: f.name }]));
      for (const [id, file] of resultFiles) {
        if (!file.folder && file.folder_id && folderMap.has(file.folder_id)) {
          resultFiles.set(id, { ...file, folder: folderMap.get(file.folder_id) });
        }
      }
    }

    // Batch-fetch role names for files where uploaded_by_role wasn't loaded (eager-relation issue)
    const missingRoleIds = [...new Set(
      Array.from(resultFiles.values())
        .filter(f => !f.owner_role && f.uploaded_by_role_id)
        .map(f => f.uploaded_by_role_id)
    )];
    if (missingRoleIds.length > 0) {
      const roles = await this.roleRepository.find({ where: { id: In(missingRoleIds) } });
      const roleMap = new Map(roles.map(r => [r.id, r.name]));
      for (const [id, file] of resultFiles) {
        if (!file.owner_role && file.uploaded_by_role_id && roleMap.has(file.uploaded_by_role_id)) {
          const roleName = roleMap.get(file.uploaded_by_role_id);
          resultFiles.set(id, { ...file, owner_role: roleName, uploaded_by_role: roleName });
        }
      }
    }

    // Convert map to array and sort by created_at descending
    const filesArray = Array.from(resultFiles.values());
    filesArray.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    return filesArray;
  }

  // =============================
  // DIRECT FILE SHARE (BY OWNER)
  // ============= ================
  async directShareFile(
    fileId: string,
    data: { share_with_roles?: string[]; user_permissions?: any[]; message?: string },
    requester: User & { active_role_id?: string; active_role_name?: string },
  ) {
    const file = await this.fileRepo.findOne({
      where: { id: fileId },
      relations: ['folder', 'folder.owner', 'uploaded_by_role'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const ownerId = requester.id;

    const allowed = await canShareOrModifyFile(
      file as any,
      requester as any,
      { roleRepo: this.roleRepository },
    );
    if (!allowed) {
      throw new ForbiddenException('Anda tidak berhak men-share file ini');
    }

    const results: AccessRequest[] = [];
    const targetUserIds = new Set<string>();
    const userPermsMap = new Map<string, any>();

    // 1. Process specific user permissions
    if (data.user_permissions) {
      for (const p of data.user_permissions) {
        targetUserIds.add(p.user_id);
        userPermsMap.set(p.user_id, p);
      }
    }

    // 2. Process roles to get more users
    if (data.share_with_roles) {
      for (const roleName of data.share_with_roles) {
        const mappedName = this.mapRoleLabelToName(roleName);
        const role = await this.roleRepository.findOne({
          where: { name: mappedName as any }
        });
        if (role) {
          const usersInRole = await this.userRepo.find({
            where: { role_id: role.id }
          });
          for (const u of usersInRole) {
            if (u.id !== ownerId) {
              targetUserIds.add(u.id);
            }
          }
        }
      }
    }

    // 3. Sync existing shares: Remove shares for users no longer in targetUserIds
    const existingShares = await this.accessRequestRepo.find({
      where: { file: { id: fileId }, status: 'approved' },
      relations: ['requester']
    });

    for (const share of existingShares) {
      if (share.requester && !targetUserIds.has(share.requester.id)) {
        // Option A: Delete the request
        // await this.accessRequestRepo.delete(share.id);
        
        // Option B: Mark as rejected or just remove the approval
        share.status = 'rejected';
        share.response_message = 'Akses dicabut oleh pemilik';
        await this.accessRequestRepo.save(share);
      }
    }

    // 4. Grant/Update access to all identified users
    for (const userId of targetUserIds) {
      const targetUser = await this.userRepo.findOne({ where: { id: userId }, relations: ['role'] });
      if (!targetUser) continue;

      const roleName = targetUser.role?.name?.toLowerCase() || '';
      const isDosenOrTendik = roleName.includes('dosen') || roleName.includes('tendik');

      let request = await this.accessRequestRepo.findOne({
        where: { requester: { id: userId }, file: { id: fileId } }
      });

      const userPerms = userPermsMap.get(userId) || {
        can_read: true, can_download: false, can_create: isDosenOrTendik, can_update: isDosenOrTendik, can_delete: isDosenOrTendik
      };

      if (!request) {
        request = this.accessRequestRepo.create({
          requester: targetUser,
          file: file,
          owner: file.folder.owner as User,
          status: 'approved',
          response_message: data.message || null,
          can_read: userPerms.can_read ?? true,
          can_download: userPerms.can_download ?? false,
          can_create: isDosenOrTendik,
          can_update: isDosenOrTendik,
          can_delete: isDosenOrTendik,
        });
      } else {
        request.status = 'approved';
        if (data.message) request.response_message = data.message;
        request.can_read = userPerms.can_read ?? true;
        request.can_download = userPerms.can_download ?? false;
        request.can_create = isDosenOrTendik;
        request.can_update = isDosenOrTendik;
        request.can_delete = isDosenOrTendik;
      }

      await this.accessRequestRepo.save(request);

      // Ensure they can "see" the parent folder to list the file
      const existingFolderPerm = await this.folderPermissionRepo.findOne({
        where: { user_id: userId, folder_id: file.folder_id }
      });

      if (!existingFolderPerm) {
        await this.folderPermissionRepo.save({
          user_id: userId,
          folder_id: file.folder_id,
          can_read: true,
          can_create: false,
          can_update: false,
          can_delete: false
        });
      }

      results.push(request);
    }

    return {
      message: `${results.length} users granted access to file`,
      count: results.length
    };
  }
    // =============================
  // GET FILE SHARES
  // =============================
  async getFileShares(fileId: string) {
    return this.accessRequestRepo.find({
      where: {
        file: { id: fileId },
        status: 'approved'
      },
      relations: ['requester']
    });
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

    // Check restriction based on ACTIVE role's is_private flag, not the hardcoded primary role name.
    // A user whose primary role is Dosen but is currently acting as Wakil Dekan should be allowed.
    const roleIdToCheck = activeRoleId || requester.role_id;
    const activeRole = roleIdToCheck
      ? await this.roleRepository.findOne({ where: { id: roleIdToCheck } })
      : requester.role;

    if (activeRole?.is_private) {
      throw new ForbiddenException('Role ini tidak diizinkan untuk request tambah kedalaman folder');
    }

    // Find any admin user to be the "owner" of this request
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

    // Check if there's already a pending hierarchy request from this user
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

    // Update the specific user's max_folder_depth
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