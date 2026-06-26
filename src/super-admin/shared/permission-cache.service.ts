import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TTL_MS = 60_000;

interface CacheEntry {
  slugs: Set<string>;
  isWildcard: boolean;
  expiresAt: number;
}

@Injectable()
export class PermissionCacheService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  private key(userId: string, activeRoleId: string | null | undefined) {
    return `${userId}::${activeRoleId ?? 'primary'}`;
  }

  invalidateUser(userId: string) {
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${userId}::`)) this.cache.delete(k);
    }
  }

  invalidateRole(_roleId: string) {
    this.cache.clear();
  }

  invalidateAll() {
    this.cache.clear();
  }

  async getEffective(
    userId: string,
    activeRoleId: string | null | undefined,
  ): Promise<{ slugs: Set<string>; isWildcard: boolean }> {
    const cacheKey = this.key(userId, activeRoleId);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { slugs: cached.slugs, isWildcard: cached.isWildcard };
    }

    let userRoles: any[];
    if (activeRoleId) {
      userRoles = await this.prisma.user_roles.findMany({
        where: { user_id: userId, role_id: activeRoleId, status: 'ACTIVE', deleted_at: null },
        include: { roles: true },
      });
    } else {
      userRoles = await this.prisma.user_roles.findMany({
        where: { user_id: userId, status: 'ACTIVE', deleted_at: null },
        include: { roles: true },
        orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
      });
    }

    if (!userRoles.length) {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        include: { roles: true },
      });
      const role = user?.roles?.is_active ? user.roles : null;
      if (role) {
        const result = await this.collectForRoles([role]);
        this.store(cacheKey, result);
        return result;
      }
      const empty = { slugs: new Set<string>(), isWildcard: false };
      this.store(cacheKey, empty);
      return empty;
    }

    const roles = userRoles.map((ur) => ur.roles).filter((r: any) => r && r.is_active);
    const result = await this.collectForRoles(roles);
    this.store(cacheKey, result);
    return result;
  }

  private async collectForRoles(roles: any[]) {
    if (roles.some((r: any) => r.is_admin)) {
      return { slugs: new Set<string>(['*']), isWildcard: true };
    }
    const roleIds = roles.map((r: any) => r.id);
    if (!roleIds.length) {
      return { slugs: new Set<string>(), isWildcard: false };
    }
    const rows = await this.prisma.role_permissions.findMany({
      where: {
        role_id: { in: roleIds },
        permissions: { is_active: true, deleted_at: null },
      },
      include: { permissions: true },
    });
    const slugs = new Set<string>();
    for (const rp of rows) {
      if (rp.permissions?.slug) slugs.add(rp.permissions.slug);
    }
    return { slugs, isWildcard: false };
  }

  private store(key: string, value: { slugs: Set<string>; isWildcard: boolean }) {
    this.cache.set(key, {
      slugs: value.slugs,
      isWildcard: value.isWildcard,
      expiresAt: Date.now() + TTL_MS,
    });
  }

  hasSlug(effective: Set<string>, required: string): boolean {
    if (effective.has('*')) return true;
    if (effective.has(required)) return true;
    const dot = required.indexOf('.');
    if (dot > 0) {
      const moduleWildcard = required.substring(0, dot) + '.*';
      if (effective.has(moduleWildcard)) return true;
    }
    return false;
  }
}
