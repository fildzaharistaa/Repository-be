import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { AccessRequestsService } from './access-requests.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('access-requests')
export class AccessRequestsController {

  constructor(
    private readonly accessRequestsService: AccessRequestsService
  ) {}

  @Public()
  @Get('test')
  test() {
    return {
      message: 'Access Requests Module Working'
    };
  }

  @Post()
  async requestAccess(
    @Body('folderId') folderId: string,
    @Req() req
  ) {
    return this.accessRequestsService.requestAccess(
      req.user.id,
      folderId
    );
  }

}