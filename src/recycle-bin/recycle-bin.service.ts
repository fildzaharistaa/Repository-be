import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { FolderPermission } from '../entities/folder-permission.entity';
import { AccessRequest } from '../access-requests/access-request.entity';

@Injectable()
export class RecycleBinService {
  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(FolderPermission)
    private folderPermissionRepository: Repository<FolderPermission>,
    @InjectRepository(AccessRequest)
    private accessRequestRepository: Repository<AccessRequest>,
  ) {}

  /**
   * Get all trashed items (top-level only).
   * For folders: only show folders whose parent is NOT also deleted.
   * For files: only show files whose parent folder is NOT deleted.
   */
  async findAllTrashed(userId: string, isAdmin: boolean) {
    // Get all soft-deleted files
    const allDeletedFiles = await this.fileRepository.find({
      withDeleted: true,
      where: { deleted_at: Not(IsNull()) },
      relations: ['folder'],
      order: { deleted_at: 'DESC' },
    });

    // Get all soft-deleted folders
    const allDeletedFolders = await this.folderRepository.find({
      withDeleted: true,
      where: { deleted_at: Not(IsNull()) },
      order: { deleted_at: 'DESC' },
    });

    const deletedFolderIds = new Set(allDeletedFolders.map(f => f.id));

    // Top-level deleted folders: parent is not also deleted
    const topLevelFolders = allDeletedFolders.filter(folder => {
      if (!folder.parent_id) return true;
      return !deletedFolderIds.has(folder.parent_id);
    });

    // Top-level deleted files: parent folder is NOT deleted
    const topLevelFiles = allDeletedFiles.filter(file => {
      return !deletedFolderIds.has(file.folder_id);
    });

    return {
      folders: topLevelFolders.map(f => ({
        id: f.id,
        name: f.name,
        type: 'folder' as const,
        deleted_at: f.deleted_at,
        parent_id: f.parent_id,
      })),
      files: topLevelFiles.map(f => ({
        id: f.id,
        name: f.name,
        type: 'file' as const,
        mime_type: f.mime_type,
        size: f.size,
        deleted_at: f.deleted_at,
        folder_id: f.folder_id,
      })),
    };
  }

  /**
   * Restore a file from recycle bin
   */
  async restoreFile(id: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      withDeleted: true,
      where: { id, deleted_at: Not(IsNull()) },
    });

    if (!file) {
      throw new NotFoundException('Deleted file not found');
    }

    await this.fileRepository.recover(file);
  }

  /**
   * Restore a folder and all its children (subfolders + files) recursively
   */
  async restoreFolder(id: string): Promise<void> {
    const folder = await this.folderRepository.findOne({
      withDeleted: true,
      where: { id, deleted_at: Not(IsNull()) },
    });

    if (!folder) {
      throw new NotFoundException('Deleted folder not found');
    }

    // Restore the folder first
    await this.folderRepository.recover(folder);

    // Cascading restore: restore all files in this folder
    const deletedFiles = await this.fileRepository.find({
      withDeleted: true,
      where: { folder_id: id, deleted_at: Not(IsNull()) },
    });
    if (deletedFiles.length > 0) {
      await this.fileRepository.recover(deletedFiles);
    }

    // Cascading restore: restore all child folders recursively
    const deletedChildren = await this.folderRepository.find({
      withDeleted: true,
      where: { parent_id: id, deleted_at: Not(IsNull()) },
    });
    for (const child of deletedChildren) {
      await this.restoreFolder(child.id);
    }
  }

  /**
   * Permanently delete a file
   */
  async permanentDeleteFile(id: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      withDeleted: true,
      where: { id, deleted_at: Not(IsNull()) },
    });

    if (!file) {
      throw new NotFoundException('Deleted file not found');
    }

    // Clean up dependent foreign-key records first
    await this.accessRequestRepository.delete({ file: { id } });

    await this.fileRepository.remove(file);
  }

  /**
   * Permanently delete a folder and all its children recursively
   */
  async permanentDeleteFolder(id: string): Promise<void> {
    const folder = await this.folderRepository.findOne({
      withDeleted: true,
      where: { id, deleted_at: Not(IsNull()) },
    });

    if (!folder) {
      throw new NotFoundException('Deleted folder not found');
    }

    // Cascade: permanently delete all files in this folder
    const files = await this.fileRepository.find({
      withDeleted: true,
      where: { folder_id: id },
    });
    if (files.length > 0) {
      for (const f of files) {
        await this.accessRequestRepository.delete({ file: { id: f.id } });
      }
      await this.fileRepository.remove(files);
    }

    // Cascade: permanently delete all child folders recursively
    const children = await this.folderRepository.find({
      withDeleted: true,
      where: { parent_id: id },
    });
    for (const child of children) {
      await this.permanentDeleteFolder(child.id);
    }

    // Clean up dependent foreign-key records for this folder
    await this.accessRequestRepository.delete({ folder: { id } });
    await this.folderPermissionRepository.delete({ folder_id: id });

    // Finally delete the folder itself
    await this.folderRepository.remove(folder);
  }
}
