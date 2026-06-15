import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
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
      return { folders: [], files: [] };
    }

    // Use active_role_name from JWT (reflects the role the user switched to).
    const activeRoleName = ((user as any).active_role_name ?? user.role?.name ?? '').toLowerCase();
    const isAdmin = ['admin', 'super admin', 'superadmin'].includes(activeRoleName);

    // Enforce "no access = no visibility": compute accessible folder IDs first so that
    // the search query itself is pre-filtered.  This prevents private-role folders from
    // other contexts from appearing in results even with hasAccess=false.
    let accessibleFolderIds: string[] = [];
    if (!isAdmin) {
      accessibleFolderIds = await this.foldersService.getAccessibleFolderIds(user);
      if (accessibleFolderIds.length === 0) {
        return { folders: [], files: [] };
      }
    }

    // =========================
    // SEARCH FOLDER
    // =========================
    const folders = await this.folderRepo.find({
      where: {
        name: ILike(`%${keyword}%`),
        ...(isAdmin ? {} : { id: In(accessibleFolderIds) }),
      },
      relations: ['parent', 'owner'],
      take: 10,
    });

    // =========================
    // SEARCH FILE (within accessible folders only)
    // =========================
    const fileQuery = this.fileRepo
      .createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('folder.owner', 'owner')
      .where('file.name ILIKE :keyword', { keyword: `%${keyword}%` })
      .andWhere('file.deleted_at IS NULL');

    if (!isAdmin) {
      fileQuery.andWhere('file.folder_id IN (:...folderIds)', { folderIds: accessibleFolderIds });
    }
    const files = await fileQuery.take(10).getMany();

    const userRequests = await this.accessRequestsService.getUserRequests(user.id);
    const folderRequestsMap = new Map(userRequests.filter(r => r.folder).map(r => [r.folder.id, r.status]));
    const fileRequestsMap = new Map(userRequests.filter(r => r.file).map(r => [r.file.id, r.status]));

    return {
      folders: folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parent: folder.parent?.name ?? 'Repository',
        owner: folder.owner?.name,
        hasAccess: true,  // All returned folders are pre-filtered to be accessible
        requestStatus: folderRequestsMap.get(folder.id) || null,
      })),

      files: files.map(file => ({
        id: file.id,
        name: file.name,
        type: 'file',
        parent: file.folder?.name,
        owner: file.folder?.owner?.name,
        hasAccess: true,  // All returned files are pre-filtered to be accessible
        requestStatus: fileRequestsMap.get(file.id) || null,
      })),
    };
  }
}