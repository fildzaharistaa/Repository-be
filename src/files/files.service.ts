import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File, Folder, User, SystemSetting, AccessRequest } from '../entities';
import { FoldersService } from '../folders/folders.service';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
    private foldersService: FoldersService,
  ) {}

  private async getMaxStoragePerUser(): Promise<number> {
    const setting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    return setting ? parseInt(setting.value, 10) : 104857600; // default 100MB
  }

  private async getUserStorageUsed(userId: string): Promise<number> {
    const result = await this.fileRepository
      .createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .select('SUM(file.size)', 'totalSize')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .getRawOne();
    return parseInt(result?.totalSize || '0');
  }

  async create(
    file: Express.Multer.File,
    folderId: string,
    user: User,
  ): Promise<File> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    // Check permission
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      folderId,
      'create',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have create permission for this folder',
      );
    }

    // Validate per-user storage limit
    const maxStorage = await this.getMaxStoragePerUser();
    const currentUsage = await this.getUserStorageUsed(user.id);
    if (currentUsage + file.size > maxStorage) {
      const maxMB = (maxStorage / (1024 * 1024)).toFixed(0);
      const usedMB = (currentUsage / (1024 * 1024)).toFixed(2);
      throw new ForbiddenException(
        `Storage penuh! Anda sudah menggunakan ${usedMB} MB dari ${maxMB} MB. File ini (${(file.size / (1024 * 1024)).toFixed(2)} MB) melebihi batas storage.`,
      );
    }

    const fileEntity = this.fileRepository.create({
      name: file.originalname,
      path: file.path,
      mime_type: file.mimetype,
      size: file.size,
      folder_id: folderId,
    });

    return this.fileRepository.save(fileEntity);
  }

  async findAll(folderId: string, user: User): Promise<File[]> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    // Check permission
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      folderId,
      'read',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have read permission for this folder',
      );
    }

    return this.fileRepository.find({
      where: { folder_id: folderId },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check permission on parent folder
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'read',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have read permission for this file',
      );
    }

    return file;
  }

  async checkPreviewPermission(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check read permission on parent folder (view-only is enough for preview)
    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'read',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest (can_read is enough)
      const filePerm = await this.fileRepository.manager.findOne(AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_read: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to preview this file',
      );
    }

    return file;
  }

  async checkDownloadPermission(id: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'download',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest
      const filePerm = await this.fileRepository.manager.findOne(require('../access-requests/access-request.entity').AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_download: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have download permission for this file',
      );
    }

    return file;
  }

  async rename(id: string, name: string, user: User): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check update permission on parent folder
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'update',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have update permission for this file',
      );
    }

    file.name = name;
    return this.fileRepository.save(file);
  }

  async remove(id: string, user: User): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['folder'],
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check permission
    let hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'delete',
    );

    if (!hasPermission) {
      // Check file-level permission via AccessRequest
      const filePerm = await this.fileRepository.manager.findOne(require('../access-requests/access-request.entity').AccessRequest, {
        where: {
          requester: { id: user.id },
          file: { id: file.id },
          status: 'approved',
          can_delete: true,
        },
      });
      if (filePerm) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have delete permission for this file',
      );
    }

    await this.fileRepository.softRemove(file);
  }
}

