import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class IntegrationService {
  private readonly secret: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(File) private readonly fileRepo: Repository<File>,
    @InjectRepository(Folder) private readonly folderRepo: Repository<Folder>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    this.secret = this.configService.get<string>('INTEGRATION_SECRET') ?? '';
  }

  verifySecret(secret: string) {
    if (!this.secret || secret !== this.secret) {
      throw new UnauthorizedException('Invalid integration secret');
    }
  }

  private fmt(f: File) {
    return {
      id: f.id,
      name: f.name,
      mime_type: f.mime_type,
      size: Number(f.size),
      folder_id: f.folder_id,
      created_at: f.created_at,
      owner: f.owner ? { email: f.owner.email, name: f.owner.name } : null,
    };
  }

  /**
   * Cari file berdasarkan nama folder indikator (nama/kode), filter by owner email.
   */
  async searchFiles(params: { jenis?: string; kode?: string; nama?: string; email?: string }): Promise<any[]> {
    const { nama, kode, email } = params;

    const qb = this.fileRepo
      .createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('file.owner', 'owner')
      .where('file.deleted_at IS NULL');

    // Cari berdasarkan nama folder (nama indikator)
    if (nama) {
      qb.andWhere('folder.name ILIKE :nama', { nama: `%${nama}%` });
    }
    // Atau fallback ke kode jika nama tidak ada
    if (!nama && kode) {
      qb.andWhere('folder.name ILIKE :kode', { kode: `%${kode}%` });
    }
    // Filter by owner email
    if (email) {
      qb.andWhere('LOWER(owner.email) = LOWER(:email)', { email });
    }

    const files = await qb.getMany();
    return files.map((f) => this.fmt(f));
  }

  /**
   * Cari file tanpa filter owner (untuk atasan/admin) — butuh integration secret.
   */
  async searchFilesUnrestricted(params: { jenis?: string; kode?: string; nama?: string }): Promise<any[]> {
    const { nama, kode } = params;

    const qb = this.fileRepo
      .createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .leftJoinAndSelect('file.owner', 'owner')
      .where('file.deleted_at IS NULL');

    if (nama) {
      qb.andWhere('folder.name ILIKE :nama', { nama: `%${nama}%` });
    } else if (kode) {
      qb.andWhere('folder.name ILIKE :kode', { kode: `%${kode}%` });
    }

    const files = await qb.getMany();
    return files.map((f) => this.fmt(f));
  }

  /**
   * Semua folder milik / dapat diakses email tersebut.
   */
  async getFolders(email?: string): Promise<any[]> {
    if (!email) return [];
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return [];

    const folders = await this.folderRepo.find({
      where: { owner_id: user.id },
      select: ['id', 'name', 'parent_id'],
    });

    return folders.map((f) => ({ id: f.id, name: f.name, parent_id: f.parent_id }));
  }

  /**
   * File di dalam folder tertentu, filter by owner email.
   */
  async getFilesInFolder(folderId: string, email?: string): Promise<any[]> {
    const qb = this.fileRepo
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.owner', 'owner')
      .where('file.folder_id = :folderId', { folderId })
      .andWhere('file.deleted_at IS NULL');

    if (email) {
      qb.andWhere('LOWER(owner.email) = LOWER(:email)', { email });
    }

    const files = await qb.getMany();
    return files.map((f) => this.fmt(f));
  }

  /**
   * File di sub-folder langsung di bawah parentFolderId, filter by owner email.
   */
  async getFilesInChildren(parentFolderId: string, email?: string): Promise<any[]> {
    const children = await this.folderRepo.find({ where: { parent_id: parentFolderId } });
    if (children.length === 0) return [];

    const childIds = children.map((c) => c.id);
    const qb = this.fileRepo
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.owner', 'owner')
      .where('file.folder_id IN (:...childIds)', { childIds })
      .andWhere('file.deleted_at IS NULL');

    if (email) {
      qb.andWhere('LOWER(owner.email) = LOWER(:email)', { email });
    }

    const files = await qb.getMany();
    return files.map((f) => this.fmt(f));
  }

  /**
   * Stream file ke response (inline preview atau force-download).
   */
  async serveFile(fileId: string, mode: 'inline' | 'download', res: Response): Promise<void> {
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const filePath = path.resolve(file.path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    const disposition = mode === 'inline' ? 'inline' : `attachment; filename="${encodeURIComponent(file.name)}"`;
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition);
    if (file.size) res.setHeader('Content-Length', file.size.toString());

    fs.createReadStream(filePath).pipe(res);
  }
}
