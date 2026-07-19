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
      return { folders: [], files: [] };
    }

    // Use active_role_name from JWT (reflects the role the user switched to).
    const activeRoleName = ((user as any).active_role_name ?? user.role?.name ?? '').toLowerCase();
    const isAdmin = ['admin', 'super admin', 'superadmin'].includes(activeRoleName);

    // True global search: every folder/file matching the keyword is returned
    // (existence + owner name is visible to everyone), but items outside the
    // user's accessible set come back with hasAccess=false so the frontend
    // shows a "Request Access" action instead of letting them open it.
    const accessibleFolderIds = isAdmin
      ? null
      : new Set(await this.foldersService.getAccessibleFolderIds(user));

    // =========================
    // SEARCH FOLDER
    // =========================
    const folders = await this.folderRepo.find({
      where: { name: ILike(`%${keyword}%`) },
      relations: ['parent', 'owner'],
      take: 10,
    });

    // =========================
    // SEARCH FILE (globally, not just within accessible folders)
    // =========================
    const files = await this.fileRepo
      .createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('folder.owner', 'owner')
      .where('file.name ILIKE :keyword', { keyword: `%${keyword}%` })
      .andWhere('file.deleted_at IS NULL')
      .take(10)
      .getMany();

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
        hasAccess: isAdmin || accessibleFolderIds!.has(folder.id),
        requestStatus: folderRequestsMap.get(folder.id) || null,
      })),

      files: files.map(file => ({
        id: file.id,
        name: file.name,
        type: 'file',
        parent: file.folder?.name,
        owner: file.folder?.owner?.name,
        hasAccess: isAdmin || accessibleFolderIds!.has(file.folder_id),
        requestStatus: fileRequestsMap.get(file.id) || null,
      })),
    };
  }
}