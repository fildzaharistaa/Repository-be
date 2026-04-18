import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting, User, Role } from '../entities';

const MIN_FOLDER_DEPTH = 5;
const MAX_STORAGE_PER_USER = 104857600; // 100 MB in bytes

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private settingRepo: Repository<SystemSetting>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
  ) {}

  /**
   * Seed default settings if they don't exist yet
   */
  async seedDefaults(): Promise<void> {
    const defaults: { key: string; value: string }[] = [
      { key: 'max_folder_depth', value: String(MIN_FOLDER_DEPTH) },
      { key: 'max_storage_per_user', value: String(MAX_STORAGE_PER_USER) },
    ];

    for (const d of defaults) {
      const existing = await this.settingRepo.findOne({ where: { key: d.key } });
      if (!existing) {
        await this.settingRepo.save(d);
      }
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.settingRepo.find();
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    const setting = await this.settingRepo.findOne({ where: { key } });
    return setting?.value ?? null;
  }

  async update(key: string, value: string): Promise<SystemSetting> {
    // Validate max_folder_depth: cannot go below MIN_FOLDER_DEPTH
    if (key === 'max_folder_depth') {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue) || numValue < MIN_FOLDER_DEPTH) {
        throw new BadRequestException(
          `Max folder depth tidak boleh kurang dari ${MIN_FOLDER_DEPTH}`,
        );
      }
    }

    let setting = await this.settingRepo.findOne({ where: { key } });
    if (!setting) {
      setting = this.settingRepo.create({ key, value });
    } else {
      setting.value = value;
    }
    await this.settingRepo.save(setting);

    // If we updated global depth, reset all per-user and per-role overrides
    if (key === 'max_folder_depth') {
      await this.userRepo.query('UPDATE users SET max_folder_depth = NULL');
      await this.roleRepo.query('UPDATE roles SET max_folder_depth = NULL');
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
}
