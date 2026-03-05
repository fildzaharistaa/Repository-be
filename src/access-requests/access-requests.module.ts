import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { FolderPermission } from 'src/entities/folder-permission.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessRequest,
      Folder,
      File,
      FolderPermission
    ])
  ],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
})
export class AccessRequestsModule {}