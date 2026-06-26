import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AssignBulkDto } from './dto/assign-bulk.dto';
import { SuspendAssignmentDto } from './dto/suspend-assignment.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class UserRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {}

  async listForUser(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return this.prisma.user_roles.findMany({
      where: { user_id: userId, deleted_at: null },
      include: { roles: true },
      orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
    });
  }

  async assign(userId: string, dto: AssignRoleDto, actorId?: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    const role = await this.prisma.roles.findFirst({ where: { id: dto.roleId, deleted_at: null } });
    if (!role) throw new NotFoundException(`Role ${dto.roleId} not found`);
    if (!role.is_active) throw new BadRequestException('Cannot assign inactive role');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user_roles.findFirst({
        where: { user_id: userId, role_id: dto.roleId, deleted_at: null },
      });

      let ur: any;
      if (existing) {
        ur = await tx.user_roles.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
            reactivated_at: new Date(),
            suspended_reason: null,
            suspended_at: null,
            ...(dto.isPrimary ? { is_primary: true } : {}),
            ...(dto.description !== undefined ? { description: dto.description || null } : {}),
          },
        });
      } else {
        ur = await tx.user_roles.create({
          data: {
            user_id: userId,
            role_id: dto.roleId,
            is_primary: dto.isPrimary ?? false,
            status: 'ACTIVE',
            expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
            assigned_by: actorId ?? null,
            description: dto.description || null,
          },
        });
      }

      if (ur.is_primary) {
        await this.applyPrimary(tx, userId, ur.id, dto.roleId);
      } else if (!(await this.hasPrimary(tx, userId))) {
        ur = await tx.user_roles.update({ where: { id: ur.id }, data: { is_primary: true } });
        await this.applyPrimary(tx, userId, ur.id, dto.roleId);
      }

      this.cache.invalidateUser(userId);
      return ur;
    });
  }

  async bulkAssign(dto: AssignBulkDto, actorId?: string) {
    const role = await this.prisma.roles.findFirst({ where: { id: dto.roleId, deleted_at: null } });
    if (!role) throw new NotFoundException(`Role ${dto.roleId} not found`);
    if (!role.is_active) throw new BadRequestException('Cannot assign inactive role');
    const results: { userId: string; ok: boolean; error?: string }[] = [];
    for (const userId of dto.userIds) {
      try {
        await this.assign(userId, { roleId: dto.roleId, isPrimary: dto.isPrimary, expiresAt: dto.expiresAt }, actorId);
        results.push({ userId, ok: true });
      } catch (e: any) {
        results.push({ userId, ok: false, error: e?.message ?? 'failed' });
      }
    }
    return { roleId: dto.roleId, total: dto.userIds.length, results };
  }

  async remove(userId: string, roleId: string) {
    const ur = await this.prisma.user_roles.findFirst({
      where: { user_id: userId, role_id: roleId, deleted_at: null },
    });
    if (!ur) throw new NotFoundException('User-role assignment not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.user_roles.update({ where: { id: ur.id }, data: { deleted_at: new Date() } });
      if (ur.is_primary) {
        const next = await tx.user_roles.findFirst({
          where: { user_id: userId, status: 'ACTIVE', deleted_at: null },
          orderBy: { assigned_at: 'asc' },
        });
        if (next) {
          await tx.user_roles.update({ where: { id: next.id }, data: { is_primary: true } });
          await tx.users.update({ where: { id: userId }, data: { role_id: next.role_id } });
        }
      }
    });

    this.cache.invalidateUser(userId);
    return { message: 'Role assignment removed' };
  }

  async setPrimary(userId: string, roleId: string) {
    const ur = await this.prisma.user_roles.findFirst({
      where: { user_id: userId, role_id: roleId, deleted_at: null },
    });
    if (!ur) throw new NotFoundException('User-role assignment not found');
    if (ur.status !== 'ACTIVE') {
      throw new BadRequestException('Only ACTIVE assignments can be primary');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applyPrimary(tx, userId, ur.id, roleId);
    });
    this.cache.invalidateUser(userId);
    return this.prisma.user_roles.findUnique({ where: { id: ur.id }, include: { roles: true } });
  }

  async suspend(assignmentId: string, dto: SuspendAssignmentDto) {
    const ur = await this.prisma.user_roles.findFirst({ where: { id: assignmentId, deleted_at: null } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.status === 'SUSPENDED') {
      throw new BadRequestException('Assignment already suspended');
    }
    const saved = await this.prisma.user_roles.update({
      where: { id: assignmentId },
      data: { status: 'SUSPENDED', suspended_at: new Date(), suspended_reason: dto.reason ?? null },
    });
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  async reactivate(assignmentId: string) {
    const ur = await this.prisma.user_roles.findFirst({ where: { id: assignmentId, deleted_at: null } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.status === 'ACTIVE') {
      throw new BadRequestException('Assignment already active');
    }
    const saved = await this.prisma.user_roles.update({
      where: { id: assignmentId },
      data: { status: 'ACTIVE', reactivated_at: new Date(), suspended_reason: null, suspended_at: null },
    });
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  async getAllActiveUserRoles() {
    return this.prisma.user_roles.findMany({
      where: { status: 'ACTIVE', deleted_at: null },
      include: { roles: true },
      orderBy: [{ user_id: 'asc' }, { is_primary: 'desc' }],
    });
  }

  async getPendingReactivations() {
    return this.prisma.user_roles.findMany({
      where: { status: 'PENDING_REACTIVATION', deleted_at: null },
      include: { users: true, roles: true },
      orderBy: { updated_at: 'asc' },
    });
  }

  async requestReactivation(assignmentId: string, requesterId: string) {
    const ur = await this.prisma.user_roles.findFirst({ where: { id: assignmentId, deleted_at: null } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.user_id !== requesterId) {
      throw new BadRequestException('You can only request reactivation for your own assignments');
    }
    if (ur.status !== 'SUSPENDED') {
      throw new BadRequestException('Only SUSPENDED assignments can request reactivation');
    }
    const saved = await this.prisma.user_roles.update({
      where: { id: assignmentId },
      data: { status: 'PENDING_REACTIVATION' },
    });
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  private async hasPrimary(tx: any, userId: string): Promise<boolean> {
    const found = await tx.user_roles.findFirst({
      where: { user_id: userId, is_primary: true, status: 'ACTIVE', deleted_at: null },
    });
    return !!found;
  }

  private async applyPrimary(tx: any, userId: string, keepAssignmentId: string, roleId: string) {
    await tx.user_roles.updateMany({
      where: { user_id: userId, id: { not: keepAssignmentId } },
      data: { is_primary: false },
    });
    await tx.users.update({ where: { id: userId }, data: { role_id: roleId } });
  }
}
