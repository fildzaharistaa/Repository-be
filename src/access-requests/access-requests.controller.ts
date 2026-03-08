import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Param,
  Patch
} from '@nestjs/common';
import { AccessRequestsService } from './access-requests.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('access-requests')
export class AccessRequestsController {

  constructor(
    private readonly accessRequestsService: AccessRequestsService
  ) {}

  // =============================
  // TEST ROUTE
  // =============================
  @Public()
  @Get('test')
  test() {
    return {
      message: 'Access Requests Module Working'
    };
  }

  // =============================
  // USER REQUEST ACCESS
  // =============================
  @Post()
  requestAccess(
    @Body('folderId') folderId: string,
    @Body('fileId') fileId: string,
    @Req() req
  ) {
    return this.accessRequestsService.requestAccess(
      req.user.id,
      folderId,
      fileId
    );
  }

  // =============================
  // USER LIHAT REQUEST SENDIRI
  // =============================
  @Get('my-requests')
  getMyRequests(@Req() req) {
    return this.accessRequestsService.getUserRequests(
      req.user.id
    );
  }

  // =============================
  // OWNER LIHAT PENDING REQUEST
  // =============================
  @Get('pending')
  getPendingRequests(@Req() req) {
    return this.accessRequestsService.getPendingRequests(
      req.user.id
    );
  }

  // =============================
  // NOTIFICATIONS: DATA UNTUK BELL
  // =============================
  @Get('notifications')
  getNotifications(@Req() req) {
    return this.accessRequestsService.getNotifications(
      req.user.id
    );
  }

  // =============================
  // OWNER APPROVE REQUEST
  // =============================
  @Patch(':id/approve')
  approveRequest(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req
  ) {
    return this.accessRequestsService.approveRequest(
      Number(id),
      req.user.id,
      body
    );
  }

  // =============================
  // OWNER REJECT REQUEST
  // =============================
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Req() req
  ) {
    return this.accessRequestsService.rejectRequest(
      Number(id),
      req.user.id
    );
  }

}