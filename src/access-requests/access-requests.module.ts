import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { FolderPermission } from 'src/entities/folder-permission.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessRequest,
      Folder,
      File,
      User,
      FolderPermission
    ])
  ],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}