import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FoldersService } from '../folders/folders.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => FoldersService))
    private foldersService: FoldersService,
  ) {}

  async findOne(id: string) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: { roles: true, user_roles: { include: { roles: true } } },
    });

    if (!user) throw new NotFoundException('User not found');

    (user as any).role = user.roles;
    (user as any).userRoles = user.user_roles;
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.prisma.users.findUnique({
      where: { email },
      include: { roles: true },
    });
    if (user) (user as any).role = user.roles;
    return user;
  }

  async findAll(page: number = 1, limit: number = 10) {
    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        include: { roles: true, user_roles: { include: { roles: true } } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.users.count(),
    ]);

    const data = users.map((u) => {
      (u as any).role = u.roles;
      (u as any).userRoles = u.user_roles;
      return u;
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    let unit = 'general';
    if (createUserDto.role_id) {
      const role = await this.prisma.roles.findUnique({ where: { id: createUserDto.role_id } });
      if (role) unit = role.name.toLowerCase().substring(0, 50);
    }

    const savedUser = await this.prisma.users.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        unit,
      } as any,
    });

    if (savedUser.role_id) {
      const existingUR = await this.prisma.user_roles.findFirst({
        where: { user_id: savedUser.id, role_id: savedUser.role_id, deleted_at: null },
      });
      if (!existingUR) {
        await this.prisma.user_roles.create({
          data: {
            user_id: savedUser.id,
            role_id: savedUser.role_id,
            is_primary: true,
            status: 'ACTIVE',
            assigned_at: new Date(),
          },
        });
      }
    }

    return this.findOne(savedUser.id);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);

    const data: any = { ...updateUserDto };

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.findByEmail(updateUserDto.email);
      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    if (updateUserDto.role_id && updateUserDto.role_id !== user.role_id) {
      const newRole = await this.prisma.roles.findUnique({ where: { id: updateUserDto.role_id } });
      if (!newRole) throw new NotFoundException(`Role with id ${updateUserDto.role_id} not found`);
      data.unit = newRole.name.toLowerCase().substring(0, 50);
    }

    await this.prisma.users.update({ where: { id }, data });

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.users.delete({ where: { id } });
  }
}
