import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File, Folder, User } from '../entities';
import { FoldersService } from '../folders/folders.service';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    private foldersService: FoldersService,
  ) {}

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
    const hasPermission = await this.foldersService.checkPermission(
      user.id,
      user.role_id,
      file.folder_id,
      'delete',
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have delete permission for this file',
      );
    }

    await this.fileRepository.softRemove(file);
  }
}

