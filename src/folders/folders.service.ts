import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Folder, FolderPermission, User } from '../entities';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

export interface FolderTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
  children?: FolderTreeNode[];
}

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(FolderPermission)
    private permissionRepository: Repository<FolderPermission>,
  ) {}

  async create(createFolderDto: CreateFolderDto, userId: string): Promise<Folder> {
    if (createFolderDto.parent_id) {
      const parent = await this.folderRepository.findOne({
        where: { id: createFolderDto.parent_id },
      });

      if (!parent) {
        throw new NotFoundException('Parent folder not found');
      }
    }

    const folder = this.folderRepository.create({
      ...createFolderDto,
      owner: {id: userId} as User,
    });

    return this.folderRepository.save(folder);
  }

  async findOne(id: string): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
      relations: ['parent', 'children'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }

  async findAllAccessible(user: User): Promise<Folder[]> {
    const accessibleFolderIds = await this.getAccessibleFolderIds(user);
    
    if (accessibleFolderIds.length === 0) {
      return [];
    }

    return this.folderRepository.find({
      where: { id: In(accessibleFolderIds) },
      relations: ['parent'],
      order: { name: 'ASC' },
    });
  }

  async findAllForAdmin(): Promise<Folder[]> {
    return this.folderRepository.find({
      where: { deleted_at: IsNull() },
      relations: ['parent'],
      order: { name: 'ASC' },
    });
  }

  async getTreeForAdmin(): Promise<FolderTreeNode[]> {
    const folders = await this.folderRepository.find({
      where: { deleted_at: IsNull() },
      order: { name: 'ASC' },
    });

    // Build tree structure
    const folderMap = new Map<string, FolderTreeNode>();
    const rootFolders: FolderTreeNode[] = [];

    // First pass: create all nodes
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        children: [],
      });
    });

    // Second pass: build parent-child relationships
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  async getTree(user: User): Promise<FolderTreeNode[]> {
    const accessibleFolderIds = await this.getAccessibleFolderIds(user);

    if (accessibleFolderIds.length === 0) {
      return [];
    }

    // Get all accessible folders
    const folders = await this.folderRepository.find({
      where: { id: In(accessibleFolderIds) },
      order: { name: 'ASC' },
    });

    // Build tree structure
    const folderMap = new Map<string, FolderTreeNode>();
    const rootFolders: FolderTreeNode[] = [];

    // First pass: create all nodes
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        children: [],
      });
    });

    // Second pass: build parent-child relationships
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        const parent = folderMap.get(folder.parent_id)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }

  async update(id: string, updateFolderDto: UpdateFolderDto): Promise<Folder> {
    const folder = await this.findOne(id);
    Object.assign(folder, updateFolderDto);
    return this.folderRepository.save(folder);
  }

  async remove(id: string): Promise<void> {
    const folder = await this.findOne(id);
    await this.folderRepository.softRemove(folder);
  }

  private async getAccessibleFolderIds(user: User): Promise<string[]> {
    const now = new Date();

    // Get folder IDs where user has read permission (direct or via role)
    const permissions = await this.permissionRepository
      .createQueryBuilder('fp')
      .select('fp.folder_id', 'folder_id')
      .where('fp.can_read = :canRead', { canRead: true })
      .andWhere(
        '(fp.user_id = :userId OR fp.role_id = :roleId)',
        { userId: user.id, roleId: user.role_id },
      )
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getRawMany();

    return permissions.map((p) => p.folder_id);
  }

  async checkPermission(
    userId: string,
    roleId: string,
    folderId: string,
    permissionType: 'read' | 'create' | 'update' | 'delete',
  ): Promise<boolean> {
    const now = new Date();

    const permission = await this.permissionRepository
      .createQueryBuilder('fp')
      .where('fp.folder_id = :folderId', { folderId })
      .andWhere(
        '(fp.user_id = :userId OR fp.role_id = :roleId)',
        { userId, roleId },
      )
      .andWhere('(fp.expires_at IS NULL OR fp.expires_at > :now)', { now })
      .getOne();

    if (!permission) {
      return false;
    }

    switch (permissionType) {
      case 'read':
        return permission.can_read;
      case 'create':
        return permission.can_create;
      case 'update':
        return permission.can_update;
      case 'delete':
        return permission.can_delete;
      default:
        return false;
    }
  }
}

