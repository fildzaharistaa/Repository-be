import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareLinksService } from './share-links.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLink } from './share-link.entity';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ShareLink, File, Folder, User])],
  controllers: [ShareLinksController],
  providers: [ShareLinksService],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
