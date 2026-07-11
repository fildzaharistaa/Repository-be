import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { File, Folder, SystemSetting, FileAccessLog, FilePermission } from '../entities';
import { FoldersModule } from '../folders/folders.module';
import { SettingsModule } from '../settings/settings.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([File, Folder, SystemSetting, FileAccessLog, FilePermission]),
    FoldersModule,
    SettingsModule,
    SuperAdminModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}

