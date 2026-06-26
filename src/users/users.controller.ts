import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SwitchRoleDto } from './dto/switch-role.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PermissionCacheService } from '../super-admin/shared/permission-cache.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly permCache: PermissionCacheService,
  ) {}

  @Get('profile')
  async getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findOne(req.user.id);
  }

  @Get('role')
  async getRole(@Request() req: RequestWithUser) {
    const user = await this.usersService.findOne(req.user.id);
    return {
      role: (user as any).role,
      role_id: user.role_id,
    };
  }

  @Get('my-roles')
  async getMyRoles(@Request() req: RequestWithUser) {
    const assignments = await this.prisma.user_roles.findMany({
      where: { user_id: req.user.id, deleted_at: null },
      include: { roles: true },
      orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
    });

    const assignmentsWithShim = assignments.map((a) => {
      (a as any).role = a.roles;
      return a;
    });

    const activeRoleId = (req.user as any).active_role_id || req.user.role_id || null;
    return {
      active_role_id: activeRoleId,
      assignments: assignmentsWithShim,
    };
  }

  @Get('my-permissions')
  async getMyPermissions(@Request() req: RequestWithUser) {
    const activeRoleId = (req.user as any).active_role_id || req.user.role_id || null;
    const { slugs, isWildcard } = await this.permCache.getEffective(req.user.id, activeRoleId);
    return {
      permissions: isWildcard ? ['*'] : Array.from(slugs),
      isWildcard,
    };
  }

  @Post('switch-role')
  async switchRole(@Request() req: RequestWithUser, @Body() dto: SwitchRoleDto) {
    const assignment = await this.prisma.user_roles.findFirst({
      where: {
        user_id: req.user.id,
        role_id: dto.roleId,
        status: 'ACTIVE',
        deleted_at: null,
      },
      include: { roles: true },
    });
    if (!assignment) {
      throw new BadRequestException(
        'Role is not active for this user or assignment does not exist',
      );
    }
    const payload: JwtPayload = {
      sub: req.user.id,
      email: req.user.email || '',
      role: assignment.roles?.name || '',
      role_id: req.user.role_id || '',
      active_role_id: dto.roleId,
    };
    const access_token = this.jwtService.sign(payload);
    return {
      access_token,
      active_role: assignment.roles,
      active_role_id: dto.roleId,
    };
  }

  @Get()
  async findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(paginationDto.page, paginationDto.limit);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
    return { message: 'User deleted successfully' };
  }
}
