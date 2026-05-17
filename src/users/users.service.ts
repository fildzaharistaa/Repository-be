import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, Role, UserRole, UserRoleStatus } from '../entities';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FoldersService } from '../folders/folders.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    @Inject(forwardRef(() => FoldersService))
    private foldersService: FoldersService,
  ) { }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });
  }

  async findAll(page: number = 1, limit: number = 10) {
    const [users, total] = await this.userRepository.findAndCount({
      relations: ['role', 'userRoles', 'userRoles.role'],
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    let unit = 'general';
    if (createUserDto.role_id) {
      const role = await this.roleRepository.findOne({ where: { id: createUserDto.role_id } });
      if (role) {
        unit = role.name.toLowerCase().substring(0, 50);
      }
    }

    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
      unit: unit,
    });

    const savedUser = await this.userRepository.save(user);

    // Auto-create primary UserRole junction record so PermissionCacheService can find it
    if (savedUser.role_id) {
      const existingUR = await this.userRoleRepository.findOne({
        where: { user_id: savedUser.id, role_id: savedUser.role_id, deleted_at: IsNull() },
      });
      if (!existingUR) {
        await this.userRoleRepository.save(
          this.userRoleRepository.create({
            user_id: savedUser.id,
            role_id: savedUser.role_id,
            is_primary: true,
            status: UserRoleStatus.ACTIVE,
            assigned_at: new Date(),
          }),
        );
      }
    }

    const userWithRole = await this.findOne(savedUser.id);

    return userWithRole;
  }

  async importExcel(usersData: any[]): Promise<{ success: number; failed: number; errors: any[] }> {
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    // Assuming we have basic string roles to matching role_ids
    const roles = await this.roleRepository.find();

    // Process sequentially to handle conflicts and hashes properly
    for (const data of usersData) {
      if (!data.name || !data.email) {
        failed++;
        errors.push({ email: data.email || 'Unknown', error: 'Missing name or email' });
        continue;
      }

      try {
        const existingUser = await this.findByEmail(data.email);
        if (existingUser) {
          failed++;
          errors.push({ email: data.email, error: 'User already exists' });
          continue;
        }

        const role = roles.find(r => r.name === (data.role || '').toLowerCase()) || roles.find(r => r.name === 'tendik');

        await this.create({
          email: data.email,
          name: data.name,
          password: data.password || 'password123', // Default password
          role_id: role ? role.id : undefined,
        });

        success++;
      } catch (err) {
        failed++;
        errors.push({ email: data.email, error: err.message });
      }
    }

    return { success, failed, errors };
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.findByEmail(updateUserDto.email);
      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // Handle role_id change: load the new Role entity
    // so TypeORM properly updates the relation
    if (updateUserDto.role_id && updateUserDto.role_id !== user.role_id) {
      const newRole = await this.roleRepository.findOne({
        where: { id: updateUserDto.role_id },
      });

      if (!newRole) {
        throw new NotFoundException(`Role with id ${updateUserDto.role_id} not found`);
      }

      user.role = newRole;
      user.role_id = updateUserDto.role_id;
      user.unit = newRole.name.toLowerCase().substring(0, 50);
    }

    // Apply remaining fields (name, password, etc.)
    const { role_id, ...otherFields } = updateUserDto;
    Object.assign(user, otherFields);
    5
    await this.userRepository.save(user);

    // Re-fetch to return consistent data with role relation
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}

