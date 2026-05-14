import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Role, User, UserRole, UserRoleStatus } from '../../entities';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AssignBulkDto } from './dto/assign-bulk.dto';
import { SuspendAssignmentDto } from './dto/suspend-assignment.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class UserRolesService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(UserRole) private readonly urRepo: Repository<UserRole>,
    private readonly dataSource: DataSource,
    private readonly cache: PermissionCacheService,
  ) {}

  async listForUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return this.urRepo.find({
      where: { user_id: userId, deleted_at: IsNull() },
      relations: ['role'],
      order: { is_primary: 'DESC', assigned_at: 'ASC' },
    });
  }

  async assign(userId: string, dto: AssignRoleDto, actorId?: string): Promise<UserRole> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    const role = await this.roleRepo.findOne({ where: { id: dto.roleId, deleted_at: IsNull() } });
    if (!role) throw new NotFoundException(`Role ${dto.roleId} not found`);
    if (!role.is_active) throw new BadRequestException('Cannot assign inactive role');

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(UserRole, {
        where: { user_id: userId, role_id: dto.roleId, deleted_at: IsNull() },
      });
      let ur: UserRole;
      if (existing) {
        existing.status = UserRoleStatus.ACTIVE;
        existing.expires_at = dto.expiresAt ? new Date(dto.expiresAt) : null;
        existing.reactivated_at = new Date();
        existing.suspended_reason = null;
        existing.suspended_at = null;
        if (dto.isPrimary) existing.is_primary = true;
        if (dto.description !== undefined) existing.description = dto.description || null;
        ur = await manager.save(existing);
      } else {
        const created = manager.create(UserRole, {
          user_id: userId,
          role_id: dto.roleId,
          is_primary: dto.isPrimary ?? false,
          status: UserRoleStatus.ACTIVE,
          expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
          assigned_by: actorId ?? null,
          description: dto.description || null,
        });
        ur = await manager.save(created);
      }
      if (ur.is_primary) {
        await this.applyPrimary(manager, userId, ur.id, dto.roleId);
      } else if (!(await this.hasPrimary(manager, userId))) {
        // ensure user always has a primary role
        ur.is_primary = true;
        await manager.save(ur);
        await this.applyPrimary(manager, userId, ur.id, dto.roleId);
      }
      this.cache.invalidateUser(userId);
      return ur;
    });
  }

  async bulkAssign(dto: AssignBulkDto, actorId?: string) {
    const role = await this.roleRepo.findOne({ where: { id: dto.roleId, deleted_at: IsNull() } });
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
    const ur = await this.urRepo.findOne({
      where: { user_id: userId, role_id: roleId, deleted_at: IsNull() },
    });
    if (!ur) throw new NotFoundException('User-role assignment not found');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(UserRole, ur.id);
      if (ur.is_primary) {
        // promote another ACTIVE assignment to primary, sync users.role_id
        const next = await manager.findOne(UserRole, {
          where: { user_id: userId, status: UserRoleStatus.ACTIVE, deleted_at: IsNull() },
          order: { assigned_at: 'ASC' },
        });
        if (next) {
          next.is_primary = true;
          await manager.save(next);
          await manager.update(User, { id: userId }, { role_id: next.role_id });
        }
      }
    });
    this.cache.invalidateUser(userId);
    return { message: 'Role assignment removed' };
  }

  async setPrimary(userId: string, roleId: string) {
    const ur = await this.urRepo.findOne({
      where: { user_id: userId, role_id: roleId, deleted_at: IsNull() },
    });
    if (!ur) throw new NotFoundException('User-role assignment not found');
    if (ur.status !== UserRoleStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE assignments can be primary');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.applyPrimary(manager, userId, ur.id, roleId);
    });
    this.cache.invalidateUser(userId);
    return this.urRepo.findOne({ where: { id: ur.id }, relations: ['role'] });
  }

  async suspend(assignmentId: string, dto: SuspendAssignmentDto) {
    const ur = await this.urRepo.findOne({ where: { id: assignmentId, deleted_at: IsNull() } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.status === UserRoleStatus.SUSPENDED) {
      throw new BadRequestException('Assignment already suspended');
    }
    ur.status = UserRoleStatus.SUSPENDED;
    ur.suspended_at = new Date();
    ur.suspended_reason = dto.reason ?? null;
    const saved = await this.urRepo.save(ur);
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  async reactivate(assignmentId: string) {
    const ur = await this.urRepo.findOne({ where: { id: assignmentId, deleted_at: IsNull() } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.status === UserRoleStatus.ACTIVE) {
      throw new BadRequestException('Assignment already active');
    }
    ur.status = UserRoleStatus.ACTIVE;
    ur.reactivated_at = new Date();
    ur.suspended_reason = null;
    ur.suspended_at = null;
    const saved = await this.urRepo.save(ur);
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  async getAllActiveUserRoles(): Promise<UserRole[]> {
    return this.urRepo.find({
      where: { status: UserRoleStatus.ACTIVE, deleted_at: IsNull() },
      relations: ['role'],
      order: { user_id: 'ASC', is_primary: 'DESC' } as any,
    });
  }

  async getPendingReactivations(): Promise<UserRole[]> {
    return this.urRepo.find({
      where: { status: UserRoleStatus.PENDING_REACTIVATION, deleted_at: IsNull() },
      relations: ['user', 'role'],
      order: { updated_at: 'ASC' },
    });
  }

  async requestReactivation(assignmentId: string, requesterId: string) {
    const ur = await this.urRepo.findOne({ where: { id: assignmentId, deleted_at: IsNull() } });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.user_id !== requesterId) {
      throw new BadRequestException('You can only request reactivation for your own assignments');
    }
    if (ur.status !== UserRoleStatus.SUSPENDED) {
      throw new BadRequestException('Only SUSPENDED assignments can request reactivation');
    }
    ur.status = UserRoleStatus.PENDING_REACTIVATION;
    const saved = await this.urRepo.save(ur);
    this.cache.invalidateUser(ur.user_id);
    return saved;
  }

  // ---------- helpers ----------
  private async hasPrimary(manager: any, userId: string): Promise<boolean> {
    const found = await manager.findOne(UserRole, {
      where: {
        user_id: userId,
        is_primary: true,
        status: UserRoleStatus.ACTIVE,
        deleted_at: IsNull(),
      },
    });
    return !!found;
  }

  private async applyPrimary(
    manager: any,
    userId: string,
    keepAssignmentId: string,
    roleId: string,
  ) {
    // unset is_primary on every other assignment of the user
    await manager
      .createQueryBuilder()
      .update(UserRole)
      .set({ is_primary: false })
      .where('user_id = :userId AND id != :keep', { userId, keep: keepAssignmentId })
      .execute();
    // mirror to legacy users.role_id so existing code keeps working
    await manager.update(User, { id: userId }, { role_id: roleId });
  }
}
