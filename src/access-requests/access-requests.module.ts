import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessRequest } from './access-request.entity';
import { Folder } from '../entities/folder.entity'; // ← PENTING

import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsController } from './access-requests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessRequest,
      Folder, //
    ])
  ],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
})
export class AccessRequestsModule {}