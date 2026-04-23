import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronService } from './cron.service';
import { File, User } from '../entities';
import { AccessRequest } from '../access-requests/access-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([File, User, AccessRequest]),
  ],
  providers: [CronService],
  exports: [CronService],
})
export class CronModule {}
