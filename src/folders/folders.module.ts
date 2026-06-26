import { Module, forwardRef } from '@nestjs/common';
import { FoldersService } from './folders.service';
import { FoldersController } from './folders.controller';
import { FolderPermissionGuard } from '../common/guards/folder-permission.guard';
import { UsersModule } from '../users/users.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [forwardRef(() => UsersModule), SuperAdminModule],
  controllers: [FoldersController],
  providers: [FoldersService, FolderPermissionGuard],
  exports: [FoldersService],
})
export class FoldersModule {}
