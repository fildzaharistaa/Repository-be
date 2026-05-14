import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UserRolesService } from './user-roles.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AssignBulkDto } from './dto/assign-bulk.dto';
import { SuspendAssignmentDto } from './dto/suspend-assignment.dto';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('super-admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UserRolesController {
  constructor(private readonly service: UserRolesService) {}

  @Get('users/:userId/roles')
  @RequirePermissions('user.view')
  list(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.service.listForUser(userId);
  }

  @Post('users/:userId/roles')
  @RequirePermissions('user.manage')
  assign(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AssignRoleDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.assign(userId, dto, req.user?.id);
  }

  @Post('user-roles/bulk-assign')
  @RequirePermissions('user.manage')
  bulkAssign(@Body() dto: AssignBulkDto, @Request() req: RequestWithUser) {
    return this.service.bulkAssign(dto, req.user?.id);
  }

  @Delete('users/:userId/roles/:roleId')
  @RequirePermissions('user.manage')
  remove(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ) {
    return this.service.remove(userId, roleId);
  }

  @Patch('users/:userId/roles/:roleId/set-primary')
  @RequirePermissions('user.manage')
  setPrimary(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ) {
    return this.service.setPrimary(userId, roleId);
  }

  @Get('user-roles/active-summary')
  @RequirePermissions('user.view')
  getAllActiveUserRoles() {
    return this.service.getAllActiveUserRoles();
  }

  @Get('user-roles/pending-reactivation')
  @RequirePermissions('user.manage')
  getPendingReactivations() {
    return this.service.getPendingReactivations();
  }

  @Patch('user-roles/:assignmentId/suspend')
  @RequirePermissions('user.manage')
  suspend(
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() dto: SuspendAssignmentDto,
  ) {
    return this.service.suspend(assignmentId, dto);
  }

  @Patch('user-roles/:assignmentId/reactivate')
  @RequirePermissions('user.manage')
  reactivate(@Param('assignmentId', new ParseUUIDPipe()) assignmentId: string) {
    return this.service.reactivate(assignmentId);
  }

  @Patch('user-roles/:assignmentId/request-reactivation')
  requestReactivation(
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.service.requestReactivation(assignmentId, req.user?.id);
  }
}
