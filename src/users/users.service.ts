import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, Role } from '../entities';
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
    @Inject(forwardRef(() => FoldersService))
    private foldersService: FoldersService,
  ) {}

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
      relations: ['role'],
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
    const userWithRole = await this.findOne(savedUser.id);

    return userWithRole;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
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

