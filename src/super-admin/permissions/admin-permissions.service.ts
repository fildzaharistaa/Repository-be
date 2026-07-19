import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Permission } from '../../entities';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionCacheService } from '../shared/permission-cache.service';

@Injectable()
export class AdminPermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly repo: Repository<Permission>,
    private readonly cache: PermissionCacheService,
  ) {}

  async create(dto: CreatePermissionDto, actorId?: string): Promise<Permission> {
    // Include soft-deleted rows: the DB's unique constraint on `slug` still blocks
    // a plain insert if a previously-deleted permission used the same slug.
    const existing = await this.repo.findOne({
      where: { slug: dto.slug },
      withDeleted: true,
    });

    if (existing && !existing.deleted_at) {
      throw new ConflictException(`Permission slug "${dto.slug}" already exists`);
    }

    if (existing && existing.deleted_at) {
      // Revive the previously soft-deleted permission instead of attempting a
      // duplicate insert (which would violate the unique slug constraint).
      Object.assign(existing, {
        module: dto.module,
        action: dto.action,
        submodule: dto.submodule ?? null,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category ?? null,
        visibility: dto.visibility ?? 'internal',
        is_active: dto.is_active ?? true,
        deleted_at: null,
        updated_by: actorId ?? null,
      });
      const revived = await this.repo.save(existing);
      this.cache.invalidateAll();
      return revived;
    }

    const perm = this.repo.create({
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
    });
    const saved = await this.repo.save(perm);
    this.cache.invalidateAll();
    return saved;
  }

  async findAll(filter?: { module?: string; category?: string; visibility?: string }) {
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.deleted_at IS NULL')
      .orderBy('p.module', 'ASC')
      .addOrderBy('p.action', 'ASC');
    if (filter?.module) qb.andWhere('p.module = :module', { module: filter.module });
    if (filter?.category) qb.andWhere('p.category = :category', { category: filter.category });
    if (filter?.visibility) qb.andWhere('p.visibility = :visibility', { visibility: filter.visibility });
    return qb.getMany();
  }

  async findGrouped() {
    const all = await this.findAll();
    const groups: Record<string, Permission[]> = {};
    for (const p of all) {
      const key = p.category || p.module;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }

  async findOne(id: string): Promise<Permission> {
    const perm = await this.repo.findOne({ where: { id, deleted_at: IsNull() } });
    if (!perm) throw new NotFoundException(`Permission ${id} not found`);
    return perm;
  }

  async update(id: string, dto: UpdatePermissionDto, actorId?: string): Promise<Permission> {
    const perm = await this.findOne(id);
    if (dto.name !== undefined) perm.name = dto.name;
    if (dto.description !== undefined) perm.description = dto.description;
    if (dto.category !== undefined) perm.category = dto.category;
    if (dto.visibility !== undefined) perm.visibility = dto.visibility;
    if (dto.is_active !== undefined) perm.is_active = dto.is_active;
    perm.updated_by = actorId ?? perm.updated_by;
    const saved = await this.repo.save(perm);
    this.cache.invalidateAll();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const perm = await this.findOne(id);
    if (perm.is_system) {
      throw new BadRequestException('Cannot delete a system permission');
    }
    await this.repo.softDelete(id);
    this.cache.invalidateAll();
  }
}
