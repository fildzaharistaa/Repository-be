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
import { AdminPermissionsService } from './admin-permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('super-admin/permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminPermissionsController {
  constructor(private readonly service: AdminPermissionsService) {}

  @Post()
  @RequirePermissions('permission.manage')
  create(@Body() dto: CreatePermissionDto, @Request() req: RequestWithUser) {
    return this.service.create(dto, req.user?.id);
  }

  @Get()
  @RequirePermissions('permission.view')
  findAll(
    @Query('module') module?: string,
    @Query('category') category?: string,
    @Query('visibility') visibility?: string,
  ) {
    return this.service.findAll({ module, category, visibility });
  }

  @Get('grouped')
  @RequirePermissions('permission.view')
  findGrouped() {
    return this.service.findGrouped();
  }

  @Get(':id')
  @RequirePermissions('permission.view')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('permission.manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePermissionDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.update(id, dto, req.user?.id);
  }

  @Delete(':id')
  @RequirePermissions('permission.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.remove(id);
    return { message: 'Permission deleted' };
  }
}
