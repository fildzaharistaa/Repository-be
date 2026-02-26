import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class AccessRequestsService {

  constructor(
    @InjectRepository(AccessRequest)
    private accessRequestRepo: Repository<AccessRequest>,

    @InjectRepository(Folder)
    private folderRepo: Repository<Folder>,
  ) {}

  async requestAccess(userId: string, folderId: string) {

    const folder = await this.folderRepo.findOne({
      where: { id: folderId },
      relations: ['owner'],
    });

    console.log('Folder found:', folder);
    console.log('Folder owner:', folder?.owner);
    console.log('Owner ID:', folder?.owner?.id);

    if (!folder) {
      throw new Error('Folder not found');
    }

    const request = this.accessRequestRepo.create({
      requester: { id: userId } as User,
      folder: { id: folderId } as Folder,
      owner: folder.owner,
      status: 'pending',
    });

    return this.accessRequestRepo.save(request);
  }

}