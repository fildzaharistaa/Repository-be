import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([File, Folder, User])],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationModule {}
