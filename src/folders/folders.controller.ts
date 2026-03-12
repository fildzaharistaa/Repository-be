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
  async findOne(@Param('id') id: string) {
    return this.foldersService.findOne(id);
  }

  @Post()
  async create(
    @Body() createFolderDto: CreateFolderDto,
    @Request() req: RequestWithUser,
  ) {
    // Admin can create root folders without permission check
    const isAdmin = req.user.role?.name === 'admin';
    
    // Check permission if parent_id is provided (skip for admin)
    if (createFolderDto.parent_id && !isAdmin) {
      const hasPermission = await this.foldersService.checkPermission(
        req.user.id,
        req.user.role_id,
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
  @UseGuards(FolderPermissionGuard)
  @RequirePermission(PermissionType.UPDATE)
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

