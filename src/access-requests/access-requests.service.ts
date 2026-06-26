import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { canShareOrModifyFile } from '../common/utils/file-access';

@Injectable()
export class AccessRequestsService {
  constructor(private prisma: PrismaService) {}

  private mapRoleLabelToName(label: string): string {
    const norm = label.toLowerCase().trim();
    if (norm === 'wakil dekan 1' || norm === 'wd 1' || norm === 'wd1') return 'wd1';
    if (norm === 'wakil dekan 2' || norm === 'wd 2' || norm === 'wd2') return 'wd2';
    if (norm === 'wakil dekan 3' || norm === 'wd 3' || norm === 'wd3') return 'wd3';
    if (norm.includes('dosen')) return 'dosen';
    if (norm.includes('tendik')) return 'tendik';
    return norm;
  }

  async requestAccess(userId: string, folderId?: string, fileId?: string, message?: string) {
    if (!folderId && !fileId) {
      throw new ForbiddenException('FolderId or FileId required');
    }

    if (folderId) {
      const folder = await this.prisma.folders.findUnique({
        where: { id: folderId },
        include: { users: true },
      });

      if (!folder || !folder.users) {
        throw new NotFoundException('Folder not found');
      }

      if (folder.users.id === userId) {
        throw new ForbiddenException('Owner already has access');
      }

      const existingRequest = await this.prisma.access_requests.findFirst({
        where: { requesterId: userId, folderId, status: 'pending' },
      });

      if (existingRequest) throw new ForbiddenException('Request already pending');

      return this.prisma.access_requests.create({
        data: {
          requesterId: userId,
          folderId,
          ownerId: folder.users.id,
          status: 'pending',
          message: message || null,
        },
      });
    }

    if (fileId) {
      const file = await this.prisma.files.findUnique({
        where: { id: fileId },
        include: { folders: { include: { users: true } } },
      });

      if (!file || !file.folders || !file.folders.users) {
        throw new NotFoundException('File not found');
      }

      const existingRequest = await this.prisma.access_requests.findFirst({
        where: { requesterId: userId, fileId, status: 'pending' },
      });

      if (existingRequest) throw new ForbiddenException('Request already pending');

      return this.prisma.access_requests.create({
        data: {
          requesterId: userId,
          fileId,
          ownerId: file.folders.users.id,
          status: 'pending',
          message: message || null,
        },
      });
    }
  }

