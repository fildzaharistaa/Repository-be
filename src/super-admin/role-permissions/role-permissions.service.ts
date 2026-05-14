import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Permission, Role, RolePermission } from '../../entities';
import { CopyPermissionsDto } from './dto/copy-permissions.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class RolePermissionsService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rpRepo: Repository<RolePermission>,
    private readonly dataSource: DataSource,
    private readonly cache: PermissionCacheService,
  ) {}

  private async ensureRole(roleId: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id: roleId, deleted_at: IsNull() } });
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);
    return role;
  }

  async listForRole(roleId: string): Promise<Permission[]> {
    await this.ensureRole(roleId);
    const rows = await this.rpRepo.find({
      where: { role_id: roleId },
      relations: ['permission'],
    });
    return rows
      .map((r) => r.permission)
      .filter((p): p is Permission => !!p && !p.deleted_at)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async addPermissions(roleId: string, permissionIds: string[], actorId?: string) {
    await this.ensureRole(roleId);
    const perms = await this.permissionRepo.find({
      where: { id: In(permissionIds), deleted_at: IsNull() },
    });
    if (perms.length !== permissionIds.length) {
      throw new BadRequestException('One or more permissionIds are invalid');
    }
    const existing = await this.rpRepo.find({
      where: { role_id: roleId, permission_id: In(permissionIds) },
    });
    const existingIds = new Set(existing.map((e) => e.permission_id));
    const toInsert = permissionIds
      .filter((pid) => !existingIds.has(pid))
      .map((pid) =>
        this.rpRepo.create({ role_id: roleId, permission_id: pid, granted_by: actorId ?? null }),
      );
    if (toInsert.length) await this.rpRepo.save(toInsert);
    this.cache.invalidateRole(roleId);
    return this.listForRole(roleId);
  }

  async replacePermissions(roleId: string, permissionIds: string[], actorId?: string) {
    await this.ensureRole(roleId);
    if (permissionIds.length) {
      const perms = await this.permissionRepo.find({
        where: { id: In(permissionIds), deleted_at: IsNull() },
      });
      if (perms.length !== permissionIds.length) {
        throw new BadRequestException('One or more permissionIds are invalid');
      }
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RolePermission, { role_id: roleId });
      if (permissionIds.length) {
        const rows = permissionIds.map((pid) =>
          manager.create(RolePermission, {
            role_id: roleId,
            permission_id: pid,
            granted_by: actorId ?? null,
          }),
        );
        await manager.save(rows);
      }
    });
    this.cache.invalidateRole(roleId);
    return this.listForRole(roleId);
  }

  async removePermission(roleId: string, permissionId: string) {
    await this.ensureRole(roleId);
    const row = await this.rpRepo.findOne({
      where: { role_id: roleId, permission_id: permissionId },
    });
    if (!row) throw new NotFoundException('Permission not assigned to this role');
    await this.rpRepo.delete(row.id);
    this.cache.invalidateRole(roleId);
    return { message: 'Permission removed from role' };
  }

  async copyFrom(targetRoleId: string, dto: CopyPermissionsDto, actorId?: string) {
    if (targetRoleId === dto.sourceRoleId) {
      throw new BadRequestException('sourceRoleId must differ from target');
    }
    await this.ensureRole(targetRoleId);
    await this.ensureRole(dto.sourceRoleId);
    const sourcePerms = await this.rpRepo.find({ where: { role_id: dto.sourceRoleId } });
    const ids = sourcePerms.map((s) => s.permission_id);
    const mode = dto.mode ?? 'merge';
    if (mode === 'replace') {
      return this.replacePermissions(targetRoleId, ids, actorId);
    }
    if (!ids.length) return this.listForRole(targetRoleId);
    return this.addPermissions(targetRoleId, ids, actorId);
  }
}
