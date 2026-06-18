import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { User } from '../../entities';
import { Role } from '../../entities/role.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          if (req.query && req.query.token) {
            return req.query.token as string;
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'default-secret-key',
    });
  }

   async validate(payload: any) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      relations: ['role'],
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Additive: expose active role context from JWT (set via /users/switch-role).
    // Does not alter user.role / user.role_id used by legacy code.
    // payload.role holds the active role name (updated by switch-role).
    // payload.active_role_id holds the active role UUID.
    if (payload?.active_role_id) {
      (user as any).active_role_id = payload.active_role_id;
      // Load the active role entity so is_admin can be checked downstream
      // (user.role is the primary role; active_role reflects the current session role)
      const activeRole = await this.roleRepository.findOne({
        where: { id: payload.active_role_id },
      });
      if (activeRole) (user as any).active_role = activeRole;
    }
    if (payload?.role) {
      (user as any).active_role_name = payload.role;
    }

    return user;
  }
}

