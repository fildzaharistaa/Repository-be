import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { system_settings } from '@prisma/client';

const MIN_FOLDER_DEPTH = 5;
const MAX_STORAGE_PER_USER = 104857600; // 100 MB in bytes
const DEFAULT_MAX_UPLOAD_SIZE = 5242880; // 5 MB in bytes

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async seedDefaults(): Promise<void> {
    const defaults: { key: string; value: string }[] = [
      { key: 'max_folder_depth', value: String(MIN_FOLDER_DEPTH) },
      { key: 'max_storage_per_user', value: String(MAX_STORAGE_PER_USER) },
      { key: 'max_upload_size', value: String(DEFAULT_MAX_UPLOAD_SIZE) },
    ];

    for (const d of defaults) {
      await this.prisma.system_settings.upsert({
        where: { key: d.key },
        create: { key: d.key, value: d.value },
        update: {},
      });
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.prisma.system_settings.findMany();
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.system_settings.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async update(key: string, value: string): Promise<system_settings> {
    if (key === 'max_folder_depth') {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue) || numValue < MIN_FOLDER_DEPTH) {
        throw new BadRequestException(
          `Max folder depth tidak boleh kurang dari ${MIN_FOLDER_DEPTH}`,
        );
      }
    }

    if (key === 'max_upload_size') {
      const numValue = parseInt(value, 10);
      const MIN_BYTES = 1 * 1024 * 1024;   // 1 MB
      const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
      if (isNaN(numValue) || numValue < MIN_BYTES || numValue > MAX_BYTES) {
        throw new BadRequestException('Max upload size harus antara 1 MB dan 500 MB');
      }
    }

    const setting = await this.prisma.system_settings.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    if (key === 'max_folder_depth') {
      await this.prisma.users.updateMany({ data: { max_folder_depth: null } });
      await this.prisma.roles.updateMany({ data: { max_folder_depth: null } });
    }

    return setting;
  }

  async getMaxFolderDepth(): Promise<number> {
    const val = await this.get('max_folder_depth');
    return val ? parseInt(val, 10) : MIN_FOLDER_DEPTH;
  }

  async getMaxStoragePerUser(): Promise<number> {
    const val = await this.get('max_storage_per_user');
    return val ? parseInt(val, 10) : MAX_STORAGE_PER_USER;
  }

  async getMaxUploadSize(): Promise<number> {
    const val = await this.get('max_upload_size');
    return val ? parseInt(val, 10) : DEFAULT_MAX_UPLOAD_SIZE;
  }
}
