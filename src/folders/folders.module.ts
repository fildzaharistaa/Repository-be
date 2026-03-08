import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoldersService } from './folders.service';
import { FoldersController } from './folders.controller';
import { Folder, FolderPermission } from '../entities';
import { FolderPermissionGuard } from '../common/guards/folder-permission.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, FolderPermission]),
    forwardRef(() => UsersModule),
  ],
  controllers: [FoldersController],
  providers: [FoldersService, FolderPermissionGuard],
  exports: [FoldersService],
})
export class FoldersModule {}

