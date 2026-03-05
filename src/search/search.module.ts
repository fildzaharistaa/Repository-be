import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Folder, File])],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}