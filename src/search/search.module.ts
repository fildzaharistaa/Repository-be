import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';
import { FoldersModule } from '../folders/folders.module';
import { AccessRequestsModule } from '../access-requests/access-requests.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, File]),
    FoldersModule,
    AccessRequestsModule
  ],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}