  async getUserRequests(userId: string) {
    return this.prisma.access_requests.findMany({
      where: { requesterId: userId },
      include: { folders: true, files: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingRequests(ownerId: string) {
    return this.prisma.access_requests.findMany({
      where: { ownerId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveRequest(requestId: number, ownerId: string, permissions: any, responseMessage?: string) {
    const request = await this.prisma.access_requests.findUnique({
      where: { id: requestId },
      include: {
        users_access_requests_ownerIdTousers: true,
        users_access_requests_requesterIdTousers: true,
        folders: true,
        files: true,
      },
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.ownerId !== ownerId) throw new ForbiddenException('Not your resource');

    const targetUser = request.requesterId
      ? await this.prisma.users.findUnique({
          where: { id: request.requesterId },
          include: { roles: true },
        })
      : null;
    const roleName = (targetUser as any)?.roles?.name?.toLowerCase() || '';
    const isDosenOrTendik = roleName.includes('dosen') || roleName.includes('tendik');

    if (request.request_type === 'delete_confirmation') {
      await this.prisma.access_requests.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          response_message: responseMessage || 'Persetujuan penghapusan file dikonfirmasi',
        },
      });

      if (request.fileId) {
        await this.prisma.files.update({
          where: { id: request.fileId },
          data: { deleted_at: new Date() },
        });
      }

      return { message: 'File berhasil dipindahkan ke Recycle Bin' };
    }

    const canRead = permissions?.can_read ?? true;
    const canDownload = permissions?.can_download ?? false;
    const canCreate = isDosenOrTendik ? true : (permissions?.can_create ?? false);
    const canUpdate = isDosenOrTendik ? true : (permissions?.can_update ?? false);
    const canDelete = isDosenOrTendik ? true : (permissions?.can_delete ?? false);

    await this.prisma.access_requests.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        response_message: responseMessage || null,
        can_read: canRead,
        can_download: canDownload,
        can_create: canCreate,
        can_update: canUpdate,
        can_delete: canDelete,
      },
    });

    if (request.folderId) {
      await this.prisma.folder_permissions.create({
        data: {
          user_id: request.requesterId,
          folder_id: request.folderId,
          can_read: canRead,
          can_download: canDownload,
          can_create: canCreate,
          can_update: canUpdate,
          can_delete: canDelete,
        },
      });
    } else if (request.fileId && request.files?.folder_id) {
      await this.prisma.folder_permissions.create({
        data: {
          user_id: request.requesterId,
          folder_id: request.files.folder_id,
          can_read: true,
          can_download: permissions?.can_download ?? true,
          can_create: false,
          can_update: false,
          can_delete: false,
        },
      });
    }

    return { message: 'Request approved' };
  }

  async rejectRequest(requestId: number, ownerId: string, responseMessage?: string) {
    const request = await this.prisma.access_requests.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.ownerId !== ownerId) throw new ForbiddenException('Not your resource');

    return this.prisma.access_requests.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        response_message: responseMessage || null,
      },
    });
  }

  async getAllPendingRequests() {
    return this.prisma.access_requests.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNotifications(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    const isAdmin = user?.roles?.name === 'admin';

    const incomingRequests = isAdmin
      ? await this.prisma.access_requests.findMany({
          where: { status: 'pending' },
          include: {
            users_access_requests_requesterIdTousers: true,
            folders: true,
            files: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.access_requests.findMany({
          where: { ownerId: userId, status: 'pending' },
          include: {
            users_access_requests_requesterIdTousers: true,
            folders: true,
            files: true,
          },
          orderBy: { createdAt: 'desc' },
        });

    const myUpdatedRequests = await this.prisma.access_requests.findMany({
      where: {
        OR: [
          { requesterId: userId, status: 'approved' },
          { requesterId: userId, status: 'rejected' },
        ],
      },
      include: {
        folders: true,
        files: true,
        users_access_requests_requesterIdTousers: { include: { roles: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const directShares = await this.prisma.folder_permissions.findMany({
      where: { user_id: userId },
      include: { folders: { include: { users: true } } },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    const filteredDirectShares = directShares.filter(
      (p) => p.folders && p.folders.users && p.folders.users.id !== userId,
    );

    const directFileShares = await this.prisma.file_permissions.findMany({
      where: { user_id: userId },
      include: { files: true },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    const normalUpdates = myUpdatedRequests.map((r) => {
      const requester = r.users_access_requests_requesterIdTousers;
      return {
        id: r.id,
        type: 'update' as const,
        requesterName: requester?.name || 'Unknown',
        requesterEmail: requester?.email || '',
        resourceName: r.folders?.name || r.files?.name || 'Unknown',
        resourceType: r.folders ? 'folder' : ('file' as const),
        status: r.status,
        response_message: r.response_message || null,
        createdAt: r.createdAt.toISOString(),
      };
    });

    const directShareUpdates = filteredDirectShares.map((p) => ({
      id: p.id ? Number(p.id.replace(/\D/g, '').substring(0, 8)) + 1000000 : Math.floor(Math.random() * 1000000),
      type: 'update' as const,
      resourceName: p.folders?.name || 'Unknown',
      resourceType: 'folder' as const,
      status: 'approved',
      createdAt: p.created_at.toISOString(),
    }));

    const directFileShareUpdates = directFileShares.map((p) => ({
      id: p.id ? Number(p.id.replace(/\D/g, '').substring(0, 8)) + 2000000 : Math.floor(Math.random() * 1000000),
      type: 'update' as const,
      resourceName: p.files?.name || 'Unknown',
      resourceType: 'file' as const,
      status: 'approved',
      createdAt: p.created_at.toISOString(),
    }));

    const allUpdates = [...normalUpdates, ...directShareUpdates, ...directFileShareUpdates].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      incoming: incomingRequests.map((r) => {
        const requester = r.users_access_requests_requesterIdTousers;
        return {
          id: r.id,
          type: 'incoming' as const,
          requesterName: requester?.name || requester?.email || 'Unknown',
          requesterEmail: requester?.email || '',
          resourceName: r.folders?.name || r.files?.name || 'Unknown',
          resourceType: r.folders ? 'folder' : 'file',
          status: r.status,
          message: r.message || null,
          request_type: r.request_type || 'access',
          requested_depth: r.requested_depth || null,
          createdAt: r.createdAt.toISOString(),
        };
      }),
      updates: allUpdates,
    };
  }

  async getSharedFiles(userId: string, activeRoleId: string) {
    const now = new Date();

    const sharedWithMePerms = await this.prisma.file_permissions.findMany({
      where: {
        user_id: userId,
        OR: [{ role_id: activeRoleId }, { role_id: null }],
        can_read: true,
        AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: now } }] }],
        files: { deleted_at: null },
      },
      include: {
        files: {
          include: {
            folders: true,
            roles: true,
            users: true,
          },
        },
      },
    });

    const othersFilesInMyFolders = await this.prisma.files.findMany({
      where: {
        folders: { owner_id: userId, deleted_at: null },
        owner_id: { not: userId },
        deleted_at: null,
      },
      include: {
        folders: true,
        users: true,
        roles: true,
      },
    });

    const resultFiles = new Map<string, any>();

    for (const perm of sharedWithMePerms) {
      const file = perm.files;
      if (!file) continue;
      if (file.owner_id === userId) continue;

      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size: Number(file.size),
          created_at: file.created_at,
          updated_at: file.updated_at,
          owner_id: file.owner_id,
          owner_name: file.users?.name || 'Unknown',
          owner_email: file.users?.email || '(email tidak tersedia)',
          owner_role: file.roles?.name ?? null,
          uploaded_by: file.users?.name || 'Unknown',
          uploaded_by_role: file.roles?.name ?? null,
          uploaded_by_role_id: file.uploaded_by_role_id ?? null,
          can_read: perm.can_read,
          can_download: perm.can_download,
          can_create: false,
          can_update: false,
          can_delete: false,
          folder_id: file.folder_id ?? null,
          folder: file.folders ? { id: file.folders.id, name: file.folders.name } : null,
          shared_for_role_id: perm.role_id ?? null,
        });
      }
    }

    for (const file of othersFilesInMyFolders) {
      if (!resultFiles.has(file.id)) {
        resultFiles.set(file.id, {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size: Number(file.size),
          created_at: file.created_at,
          updated_at: file.updated_at,
          owner_id: file.owner_id,
          owner_name: file.users?.name || 'Unknown',
          owner_email: file.users?.email || '(email tidak tersedia)',
          owner_role: file.roles?.name ?? null,
          uploaded_by: file.users?.name || 'Unknown',
          uploaded_by_role: file.roles?.name ?? null,
          uploaded_by_role_id: file.uploaded_by_role_id ?? null,
          can_read: true,
          can_download: true,
          can_create: true,
          can_update: true,
          can_delete: true,
          folder_id: file.folder_id ?? null,
          folder: file.folders ? { id: file.folders.id, name: file.folders.name } : null,
          shared_for_role_id: null,
        });
      }
    }

    const filesArray = Array.from(resultFiles.values());
    filesArray.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return filesArray;
  }

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
    requester: any,
  ) {
    const file = await this.prisma.files.findUnique({
      where: { id: fileId },
      include: {
        folders: { include: { users: true } },
        roles: true,
      },
    });

    if (!file) throw new NotFoundException('File not found');

    const fileLike = {
      id: file.id,
      owner_id: file.owner_id,
      folder_id: file.folder_id,
      uploaded_by_role_id: file.uploaded_by_role_id,
      folder: file.folders
        ? { owner_id: file.folders.owner_id, role_id: file.folders.role_id }
        : null,
      uploaded_by_role: file.roles ? { name: file.roles.name } : null,
    };

    const allowed = await canShareOrModifyFile(fileLike, requester, {
      findRole: (id) => this.prisma.roles.findUnique({ where: { id } }),
    });
    if (!allowed) throw new ForbiddenException('Anda tidak berhak men-share file ini');

    const targetEntries: Array<{
      user_id: string;
      role_id: string | null;
      can_read: boolean;
      can_download: boolean;
    }> = [];

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

    const existingPerms = await this.prisma.file_permissions.findMany({
      where: { file_id: fileId },
    });

    for (const ep of existingPerms) {
      const stillTarget = targetEntries.some(
        (t) => t.user_id === ep.user_id && (t.role_id ?? null) === ep.role_id,
      );
      if (!stillTarget) {
        await this.prisma.file_permissions.delete({ where: { id: ep.id } });
      }
    }

    let count = 0;
    for (const entry of targetEntries) {
      const existing = existingPerms.find(
        (ep) => ep.user_id === entry.user_id && ep.role_id === (entry.role_id ?? null),
      );

      if (existing) {
        await this.prisma.file_permissions.update({
          where: { id: existing.id },
          data: { can_read: entry.can_read, can_download: entry.can_download },
        });
      } else {
        await this.prisma.file_permissions.create({
          data: {
            file_id: fileId,
            user_id: entry.user_id,
            role_id: entry.role_id,
            can_read: entry.can_read,
            can_download: entry.can_download,
          },
        });
      }
      count++;

      const roleIdForFolder = entry.role_id;
      const existingFolderPerm = await this.prisma.folder_permissions.findFirst({
        where: {
          user_id: entry.user_id,
          folder_id: file.folder_id,
          role_id: roleIdForFolder,
        },
      });

      if (!existingFolderPerm) {
        await this.prisma.folder_permissions.create({
          data: {
            user_id: entry.user_id,
            folder_id: file.folder_id,
            role_id: roleIdForFolder,
            can_read: true,
            can_download: entry.can_download,
            can_create: false,
            can_update: false,
            can_delete: false,
          },
        });
      }
    }

    return { message: `${count} entri akses file berhasil disimpan`, count };
  }

  async getFileShares(fileId: string) {
    const perms = await this.prisma.file_permissions.findMany({
      where: { file_id: fileId },
      include: { users: true, roles: true },
    });

    return perms.map((p) => ({
      id: p.id,
      file_id: p.file_id,
      user_id: p.user_id,
      role_id: p.role_id,
      can_read: p.can_read,
      can_download: p.can_download,
      expires_at: p.expires_at,
      created_at: p.created_at,
      user: p.users ? { id: p.users.id, name: p.users.name, email: p.users.email } : null,
      role: p.roles ? { id: p.roles.id, name: p.roles.name } : null,
    }));
  }

  async requestHierarchyIncrease(
    userId: string,
    requestedDepth: number,
    message?: string,
    activeRoleId?: string,
  ) {
    const requester = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!requester) throw new NotFoundException('User not found');

    const roleIdToCheck = activeRoleId || requester.role_id;
    const activeRole = roleIdToCheck
      ? await this.prisma.roles.findUnique({ where: { id: roleIdToCheck } })
      : requester.roles;

    if (activeRole?.is_private) {
      throw new ForbiddenException('Role ini tidak diizinkan untuk request tambah kedalaman folder');
    }

    const adminRole = await this.prisma.roles.findFirst({
      where: {
        OR: [
          { name: 'Super Admin' },
          { name: 'admin' },
          { name: 'superadmin' },
          { name: 'super admin' },
        ],
      },
    });
    if (!adminRole) throw new NotFoundException('Admin role not found');

    const adminUser = await this.prisma.users.findFirst({ where: { role_id: adminRole.id } });
    if (!adminUser) throw new NotFoundException('Admin user not found');

    const existing = await this.prisma.access_requests.findFirst({
      where: { requesterId: userId, request_type: 'hierarchy', status: 'pending' },
    });

    if (existing) {
      throw new ForbiddenException('Anda sudah memiliki request hierarki yang masih pending');
    }

    return this.prisma.access_requests.create({
      data: {
        requesterId: userId,
        ownerId: adminUser.id,
        status: 'pending',
        request_type: 'hierarchy',
        requested_depth: requestedDepth,
        message: message || `Request tambah kedalaman folder ke ${requestedDepth} level`,
      },
    });
  }

  async approveHierarchyRequest(requestId: number, adminId: string, responseMessage?: string) {
    const request = await this.prisma.access_requests.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.request_type !== 'hierarchy') {
      throw new ForbiddenException('This is not a hierarchy request');
    }

    await this.prisma.access_requests.update({
      where: { id: requestId },
      data: { status: 'approved', response_message: responseMessage || null },
    });

    if (request.requested_depth && request.requesterId) {
      await this.prisma.users.update({
        where: { id: request.requesterId },
        data: { max_folder_depth: request.requested_depth },
      });
    }

    return { message: 'Hierarchy request approved' };
  }

  async getPendingHierarchyRequests() {
    return this.prisma.access_requests.findMany({
      where: { request_type: 'hierarchy', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
