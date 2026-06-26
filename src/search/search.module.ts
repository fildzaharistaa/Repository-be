import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { FoldersModule } from '../folders/folders.module';
import { AccessRequestsModule } from '../access-requests/access-requests.module';

@Module({
  imports: [FoldersModule, AccessRequestsModule],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}