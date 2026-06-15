import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecycleBinService } from './recycle-bin.service';
import { RecycleBinController } from './recycle-bin.controller';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { FolderPermission } from '../entities/folder-permission.entity';
import { AccessRequest } from '../access-requests/access-request.entity';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([File, Folder, FolderPermission, AccessRequest]),
    SuperAdminModule,
  ],
  controllers: [RecycleBinController],
  providers: [RecycleBinService],
})
export class RecycleBinModule {}
