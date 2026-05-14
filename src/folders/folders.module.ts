import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoldersService } from './folders.service';
import { FoldersController } from './folders.controller';
import { Folder, FolderPermission, Role, File, SystemSetting } from '../entities';
import { FolderPermissionGuard } from '../common/guards/folder-permission.guard';
import { UsersModule } from '../users/users.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, FolderPermission, Role, File, SystemSetting]),
    forwardRef(() => UsersModule),
    SuperAdminModule,
  ],
  controllers: [FoldersController],
  providers: [FoldersService, FolderPermissionGuard],
  exports: [FoldersService],
})
export class FoldersModule {}
