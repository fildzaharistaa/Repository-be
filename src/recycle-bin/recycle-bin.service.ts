import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecycleBinService {
  constructor(private prisma: PrismaService) {}

  async findAllTrashed(userId: string, isAdmin: boolean) {
    const ownerFilter = isAdmin ? {} : { owner_id: userId };

    const allDeletedFiles = await this.prisma.files.findMany({
      where: { ...ownerFilter, deleted_at: { not: null } },
      include: { folders: true },
      orderBy: { deleted_at: 'desc' },
    });

    const allDeletedFolders = await this.prisma.folders.findMany({
      where: { ...ownerFilter, deleted_at: { not: null } },
      orderBy: { deleted_at: 'desc' },
    });

    const deletedFolderIds = new Set(allDeletedFolders.map((f) => f.id));

    const topLevelFolders = allDeletedFolders.filter((folder) => {
      if (!folder.parent_id) return true;
      return !deletedFolderIds.has(folder.parent_id);
    });

    const topLevelFiles = allDeletedFiles.filter((file) => {
      return !deletedFolderIds.has(file.folder_id);
    });

    return {
      folders: topLevelFolders.map((f) => ({
        id: f.id,
        name: f.name,
        type: 'folder' as const,
        deleted_at: f.deleted_at,
        parent_id: f.parent_id,
      })),
      files: topLevelFiles.map((f) => ({
        id: f.id,
        name: f.name,
        type: 'file' as const,
        mime_type: f.mime_type,
        size: Number(f.size),
        deleted_at: f.deleted_at,
        folder_id: f.folder_id,
      })),
    };
  }

  async restoreFile(id: string): Promise<void> {
    const file = await this.prisma.files.findFirst({
      where: { id, deleted_at: { not: null } },
    });

    if (!file) throw new NotFoundException('Deleted file not found');

    await this.prisma.files.update({
      where: { id },
      data: { deleted_at: null },
    });
  }

  async restoreFolder(id: string): Promise<void> {
    const folder = await this.prisma.folders.findFirst({
      where: { id, deleted_at: { not: null } },
    });

    if (!folder) throw new NotFoundException('Deleted folder not found');

    await this.prisma.folders.update({
      where: { id },
      data: { deleted_at: null },
    });

    await this.prisma.files.updateMany({
      where: { folder_id: id, deleted_at: { not: null } },
      data: { deleted_at: null },
    });

    const deletedChildren = await this.prisma.folders.findMany({
      where: { parent_id: id, deleted_at: { not: null } },
    });
    for (const child of deletedChildren) {
      await this.restoreFolder(child.id);
    }
  }

  async permanentDeleteFile(id: string): Promise<void> {
    const file = await this.prisma.files.findFirst({
      where: { id, deleted_at: { not: null } },
    });

    if (!file) throw new NotFoundException('Deleted file not found');

    await this.prisma.access_requests.deleteMany({ where: { fileId: id } });
    await this.prisma.files.delete({ where: { id } });
  }

  async permanentDeleteFolder(id: string): Promise<void> {
    const folder = await this.prisma.folders.findFirst({
      where: { id, deleted_at: { not: null } },
    });

    if (!folder) throw new NotFoundException('Deleted folder not found');

    const files = await this.prisma.files.findMany({ where: { folder_id: id } });
    if (files.length > 0) {
      for (const f of files) {
        await this.prisma.access_requests.deleteMany({ where: { fileId: f.id } });
      }
      await this.prisma.files.deleteMany({ where: { folder_id: id } });
    }

    const children = await this.prisma.folders.findMany({ where: { parent_id: id } });
    for (const child of children) {
      await this.permanentDeleteFolder(child.id);
    }

    await this.prisma.access_requests.deleteMany({ where: { folderId: id } });
    await this.prisma.folder_permissions.deleteMany({ where: { folder_id: id } });
    await this.prisma.folders.delete({ where: { id } });
  }
}
