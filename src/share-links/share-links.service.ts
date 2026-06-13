import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { ShareLink } from './share-link.entity';
import { GenerateShareLinkDto } from './dto/generate-share-link.dto';
import { UpdateShareLinkDto } from './dto/update-share-link.dto';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class ShareLinksService {
  constructor(
    @InjectRepository(ShareLink)
    private shareLinkRepo: Repository<ShareLink>,
    @InjectRepository(File)
    private fileRepo: Repository<File>,
    @InjectRepository(Folder)
    private folderRepo: Repository<Folder>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async generate(userId: string, dto: GenerateShareLinkDto): Promise<ShareLink> {
    // Verify the item exists and user owns it or is admin
    await this.verifyItemOwnership(userId, dto.type, dto.id);

    // Deactivate any existing active share link for this item by this user
    await this.shareLinkRepo.update(
      { created_by: userId, item_type: dto.type, item_id: dto.id, is_active: true },
      { is_active: false },
    );

    const link = this.shareLinkRepo.create({
      token: this.generateToken(),
      item_type: dto.type,
      item_id: dto.id,
      created_by: userId,
      access_level: dto.access_level ?? 'anyone',
      permission: dto.permission ?? 'view',
      expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
      is_active: true,
      view_count: 0,
      download_count: 0,
    });

    return this.shareLinkRepo.save(link);
  }

  async getByToken(token: string): Promise<{
    link: ShareLink;
    itemName: string;
    itemSize?: number;
    sharedBy: string;
    sharedByEmail: string;
  }> {
    const link = await this.shareLinkRepo.findOne({
      where: { token },
      relations: ['creator'],
    });

    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }

    // Increment view count
    await this.shareLinkRepo.increment({ id: link.id }, 'view_count', 1);
    link.view_count += 1;

    let itemName = '';
    let itemSize: number | undefined;

    if (link.item_type === 'file') {
      const file = await this.fileRepo.findOne({ where: { id: link.item_id } });
      if (!file) throw new NotFoundException('File tidak ditemukan');
      itemName = file.name;
      itemSize = file.size;
    } else {
      const folder = await this.folderRepo.findOne({ where: { id: link.item_id } });
      if (!folder) throw new NotFoundException('Folder tidak ditemukan');
      itemName = folder.name;
    }

    return {
      link,
      itemName,
      itemSize,
      sharedBy: link.creator?.name ?? 'Unknown',
      sharedByEmail: link.creator?.email ?? '',
    };
  }

  async getExistingLink(userId: string, type: 'file' | 'folder', itemId: string): Promise<ShareLink | null> {
    return this.shareLinkRepo.findOne({
      where: { created_by: userId, item_type: type, item_id: itemId, is_active: true },
      relations: ['creator'],
    });
  }

  async getFileForDownload(token: string): Promise<{ file: File; link: ShareLink }> {
    const link = await this.shareLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }
    if (link.item_type !== 'file') throw new ForbiddenException('Link ini bukan untuk file');

    if (link.permission !== 'download') {
      throw new ForbiddenException('Link ini tidak mengizinkan download');
    }

    const file = await this.fileRepo.findOne({ where: { id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    await this.shareLinkRepo.increment({ id: link.id }, 'download_count', 1);

    return { file, link };
  }

  async getFileForView(token: string): Promise<{ file: File; link: ShareLink }> {
    const link = await this.shareLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }
    if (link.item_type !== 'file') throw new ForbiddenException('Link ini bukan untuk file');

    const file = await this.fileRepo.findOne({ where: { id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    return { file, link };
  }

  async update(token: string, userId: string, dto: UpdateShareLinkDto, isAdmin: boolean): Promise<ShareLink> {
    const link = await this.shareLinkRepo.findOne({
      where: { token },
      relations: ['creator'],
    });

    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak mengubah link ini');
    }

    if (dto.access_level !== undefined) link.access_level = dto.access_level;
    if (dto.permission !== undefined) link.permission = dto.permission;
    if (dto.expires_at !== undefined) link.expires_at = dto.expires_at ? new Date(dto.expires_at) : null;
    if (dto.is_active !== undefined) link.is_active = dto.is_active;

    return this.shareLinkRepo.save(link);
  }

  async disable(token: string, userId: string, isAdmin: boolean): Promise<{ message: string }> {
    const link = await this.shareLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak menonaktifkan link ini');
    }

    link.is_active = false;
    await this.shareLinkRepo.save(link);
    return { message: 'Share link berhasil dinonaktifkan' };
  }

  async generateNew(token: string, userId: string, isAdmin: boolean): Promise<ShareLink> {
    const link = await this.shareLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak mengubah link ini');
    }

    link.token = this.generateToken();
    link.is_active = true;
    link.view_count = 0;
    link.download_count = 0;
    return this.shareLinkRepo.save(link);
  }

  async getStats(token: string, userId: string, isAdmin: boolean): Promise<{ view_count: number; download_count: number }> {
    const link = await this.shareLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak melihat statistik link ini');
    }

    return { view_count: link.view_count, download_count: link.download_count };
  }

  // Get all share links created by user (for Shared views)
  async getMySharedLinks(userId: string): Promise<ShareLink[]> {
    return this.shareLinkRepo.find({
      where: { created_by: userId, is_active: true },
      relations: ['creator'],
      order: { created_at: 'DESC' },
    });
  }

  private async verifyItemOwnership(userId: string, type: 'file' | 'folder', itemId: string): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['role'],
    });

    const isAdmin = user?.role?.is_admin === true;
    if (isAdmin) return;

    if (type === 'file') {
      const file = await this.fileRepo.findOne({ where: { id: itemId } });
      if (!file) throw new NotFoundException('File tidak ditemukan');
      // Allow any authenticated user to share files they can see
    } else {
      const folder = await this.folderRepo.findOne({ where: { id: itemId } });
      if (!folder) throw new NotFoundException('Folder tidak ditemukan');
    }
  }
}
