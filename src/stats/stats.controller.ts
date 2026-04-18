import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Role, User, Folder, File, SystemSetting } from '../entities';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  @Get('super-admin')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getSuperAdminStats() {
    // Total roles
    const totalRoles = await this.roleRepository.count();

    // Total folders (not deleted)
    const totalFolders = await this.folderRepository.count({
      where: { deleted_at: IsNull() },
    });

    // Total files (not deleted)
    const totalFiles = await this.fileRepository.count({
      where: { deleted_at: IsNull() },
    });

    // Folders per unit
    const foldersPerUnit = await this.folderRepository
      .createQueryBuilder('folder')
      .select('folder.unit', 'unit')
      .addSelect('COUNT(*)', 'count')
      .where('folder.deleted_at IS NULL')
      .groupBy('folder.unit')
      .getRawMany();

    // Users per role
    const usersPerRole = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.role', 'role')
      .select('role.name', 'roleName')
      .addSelect('COUNT(*)', 'count')
      .groupBy('role.name')
      .getRawMany();

    // Recent activity
    // 1. Folders
    const recentFolders = await this.folderRepository.find({
      where: { deleted_at: IsNull() },
      order: { created_at: 'DESC' },
      take: 15,
      relations: ['owner'],
    });

    // 2. Files
    const recentFiles = await this.fileRepository.find({
      where: { deleted_at: IsNull() },
      order: { created_at: 'DESC' },
      take: 15,
      relations: ['folder', 'folder.owner'],
    });

    // 3. User creations/updates (Super Admin activity)
    // We assume if a user's updated_at is recent, it's either an update or creation
    const recentUsers = await this.userRepository.find({
      order: { updated_at: 'DESC' },
      take: 15,
      relations: ['role'],
    });

    // Combine and sort recent activity
    const recentActivity = [
      ...recentFolders.map((f) => ({
        timestamp: f.created_at,
        user: f.owner?.email || 'System',
        action: `Create Folder "${f.name}"`,
        type: 'user', // regular user activity
      })),
      ...recentFiles.map((f) => ({
        timestamp: f.created_at,
        user: f.folder?.owner?.email || 'System',
        action: `Upload File "${f.name}"`,
        type: 'user', // regular user activity
      })),
      ...recentUsers.map((u) => {
        // If created_at and updated_at are very close (< 2 seconds), it's a creation
        const isNew = new Date(u.updated_at).getTime() - new Date(u.created_at).getTime() < 2000;
        return {
          timestamp: u.updated_at,
          user: 'Super Admin',
          action: isNew ? `Create User "${u.name}"` : `Update User "${u.name}"`,
          type: 'superadmin', // super admin activity
        };
      }),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30); // Take top 30 items for Hari Ini / Sebelumnya grouping

    // Total storage size
    const storageResult = await this.fileRepository
      .createQueryBuilder('file')
      .select('SUM(file.size)', 'totalSize')
      .where('file.deleted_at IS NULL')
      .getRawOne();
    
    const totalSize = parseInt(storageResult?.totalSize || '0');

    // Get system settings
    const maxDepthSetting = await this.settingRepository.findOne({ where: { key: 'max_folder_depth' } });
    const maxStorageSetting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    const maxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;

    return {
      totalRoles,
      totalFolders,
      totalFiles,
      totalSize,
      maxFolderDepth,
      maxStoragePerUser,
      foldersPerUnit,
      usersPerRole,
      recentActivity,
    };
  }

  // =============================
  // STATS PER USER (SEMUA ROLE)
  // =============================
  @Get('user')
  async getUserStats(@Request() req) {
    const userId = req.user.id;

    // Total folders milik user ini
    const totalFolders = await this.folderRepository.count({
      where: { owner_id: userId, deleted_at: IsNull() },
    });

    // Total files di dalam folder milik user ini
    const totalFiles = await this.fileRepository
      .createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .getCount();

    // Total storage dari file milik user ini
    const storageResult = await this.fileRepository
      .createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .select('SUM(file.size)', 'totalSize')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .getRawOne();

    const totalSize = parseInt(storageResult?.totalSize || '0');

    // Get max storage per user setting
    const maxStorageSetting = await this.settingRepository.findOne({ where: { key: 'max_storage_per_user' } });
    const maxStoragePerUser = maxStorageSetting ? parseInt(maxStorageSetting.value, 10) : 104857600;

    // Get user and their role to resolve max folder depth
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role']
    });

    // Get max folder depth setting
    const maxDepthSetting = await this.settingRepository.findOne({ where: { key: 'max_folder_depth' } });
    const globalMaxFolderDepth = maxDepthSetting ? parseInt(maxDepthSetting.value, 10) : 5;
    
    const maxFolderDepth = user?.max_folder_depth != null 
      ? user.max_folder_depth 
      : (user?.role?.max_folder_depth != null ? user.role.max_folder_depth : globalMaxFolderDepth);

    //  milik user ini (15 terbaru)
    const recentFiles = await this.fileRepository
      .createQueryBuilder('file')
      .innerJoinAndSelect('file.folder', 'folder')
      .where('folder.owner_id = :userId', { userId })
      .andWhere('file.deleted_at IS NULL')
      .andWhere('folder.deleted_at IS NULL')
      .orderBy('file.created_at', 'DESC')
      .take(15)
      .getMany();

    return {
      totalFolders,
      totalFiles,
      totalSize,
      maxStoragePerUser,
      maxFolderDepth,
      recentFiles: recentFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        created_at: f.created_at,
        folder_name: f.folder?.name || '-',
      })),
    };
  }
}
