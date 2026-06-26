import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { FoldersModule } from '../folders/folders.module';
import { SettingsModule } from '../settings/settings.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [FoldersModule, SettingsModule, SuperAdminModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}

