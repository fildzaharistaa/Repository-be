import { Module } from '@nestjs/common';
import { ShareLinksService } from './share-links.service';
import { ShareLinksController } from './share-links.controller';

@Module({
  controllers: [ShareLinksController],
  providers: [ShareLinksService],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
