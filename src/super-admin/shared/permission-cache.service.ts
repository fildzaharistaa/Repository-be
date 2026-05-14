import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UserRole, UserRoleStatus, Role, RolePermission } from '../../entities';

const TTL_MS = 60_000;

interface CacheEntry {
  slugs: Set<string>;
  isWildcard: boolean;
  expiresAt: number;
}

/**
 * In-memory TTL cache for effective permissions per (userId, activeRoleId).
 * Invalidated explicitly by services on assign/remove/suspend/reactivate.
 *
 * Wildcards:
 *  - role.is_admin = true  → effective Set has '*'
 *  - permission slug 'module.*' → matches any action under that module
 */
@Injectable()
export class PermissionCacheService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  private key(userId: string, activeRoleId: string | null | undefined) {
    return `${userId}::${activeRoleId ?? 'primary'}`;
  }

  invalidateUser(userId: string) {
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${userId}::`)) this.cache.delete(k);
    }
  }

  invalidateRole(roleId: string) {
    // permission set of a role changed → blow whole cache (cheap, low scale)
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

    // Determine which UserRole(s) drive the active permission set.
    // If activeRoleId provided → use that one (must be ACTIVE).
    // Else → use ACTIVE primary; fallback to any ACTIVE.
    let userRoles: UserRole[];
    if (activeRoleId) {
      userRoles = await this.userRoleRepo.find({
        where: {
          user_id: userId,
          role_id: activeRoleId,
          status: UserRoleStatus.ACTIVE,
          deleted_at: IsNull(),
        },
        relations: ['role'],
      });
    } else {
      userRoles = await this.userRoleRepo.find({
        where: {
          user_id: userId,
          status: UserRoleStatus.ACTIVE,
          deleted_at: IsNull(),
        },
        relations: ['role'],
        order: { is_primary: 'DESC', assigned_at: 'ASC' },
      });
    }

    if (!userRoles.length) {
      // No active UserRole junction record (e.g. legacy user not backfilled).
      // Fall back to legacy single role for backwards compatibility.
      const role = await this.roleRepo
        .createQueryBuilder('r')
        .innerJoin('users', 'u', 'u.role_id = r.id')
        .where('u.id = :userId', { userId })
        .andWhere('r.is_active = true')
        .getOne();
      if (role) {
        const result = await this.collectForRoles([role]);
        this.store(cacheKey, result);
        return result;
      }
      const empty = { slugs: new Set<string>(), isWildcard: false };
      this.store(cacheKey, empty);
      return empty;
    }

    const roles = userRoles.map((ur) => ur.role).filter((r) => r && r.is_active);
    const result = await this.collectForRoles(roles);
    this.store(cacheKey, result);
    return result;
  }

  private async collectForRoles(roles: Role[]) {
    if (roles.some((r) => r.is_admin)) {
      return { slugs: new Set<string>(['*']), isWildcard: true };
    }
    const roleIds = roles.map((r) => r.id);
    if (!roleIds.length) {
      return { slugs: new Set<string>(), isWildcard: false };
    }
    const rows = await this.rolePermissionRepo
      .createQueryBuilder('rp')
      .innerJoinAndSelect('rp.permission', 'p')
      .where('rp.role_id IN (:...roleIds)', { roleIds })
      .andWhere('p.is_active = true')
      .andWhere('p.deleted_at IS NULL')
      .getMany();
    const slugs = new Set<string>();
    for (const rp of rows) {
      if (rp.permission?.slug) slugs.add(rp.permission.slug);
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

  /**
   * Check whether the effective set satisfies a required slug.
   * Supports wildcards: '*' (super admin) and 'module.*' (full module).
   */
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
