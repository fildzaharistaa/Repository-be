import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class AdminPermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {}

  async create(dto: CreatePermissionDto, actorId?: string) {
    const existing = await this.prisma.permissions.findFirst({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Permission slug "${dto.slug}" already exists`);
    const saved = await this.prisma.permissions.create({
      data: {
        slug: dto.slug,
        module: dto.module,
        action: dto.action,
        submodule: dto.submodule ?? null,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category ?? null,
        visibility: dto.visibility ?? 'internal',
        is_active: dto.is_active ?? true,
        is_system: false,
        created_by: actorId ?? null,
        updated_by: actorId ?? null,
      },
    });
    this.cache.invalidateAll();
    return saved;
  }

  async findAll(filter?: { module?: string; category?: string; visibility?: string }) {
    return this.prisma.permissions.findMany({
      where: {
        deleted_at: null,
        ...(filter?.module ? { module: filter.module } : {}),
        ...(filter?.category ? { category: filter.category } : {}),
        ...(filter?.visibility ? { visibility: filter.visibility } : {}),
      },
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  async findGrouped() {
    const all = await this.findAll();
    const groups: Record<string, typeof all> = {};
    for (const p of all) {
      const key = p.category || p.module;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }

  async findOne(id: string) {
    const perm = await this.prisma.permissions.findFirst({ where: { id, deleted_at: null } });
    if (!perm) throw new NotFoundException(`Permission ${id} not found`);
    return perm;
  }

  async update(id: string, dto: UpdatePermissionDto, actorId?: string) {
    const perm = await this.findOne(id);
    const saved = await this.prisma.permissions.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        updated_by: actorId ?? perm.updated_by,
      },
    });
    this.cache.invalidateAll();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const perm = await this.findOne(id);
    if (perm.is_system) {
      throw new BadRequestException('Cannot delete a system permission');
    }
    await this.prisma.permissions.update({ where: { id }, data: { deleted_at: new Date() } });
    this.cache.invalidateAll();
  }
}
