import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { FolderPermission } from '../entities/folder-permission.entity';
import { SystemSetting } from '../entities/system-setting.entity';

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
      relations: ['folder', 'file'],
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
    const approvedRequests = await this.accessRequestRepo.find({
      where: {
        requester: { id: userId },
        status: 'approved',
      },
      relations: ['file', 'file.folder', 'owner'],
    });

    // Filter only those that have a file and map them
    return approvedRequests
      .filter((r) => r.file)
      .map((r) => ({
        ...r.file,
        owner_name: r.owner?.name || 'Unknown',
        can_read: r.can_read,
        can_download: r.can_download,
        can_create: r.can_create,
        can_update: r.can_update,
        can_delete: r.can_delete,
      }));
  }

  // =============================
  // DIRECT FILE SHARE (BY OWNER)
  // ============= ================
  async directShareFile(
    fileId: string,
    data: { share_with_roles?: string[]; user_permissions?: any[]; message?: string },
    ownerId: string
  ) {
    const file = await this.fileRepo.findOne({
      where: { id: fileId },
      relations: ['folder', 'folder.owner']
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.folder?.owner?.id !== ownerId) {
      throw new ForbiddenException('You do not own this file');
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

    // 3. Grant access to all identified users
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
          owner: file.folder.owner,
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
  // USER REQUEST HIERARCHY INCREASE
  // =============================
  async requestHierarchyIncrease(
    userId: string,
    requestedDepth: number,
    message?: string,
  ) {
    const requester = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!requester) throw new NotFoundException('User not found');
    
    const roleName = requester.role?.name?.toLowerCase() || '';
    if (roleName.includes('dosen') || roleName.includes('tendik')) {
      throw new ForbiddenException('Role Dosen dan Tendik tidak diizinkan untuk request tambah kedalaman folder');
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