import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RolePermissionsService } from './role-permissions.service';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { CopyPermissionsDto } from './dto/copy-permissions.dto';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('super-admin/roles/:id')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolePermissionsController {
  constructor(private readonly service: RolePermissionsService) {}

  @Get('permissions')
  @RequirePermissions('role.view')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.listForRole(id);
  }

  @Post('permissions')
  @RequirePermissions('role.manage')
  add(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignPermissionsDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.addPermissions(id, dto.permissionIds, req.user?.id);
  }

  @Put('permissions')
  @RequirePermissions('role.manage')
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignPermissionsDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.replacePermissions(id, dto.permissionIds, req.user?.id);
  }

  @Delete('permissions/:permissionId')
  @RequirePermissions('role.manage')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('permissionId', new ParseUUIDPipe()) permissionId: string,
  ) {
    return this.service.removePermission(id, permissionId);
  }

  @Post('copy-permissions')
  @RequirePermissions('role.manage')
  copy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CopyPermissionsDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.copyFrom(id, dto, req.user?.id);
  }
}
