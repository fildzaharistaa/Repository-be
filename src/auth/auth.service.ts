import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.users.findUnique({
      where: { email },
      include: { roles: true },
    });

    if (!user) return null;

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return null;

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.roles?.name || '',
      role_id: user.role_id || '',
      active_role_id: user.role_id || undefined,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roles,
      },
    };
  }

  async register(data: any) {
    const { email, password, name, unit } = data;

    const existingUser = await this.prisma.users.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const role = await this.prisma.roles.findUnique({ where: { name: unit } });
    if (!role) {
      throw new BadRequestException('Role not found for this unit');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const savedUser = await this.prisma.users.create({
      data: {
        email,
        password: hashedPassword,
        name,
        unit,
        role_id: role.id,
      },
    });

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
