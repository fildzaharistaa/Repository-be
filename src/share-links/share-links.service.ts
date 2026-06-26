import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateShareLinkDto } from './dto/generate-share-link.dto';
import { UpdateShareLinkDto } from './dto/update-share-link.dto';
import { canShareOrModifyFile } from '../common/utils/file-access';

@Injectable()
export class ShareLinksService {
  constructor(private prisma: PrismaService) {}

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async generate(
    user: any,
    dto: GenerateShareLinkDto,
  ) {
    const userId = user.id;
    await this.verifyItemOwnership(user, dto.type, dto.id);

    await this.prisma.share_links.updateMany({
      where: { created_by: userId, item_type: dto.type, item_id: dto.id, is_active: true },
      data: { is_active: false },
    });

    const token = this.generateToken();
    const saved = await this.prisma.share_links.create({
      data: {
        token,
        item_type: dto.type,
        item_id: dto.id,
        created_by: userId,
        access_level: dto.access_level ?? 'anyone',
        permission: dto.permission ?? 'view',
        expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
        is_active: true,
        view_count: 0,
        download_count: 0,
      },
    });
    return saved;
  }

  async getByToken(token: string): Promise<{
    link: any;
    itemName: string;
    itemSize?: number;
    mimeType?: string;
    sharedBy: string;
    sharedByEmail: string;
  }> {
    const link = await this.prisma.share_links.findUnique({
      where: { token },
      include: { users: true },
    });

    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }

    await this.prisma.share_links.update({
      where: { id: link.id },
      data: { view_count: { increment: 1 } },
    });
    link.view_count += 1;

    let itemName = '';
    let itemSize: number | undefined;
    let mimeType: string | undefined;

    if (link.item_type === 'file') {
      const file = await this.prisma.files.findUnique({ where: { id: link.item_id } });
      if (!file) throw new NotFoundException('File tidak ditemukan');
      itemName = file.name;
      itemSize = Number(file.size);
      mimeType = file.mime_type;
    } else {
      const folder = await this.prisma.folders.findUnique({ where: { id: link.item_id } });
      if (!folder) throw new NotFoundException('Folder tidak ditemukan');
      itemName = folder.name;
    }

