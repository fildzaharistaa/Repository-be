import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { roles } from '@prisma/client';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<roles[]> {
    return this.prisma.roles.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<roles> {
    const role = await this.prisma.roles.findUnique({
      where: { id },
    });

    if (!role) {
      throw new Error('Role not found');
    }

    return role;
  }

  async findByName(name: string): Promise<roles | null> {
    return this.prisma.roles.findUnique({
      where: { name },
    });
  }

  async updateRoleDepth(roleIds: string[], maxDepth: number): Promise<void> {
    if (roleIds.length === 0) return;
    await this.prisma.roles.updateMany({
      where: { id: { in: roleIds } },
      data: { max_folder_depth: maxDepth },
    });
  }
}
