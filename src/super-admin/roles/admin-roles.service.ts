import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloneRoleDto } from './dto/clone-role.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {}

  async create(dto: CreateRoleDto, actorId?: string) {
    const existing = await this.prisma.roles.findFirst({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Role with name "${dto.name}" already exists`);
    }
    const saved = await this.prisma.roles.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
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
      },
    });
    this.cache.invalidateAll();
    return saved;
  }

  async findAll(options?: { includeInactive?: boolean; category?: string }) {
    return this.prisma.roles.findMany({
      where: {
        deleted_at: null,
        ...(!options?.includeInactive ? { is_active: true } : {}),
        ...(options?.category ? { category: options.category } : {}),
      },
      orderBy: [{ hierarchy_level: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.roles.findFirst({ where: { id, deleted_at: null } });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async update(id: string, dto: UpdateRoleDto, actorId?: string) {
    const role = await this.findOne(id);
    if (dto.name && dto.name !== role.name) {
      const dup = await this.prisma.roles.findFirst({ where: { name: dto.name } });
      if (dup) throw new ConflictException(`Role name "${dto.name}" already in use`);
      if (role.is_system) {
        throw new BadRequestException('Cannot rename a system role');
      }
    }
    const saved = await this.prisma.roles.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.is_admin !== undefined ? { is_admin: dto.is_admin } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        ...(dto.hierarchy_level !== undefined ? { hierarchy_level: dto.hierarchy_level } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.max_folder_depth !== undefined ? { max_folder_depth: dto.max_folder_depth } : {}),
        ...(dto.is_private !== undefined ? { is_private: dto.is_private } : {}),
        updated_by: actorId ?? role.updated_by,
      },
    });
    this.cache.invalidateAll();
    return saved;
  }

  async toggleActive(id: string, actorId?: string) {
    const role = await this.findOne(id);
    const saved = await this.prisma.roles.update({
      where: { id },
      data: { is_active: !role.is_active, updated_by: actorId ?? role.updated_by },
    });
    this.cache.invalidateAll();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.is_system) {
      throw new BadRequestException('Cannot delete a system role');
    }
    await this.prisma.roles.update({ where: { id }, data: { deleted_at: new Date() } });
    this.cache.invalidateAll();
  }

  async clone(id: string, dto: CloneRoleDto, actorId?: string) {
    const source = await this.findOne(id);
    const dup = await this.prisma.roles.findFirst({ where: { name: dto.newName } });
    if (dup) throw new ConflictException(`Role name "${dto.newName}" already in use`);

    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.roles.create({
        data: {
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
        },
      });

      if (dto.copyPermissions !== false) {
        const sourcePerms = await tx.role_permissions.findMany({
          where: { role_id: source.id },
        });
        if (sourcePerms.length) {
          await tx.role_permissions.createMany({
            data: sourcePerms.map((sp) => ({
              role_id: saved.id,
              permission_id: sp.permission_id,
              granted_by: actorId ?? null,
            })),
          });
        }
      }

      this.cache.invalidateAll();
      return saved;
    });
  }
}
