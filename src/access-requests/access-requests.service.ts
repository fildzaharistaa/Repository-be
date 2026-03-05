import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { FolderPermission } from '../entities/folder-permission.entity';

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
  ) {}

  // =============================
  // USER REQUEST ACCESS
  // =============================
  async requestAccess(
    userId: string,
    folderId?: string,
    fileId?: string
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
        status: 'pending'
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
        status: 'pending'
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
    permissions: any
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

    request.status = 'approved';
    await this.accessRequestRepo.save(request);

    if (request.folder) {

      await this.folderPermissionRepo.save({
        user: request.requester,
        folder: request.folder,
        can_read: permissions?.can_read ?? true,
        can_download: permissions?.can_download ?? false,
        can_create: permissions?.can_create ?? false,
        can_update: permissions?.can_update ?? false,
        can_delete: permissions?.can_delete ?? false,
      });

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
    ownerId: string
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

    return this.accessRequestRepo.save(request);
  }

}