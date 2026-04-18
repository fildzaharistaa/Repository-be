import { Controller, Get, UseGuards, Patch, Body } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async findAll() {
    return this.rolesService.findAll();
  }

  @Patch('depth')
  async updateDepth(@Body() body: { roleIds: string[], maxDepth: number }) {
    await this.rolesService.updateRoleDepth(body.roleIds, body.maxDepth);
    return { success: true, message: `Max depth updated for ${body.roleIds.length} roles` };
  }
}

