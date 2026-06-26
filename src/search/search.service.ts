import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FoldersService } from '../folders/folders.service';
import { AccessRequestsService } from '../access-requests/access-requests.service';

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private foldersService: FoldersService,
    private accessRequestsService: AccessRequestsService,
  ) {}

  async globalSearch(keyword: string, user: any) {
    if (!keyword) {
      return { folders: [], files: [] };
    }

    const activeRoleName = ((user as any).active_role_name ?? user.role?.name ?? '').toLowerCase();
    const isAdmin = ['admin', 'super admin', 'superadmin'].includes(activeRoleName);

    let accessibleFolderIds: string[] = [];
    if (!isAdmin) {
      accessibleFolderIds = await this.foldersService.getAccessibleFolderIds(user);
      if (accessibleFolderIds.length === 0) {
        return { folders: [], files: [] };
      }
    }

    const folders = await this.prisma.folders.findMany({
      where: {
        name: { contains: keyword, mode: 'insensitive' },
        deleted_at: null,
        ...(isAdmin ? {} : { id: { in: accessibleFolderIds } }),
      },
      include: { folders: true, users: true },
      take: 10,
    });

    const files = await this.prisma.files.findMany({
      where: {
        name: { contains: keyword, mode: 'insensitive' },
        deleted_at: null,
        ...(isAdmin ? {} : { folder_id: { in: accessibleFolderIds } }),
      },
      include: { folders: { include: { users: true } } },
      take: 10,
    });

    const userRequests = await this.accessRequestsService.getUserRequests(user.id);
    const folderRequestsMap = new Map(userRequests.filter((r: any) => r.folders).map((r: any) => [r.folders.id, r.status]));
    const fileRequestsMap = new Map(userRequests.filter((r: any) => r.files).map((r: any) => [r.files.id, r.status]));

    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parent: folder.folders?.name ?? 'Repository',
        owner: folder.users?.name,
        hasAccess: true,
        requestStatus: folderRequestsMap.get(folder.id) || null,
      })),

      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        type: 'file',
        parent: file.folders?.name,
        owner: file.folders?.users?.name,
        hasAccess: true,
        requestStatus: fileRequestsMap.get(file.id) || null,
      })),
    };
  }
}
