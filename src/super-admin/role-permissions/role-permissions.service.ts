import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CopyPermissionsDto } from './dto/copy-permissions.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class RolePermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {}

  private async ensureRole(roleId: string) {
    const role = await this.prisma.roles.findFirst({ where: { id: roleId, deleted_at: null } });
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);
    return role;
  }

  async listForRole(roleId: string) {
    await this.ensureRole(roleId);
    const rows = await this.prisma.role_permissions.findMany({
      where: { role_id: roleId },
      include: { permissions: true },
    });
    return rows
      .map((r) => r.permissions)
      .filter((p): p is NonNullable<typeof p> => !!p && !p.deleted_at)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async addPermissions(roleId: string, permissionIds: string[], actorId?: string) {
    await this.ensureRole(roleId);
    const perms = await this.prisma.permissions.findMany({
      where: { id: { in: permissionIds }, deleted_at: null },
    });
    if (perms.length !== permissionIds.length) {
      throw new BadRequestException('One or more permissionIds are invalid');
    }
    const existing = await this.prisma.role_permissions.findMany({
      where: { role_id: roleId, permission_id: { in: permissionIds } },
    });
    const existingIds = new Set(existing.map((e) => e.permission_id));
    const toInsert = permissionIds
      .filter((pid) => !existingIds.has(pid))
      .map((pid) => ({ role_id: roleId, permission_id: pid, granted_by: actorId ?? null }));
    if (toInsert.length) {
      await this.prisma.role_permissions.createMany({ data: toInsert });
    }
    this.cache.invalidateRole(roleId);
    return this.listForRole(roleId);
  }

  async replacePermissions(roleId: string, permissionIds: string[], actorId?: string) {
    await this.ensureRole(roleId);
    if (permissionIds.length) {
      const perms = await this.prisma.permissions.findMany({
        where: { id: { in: permissionIds }, deleted_at: null },
      });
      if (perms.length !== permissionIds.length) {
        throw new BadRequestException('One or more permissionIds are invalid');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role_permissions.deleteMany({ where: { role_id: roleId } });
      if (permissionIds.length) {
        await tx.role_permissions.createMany({
          data: permissionIds.map((pid) => ({
            role_id: roleId,
            permission_id: pid,
            granted_by: actorId ?? null,
          })),
        });
      }
    });
    this.cache.invalidateRole(roleId);
    return this.listForRole(roleId);
  }

  async removePermission(roleId: string, permissionId: string) {
    await this.ensureRole(roleId);
    const row = await this.prisma.role_permissions.findFirst({
      where: { role_id: roleId, permission_id: permissionId },
    });
    if (!row) throw new NotFoundException('Permission not assigned to this role');
    await this.prisma.role_permissions.delete({ where: { id: row.id } });
    this.cache.invalidateRole(roleId);
    return { message: 'Permission removed from role' };
  }

  async copyFrom(targetRoleId: string, dto: CopyPermissionsDto, actorId?: string) {
    if (targetRoleId === dto.sourceRoleId) {
      throw new BadRequestException('sourceRoleId must differ from target');
    }
    await this.ensureRole(targetRoleId);
    await this.ensureRole(dto.sourceRoleId);
    const sourcePerms = await this.prisma.role_permissions.findMany({
      where: { role_id: dto.sourceRoleId },
    });
    const ids = sourcePerms.map((s) => s.permission_id);
    const mode = dto.mode ?? 'merge';
    if (mode === 'replace') {
      return this.replacePermissions(targetRoleId, ids, actorId);
    }
    if (!ids.length) return this.listForRole(targetRoleId);
    return this.addPermissions(targetRoleId, ids, actorId);
  }
}
