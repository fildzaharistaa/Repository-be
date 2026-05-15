import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { FoldersService } from '../folders/folders.service';
import { AccessRequestsService } from '../access-requests/access-requests.service';
import { User } from '../entities/user.entity';

@Injectable()
export class SearchService {

  constructor(
    @InjectRepository(Folder)
    private folderRepo: Repository<Folder>,

    @InjectRepository(File)
    private fileRepo: Repository<File>,

    private foldersService: FoldersService,
    private accessRequestsService: AccessRequestsService,
  ) {}

  async globalSearch(keyword: string, user: User) {

    if (!keyword) {
      return {
        folders: [],
        files: []
      };
    }

    // =========================
    // SEARCH FOLDER
    // =========================
    const folders = await this.folderRepo.find({
      where: {
        name: ILike(`%${keyword}%`)
      },
      relations: ['parent', 'owner'],
      take: 10
    });

    // =========================
    // SEARCH FILE
    // =========================
    const files = await this.fileRepo.find({
      where: {
        name: ILike(`%${keyword}%`)
      },
      relations: ['folder', 'folder.owner'],
      take: 10
    });

    // Compute Access & Request Status
    // Use active_role_name from JWT (reflects the role the user switched to) rather than
    // user.role?.name which is the primary role and never changes during a session.
    const activeRoleName = ((user as any).active_role_name ?? user.role?.name ?? '').toLowerCase();
    const isAdmin = ['admin', 'super admin', 'superadmin'].includes(activeRoleName);
    let accessibleFolderIds: string[] = [];
    if (!isAdmin) {
      accessibleFolderIds = await this.foldersService.getAccessibleFolderIds(user);
    }
    const accessibleSet = new Set(accessibleFolderIds);

    const userRequests = await this.accessRequestsService.getUserRequests(user.id);
    const folderRequestsMap = new Map(userRequests.filter(r => r.folder).map(r => [r.folder.id, r.status]));
    const fileRequestsMap = new Map(userRequests.filter(r => r.file).map(r => [r.file.id, r.status]));

    return {
      folders: folders.map(folder => {
        const hasAccess = isAdmin || folder.owner?.id === user.id || accessibleSet.has(folder.id);
        const requestStatus = folderRequestsMap.get(folder.id) || null;
        return {
          id: folder.id,
          name: folder.name,
          type: 'folder',
          parent: folder.parent?.name ?? 'Repository',
          owner: folder.owner?.name,
          hasAccess,
          requestStatus
        };
      }),

      files: files.map(file => {
        let hasAccess = isAdmin || file.folder?.owner?.id === user.id || (file.folder && accessibleSet.has(file.folder.id));
        const requestStatus = fileRequestsMap.get(file.id) || null;
        
        // If there's an approved file request, they definitely have access
        if (requestStatus === 'approved') {
          hasAccess = true;
        }

        return {
          id: file.id,
          name: file.name,
          type: 'file',
          parent: file.folder?.name,
          owner: file.folder?.owner?.name,
          hasAccess,
          requestStatus
        };
      })
    };
  }
}