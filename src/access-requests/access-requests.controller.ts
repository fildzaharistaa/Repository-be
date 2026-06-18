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
    @Body('message') message: string,
    @Req() req
  ) {
    return this.accessRequestsService.requestAccess(
      req.user.id,
      folderId,
      fileId,
      message
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
  // GET SHARED FILES
  // Passes the active role ID from JWT so the backend can filter
  // file_permissions by (user_id + role_id) matching the current session.
  // =============================
  @Get('shared-files')
  getSharedFiles(@Req() req) {
    const activeRoleId: string =
      (req.user as any).active_role_id ?? req.user.role_id;
    return this.accessRequestsService.getSharedFiles(
      req.user.id,
      activeRoleId,
    );
  }

  // =============================
  // DIRECT FILE SHARE (BY OWNER)
  // =============================
  @Post('files/:id/share')
  async shareFile(
    @Param('id') fileId: string,
    @Body() body: any,
    @Req() req
  ) {
    return this.accessRequestsService.directShareFile(
      fileId,
      body,
      req.user
    );
  }

  // =============================
  // GET FILE SHARES
  // =============================
  @Get('files/:id/shares')
  getFileShares(@Param('id') fileId: string) {
    return this.accessRequestsService.getFileShares(fileId);
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
      body,
      body?.response_message
    );
  }

  // =============================
  // OWNER REJECT REQUEST
  // =============================
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body('response_message') responseMessage: string,
    @Req() req
  ) {
    return this.accessRequestsService.rejectRequest(
      Number(id),
      req.user.id,
      responseMessage
    );
  }

  // =============================
  // USER REQUEST HIERARCHY INCREASE
  // =============================
  @Post('hierarchy')
  requestHierarchy(
    @Body('requested_depth') requestedDepth: number,
    @Body('message') message: string,
    @Req() req
  ) {
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id;
    return this.accessRequestsService.requestHierarchyIncrease(
      req.user.id,
      requestedDepth,
      message,
      activeRoleId,
    );
  }

  // =============================
  // ADMIN APPROVE HIERARCHY REQUEST
  // =============================
  @Patch(':id/approve-hierarchy')
  approveHierarchy(
    @Param('id') id: string,
    @Body('response_message') responseMessage: string,
    @Req() req
  ) {
    return this.accessRequestsService.approveHierarchyRequest(
      Number(id),
      req.user.id,
      responseMessage
    );
  }

  // =============================
  // GET PENDING HIERARCHY REQUESTS
  // =============================
  @Get('hierarchy/pending')
  getPendingHierarchy() {
    return this.accessRequestsService.getPendingHierarchyRequests();
  }

}
