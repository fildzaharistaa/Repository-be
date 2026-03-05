import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';

@Injectable()
export class SearchService {

  constructor(
    @InjectRepository(Folder)
    private folderRepo: Repository<Folder>,

    @InjectRepository(File)
    private fileRepo: Repository<File>,
  ) {}

  async globalSearch(keyword: string, userId: string) {

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

    return {
      folders: folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parent: folder.parent?.name ?? 'Repository',
        owner: folder.owner?.name
      })),

      files: files.map(file => ({
        id: file.id,
        name: file.name,
        type: 'file',
        parent: file.folder?.name,
        owner: file.folder?.owner?.name
      }))
    };
  }
}