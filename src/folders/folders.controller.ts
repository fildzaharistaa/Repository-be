import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { FoldersService } from './folders.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FolderPermissionGuard } from '../common/guards/folder-permission.guard';
import { RequirePermission } from '../common/decorators/permission.decorator';
import { PermissionType } from '../common/guards/folder-permission.guard';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';

@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get('tree')
  async getTree(@Request() req: RequestWithUser) {
    return this.foldersService.getTree(req.user);
  }

  @Get()
  async findAll(@Request() req: RequestWithUser) {
    return this.foldersService.findAllAccessible(req.user);
  }

  @Get('shared/tree')
  async getSharedTree(@Request() req: RequestWithUser) {
    return this.foldersService.getSharedTree(req.user);
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAllForAdmin() {
    return this.foldersService.findAllForAdmin();
  }

  @Get('admin/tree')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getTreeForAdmin() {
    return this.foldersService.getTreeForAdmin();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.foldersService.findOneForUser(id, req.user);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('folder.create')
  async create(
    @Body() createFolderDto: CreateFolderDto,
    @Request() req: RequestWithUser,
  ) {
    // Check folder-level permission if creating inside a parent folder
    const activeRoleId = (req.user as any).active_role_id ?? req.user.role_id;
    const isAdminRole = !!(req.user.role?.is_admin);

    if (createFolderDto.parent_id && !isAdminRole) {
      const hasPermission = await this.foldersService.checkPermission(
        req.user.id,
        activeRoleId,
        createFolderDto.parent_id,
        'create',
      );

      if (!hasPermission) {
        throw new ForbiddenException(
          'You do not have create permission for the parent folder',
        );
      }
    }

    return this.foldersService.create(createFolderDto, req.user.id);
  }

  @Patch(':id')
  // @UseGuards(FolderPermissionGuard)
  // @RequirePermission(PermissionType.UPDATE)
  async update(@Param('id') id: string, @Body() updateFolderDto: UpdateFolderDto) {
    return this.foldersService.update(id, updateFolderDto);
  }

  @Delete(':id')
  @UseGuards(FolderPermissionGuard)
  @RequirePermission(PermissionType.DELETE)
  async remove(@Param('id') id: string) {
    await this.foldersService.remove(id);
    return { message: 'Folder deleted successfully' };
  }
}

