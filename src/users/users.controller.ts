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
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
import { UserRole, UserRoleStatus } from '../entities';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly jwtService: JwtService,
  ) {}

  @Get('profile')
  async getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findOne(req.user.id);
  }

  @Get('role')
  async getRole(@Request() req: RequestWithUser) {
    const user = await this.usersService.findOne(req.user.id);
    return {
      role: user.role,
      role_id: user.role_id,
    };
  }

  @Get('my-roles')
  async getMyRoles(@Request() req: RequestWithUser) {
    const assignments = await this.userRoleRepo.find({
      where: { user_id: req.user.id, deleted_at: IsNull() },
      relations: ['role'],
      order: { is_primary: 'DESC', assigned_at: 'ASC' },
    });
    const activeRoleId = (req.user as any).active_role_id || req.user.role_id || null;
    return {
      active_role_id: activeRoleId,
      assignments,
    };
  }

  @Post('switch-role')
  async switchRole(@Request() req: RequestWithUser, @Body() dto: SwitchRoleDto) {
    const assignment = await this.userRoleRepo.findOne({
      where: {
        user_id: req.user.id,
        role_id: dto.roleId,
        status: UserRoleStatus.ACTIVE,
        deleted_at: IsNull(),
      },
      relations: ['role'],
    });
    if (!assignment) {
      throw new BadRequestException(
        'Role is not active for this user or assignment does not exist',
      );
    }
    const payload: JwtPayload = {
      sub: req.user.id,
      email: req.user.email,
      role: assignment.role?.name || '',
      role_id: req.user.role_id || '',
      active_role_id: dto.roleId,
    };
    const access_token = this.jwtService.sign(payload);
    return {
      access_token,
      active_role: assignment.role,
      active_role_id: dto.roleId,
    };
  }

  @Get()
  async findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(
      paginationDto.page,
      paginationDto.limit,
    );
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('import-excel')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async importExcel(@Body() usersData: any[]) {
    return this.usersService.importExcel(usersData);
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