    return {
      link,
      itemName,
      itemSize,
      mimeType,
      sharedBy: link.users?.name ?? 'Unknown',
      sharedByEmail: link.users?.email ?? '',
    };
  }

  async getExistingLink(userId: string, type: 'file' | 'folder', itemId: string) {
    return this.prisma.share_links.findFirst({
      where: { created_by: userId, item_type: type, item_id: itemId, is_active: true },
      include: { users: true },
    });
  }

  async getFileForDownload(token: string) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }
    if (link.item_type !== 'file') throw new ForbiddenException('Link ini bukan untuk file');
    if (link.permission !== 'download') {
      throw new ForbiddenException('Link ini tidak mengizinkan download');
    }

    const file = await this.prisma.files.findUnique({ where: { id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    await this.prisma.share_links.update({
      where: { id: link.id },
      data: { download_count: { increment: 1 } },
    });

    return { file, link };
  }

  async getFolderContents(token: string) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) throw new GoneException('Share link telah kadaluarsa');
    if (link.item_type !== 'folder') throw new ForbiddenException('Link ini bukan untuk folder');

    const folder = await this.prisma.folders.findUnique({ where: { id: link.item_id } });
    if (!folder) throw new NotFoundException('Folder tidak ditemukan');

    const files = await this.prisma.files.findMany({
      where: { folder_id: link.item_id, deleted_at: null },
      orderBy: { name: 'asc' },
    });

    return {
      folderName: folder.name,
      permission: link.permission,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: Number(f.size),
        mime_type: f.mime_type,
        created_at: f.created_at,
      })),
    };
  }

  async getFolderFileForView(token: string, fileId: string) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) throw new GoneException('Share link telah kadaluarsa');
    if (link.item_type !== 'folder') throw new ForbiddenException('Link ini bukan untuk folder');

    const file = await this.prisma.files.findFirst({ where: { id: fileId, folder_id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan dalam folder ini');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    return { file };
  }

  async getFolderFileForDownload(token: string, fileId: string) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) throw new GoneException('Share link telah kadaluarsa');
    if (link.item_type !== 'folder') throw new ForbiddenException('Link ini bukan untuk folder');
    if (link.permission !== 'download') throw new ForbiddenException('Link ini tidak mengizinkan download');

    const file = await this.prisma.files.findFirst({ where: { id: fileId, folder_id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan dalam folder ini');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    return { file };
  }

  async getFileForView(token: string) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (!link.is_active) throw new GoneException('Share link telah dinonaktifkan');
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new GoneException('Share link telah kadaluarsa');
    }
    if (link.item_type !== 'file') throw new ForbiddenException('Link ini bukan untuk file');

    const file = await this.prisma.files.findUnique({ where: { id: link.item_id } });
    if (!file) throw new NotFoundException('File tidak ditemukan');
    if (!fs.existsSync(file.path)) throw new NotFoundException('File tidak ada di disk');

    return { file, link };
  }

  async update(token: string, userId: string, dto: UpdateShareLinkDto, isAdmin: boolean) {
    const link = await this.prisma.share_links.findUnique({
      where: { token },
      include: { users: true },
    });

    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak mengubah link ini');
    }

    return this.prisma.share_links.update({
      where: { id: link.id },
      data: {
        ...(dto.access_level !== undefined ? { access_level: dto.access_level } : {}),
        ...(dto.permission !== undefined ? { permission: dto.permission } : {}),
        ...(dto.expires_at !== undefined ? { expires_at: dto.expires_at ? new Date(dto.expires_at) : null } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      },
    });
  }

  async disable(token: string, userId: string, isAdmin: boolean): Promise<{ message: string }> {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak menonaktifkan link ini');
    }

    await this.prisma.share_links.update({
      where: { id: link.id },
      data: { is_active: false },
    });
    return { message: 'Share link berhasil dinonaktifkan' };
  }

  async generateNew(token: string, userId: string, isAdmin: boolean) {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak mengubah link ini');
    }

    return this.prisma.share_links.update({
      where: { id: link.id },
      data: {
        token: this.generateToken(),
        is_active: true,
        view_count: 0,
        download_count: 0,
      },
    });
  }

  async getStats(token: string, userId: string, isAdmin: boolean): Promise<{ view_count: number; download_count: number }> {
    const link = await this.prisma.share_links.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link tidak ditemukan');
    if (link.created_by !== userId && !isAdmin) {
      throw new ForbiddenException('Anda tidak berhak melihat statistik link ini');
    }

    return { view_count: link.view_count, download_count: link.download_count };
  }

  async getMySharedLinks(userId: string) {
    return this.prisma.share_links.findMany({
      where: { created_by: userId, is_active: true },
      include: { users: true },
      orderBy: { created_at: 'desc' },
    });
  }

  private async verifyItemOwnership(
    requester: any,
    type: 'file' | 'folder',
    itemId: string,
  ): Promise<void> {
    let user: any = requester;
    if (!user?.role && !user?.roles) {
      const dbUser = await this.prisma.users.findUnique({
        where: { id: requester.id },
        include: { roles: true },
      });
      if (dbUser) {
        (dbUser as any).role = dbUser.roles;
        user = dbUser;
        (user as any).active_role_id = (requester as any).active_role_id ?? dbUser.role_id;
        (user as any).active_role_name = (requester as any).active_role_name;
      }
    }

    const effectiveRole = user?.role ?? user?.roles ?? null;
    if ((effectiveRole as any)?.is_admin === true) return;

    if (type === 'folder') {
      const folder = await this.prisma.folders.findUnique({ where: { id: itemId } });
      if (!folder) throw new NotFoundException('Folder tidak ditemukan');
      if (folder.owner_id !== user.id) {
        throw new ForbiddenException('Hanya pemilik folder yang dapat membuat share link folder');
      }
      return;
    }

    const file = await this.prisma.files.findUnique({
      where: { id: itemId },
      include: { folders: { include: { users: true } }, roles: true },
    });
    if (!file) throw new NotFoundException('File tidak ditemukan');

    const fileLike = {
      id: file.id,
      owner_id: file.owner_id,
      folder_id: file.folder_id,
      uploaded_by_role_id: file.uploaded_by_role_id,
      folder: file.folders ? { owner_id: file.folders.owner_id, role_id: file.folders.role_id } : null,
      uploaded_by_role: file.roles ? { name: file.roles.name } : null,
    };

    const allowed = await canShareOrModifyFile(fileLike, user, {
      findRole: (id) => this.prisma.roles.findUnique({ where: { id } }),
    });
    if (!allowed) {
      throw new ForbiddenException('Anda tidak berhak membuat link untuk file ini');
    }
  }
}
