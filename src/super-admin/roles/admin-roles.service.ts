import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource } from 'typeorm';
import { Role, RolePermission } from '../../entities';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloneRoleDto } from './dto/clone-role.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class AdminRolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
    private readonly dataSource: DataSource,
    private readonly cache: PermissionCacheService,
  ) {}

  async create(dto: CreateRoleDto, actorId?: string): Promise<Role> {
    const existing = await this.roleRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Role with name "${dto.name}" already exists`);
    }
    const role = this.roleRepo.create({
      name: dto.name,
      description: dto.description ?? null as any,
      is_admin: dto.is_admin ?? false,
      is_active: dto.is_active ?? true,
      is_system: false,
      hierarchy_level: dto.hierarchy_level ?? 0,
      category: dto.category ?? null,
      color: dto.color ?? null,
      max_folder_depth: dto.max_folder_depth ?? null,
      is_private: dto.is_private ?? false,
      created_by: actorId ?? null,
      updated_by: actorId ?? null,
    });
    const saved = await this.roleRepo.save(role);
    this.cache.invalidateAll();
    return saved;
  }

  async findAll(options?: { includeInactive?: boolean; category?: string }) {
    const qb = this.roleRepo
      .createQueryBuilder('r')
      .where('r.deleted_at IS NULL')
      .orderBy('r.hierarchy_level', 'DESC')
      .addOrderBy('r.name', 'ASC');
    if (!options?.includeInactive) {
      qb.andWhere('r.is_active = true');
    }
    if (options?.category) {
      qb.andWhere('r.category = :category', { category: options.category });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id, deleted_at: IsNull() } });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async update(id: string, dto: UpdateRoleDto, actorId?: string): Promise<Role> {
    const role = await this.findOne(id);
    if (dto.name && dto.name !== role.name) {
      const dup = await this.roleRepo.findOne({ where: { name: dto.name } });
      if (dup) throw new ConflictException(`Role name "${dto.name}" already in use`);
      if (role.is_system) {
        throw new BadRequestException('Cannot rename a system role');
      }
      role.name = dto.name;
    }
    if (dto.description !== undefined) role.description = dto.description as any;
    if (dto.is_admin !== undefined) role.is_admin = dto.is_admin;
    if (dto.is_active !== undefined) role.is_active = dto.is_active;
    if (dto.hierarchy_level !== undefined) role.hierarchy_level = dto.hierarchy_level;
    if (dto.category !== undefined) role.category = dto.category;
    if (dto.color !== undefined) role.color = dto.color;
    if (dto.max_folder_depth !== undefined) role.max_folder_depth = dto.max_folder_depth;
    if (dto.is_private !== undefined) role.is_private = dto.is_private;
    role.updated_by = actorId ?? role.updated_by;
    const saved = await this.roleRepo.save(role);
    this.cache.invalidateAll();
    return saved;
  }

  async toggleActive(id: string, actorId?: string): Promise<Role> {
    const role = await this.findOne(id);
    role.is_active = !role.is_active;
    role.updated_by = actorId ?? role.updated_by;
    const saved = await this.roleRepo.save(role);
    this.cache.invalidateAll();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.is_system) {
      throw new BadRequestException('Cannot delete a system role');
    }
    await this.roleRepo.softDelete(id);
    this.cache.invalidateAll();
  }

  async clone(id: string, dto: CloneRoleDto, actorId?: string): Promise<Role> {
    const source = await this.findOne(id);
    const dup = await this.roleRepo.findOne({ where: { name: dto.newName } });
    if (dup) throw new ConflictException(`Role name "${dto.newName}" already in use`);

    return this.dataSource.transaction(async (manager) => {
      const cloned = manager.create(Role, {
        name: dto.newName,
        description: dto.description ?? source.description,
        is_admin: false,
        is_active: true,
        is_system: false,
        hierarchy_level: source.hierarchy_level,
        category: source.category,
        color: source.color,
        max_folder_depth: source.max_folder_depth,
        created_by: actorId ?? null,
        updated_by: actorId ?? null,
      });
      const saved = await manager.save(cloned);

      if (dto.copyPermissions !== false) {
        const sourcePerms = await manager.find(RolePermission, {
          where: { role_id: source.id },
        });
        if (sourcePerms.length) {
          const newRows = sourcePerms.map((sp) =>
            manager.create(RolePermission, {
              role_id: saved.id,
              permission_id: sp.permission_id,
              granted_by: actorId ?? null,
            }),
          );
          await manager.save(newRows);
        }
      }

      this.cache.invalidateAll();
      return saved;
    });
  }
}
