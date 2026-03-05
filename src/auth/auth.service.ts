import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  // =========================
  // VALIDATE USER (LOCAL STRATEGY)
  // =========================
  async validateUser(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  // =========================
  // LOGIN
  // =========================
  async login(loginDto: LoginDto) {
    const user = await this.validateUser(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role?.name || '',
      role_id: user.role_id || '',
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  // =========================
  // REGISTER
  // =========================
  async register(data: any) {
    const { email, password, name, role_id, unit } = data;

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = this.userRepository.create({
      email,
      password: hashedPassword,
      name,
      role_id,
      unit,
    });

    const savedUser = await this.userRepository.save(newUser);

    return {
      message: 'User registered successfully',
      user: {
        id: savedUser.id,
        email: savedUser.email,
        name: savedUser.name,
        role_id: savedUser.role_id,
        unit: savedUser.unit,
      },
    };
  }
}