import { Controller, Get, Query, Req } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {

  constructor(
    private readonly searchService: SearchService
  ) {}

  @Get()
  async globalSearch(
    @Query('q') keyword: string,
    @Req() req
  ) {
    return this.searchService.globalSearch(
      keyword,
      req.user
    );
  }

}