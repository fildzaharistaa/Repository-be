import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AdminRolesService } from './admin-roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloneRoleDto } from './dto/clone-role.dto';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('super-admin/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminRolesController {
  constructor(private readonly service: AdminRolesService) {}

  @Post()
  @RequirePermissions('role.manage')
  create(@Body() dto: CreateRoleDto, @Request() req: RequestWithUser) {
    return this.service.create(dto, req.user?.id);
  }

  @Get()
  @RequirePermissions('role.view')
  findAll(
    @Query('include_inactive') includeInactive?: string,
    @Query('category') category?: string,
  ) {
    return this.service.findAll({
      includeInactive: includeInactive === 'true' || includeInactive === '1',
      category,
    });
  }

  @Get(':id')
  @RequirePermissions('role.view')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('role.manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoleDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.update(id, dto, req.user?.id);
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('role.manage')
  toggleActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req: RequestWithUser,
  ) {
    return this.service.toggleActive(id, req.user?.id);
  }

  @Delete(':id')
  @RequirePermissions('role.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.remove(id);
    return { message: 'Role deleted' };
  }

  @Post(':id/clone')
  @RequirePermissions('role.manage')
  clone(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CloneRoleDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.clone(id, dto, req.user?.id);
  }
}
