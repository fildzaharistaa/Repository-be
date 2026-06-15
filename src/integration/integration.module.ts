import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IntegrationController } from './integration.controller';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ConfigModule, FilesModule, FoldersModule, UsersModule],
  controllers: [IntegrationController],
})
export class IntegrationModule {}
