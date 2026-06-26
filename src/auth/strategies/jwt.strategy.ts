import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
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
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      include: { roles: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Compatibility shim: expose user.role for modules not yet migrated to Prisma
    (user as any).role = user.roles;

    if (payload?.active_role_id) {
      (user as any).active_role_id = payload.active_role_id;
      const activeRole = await this.prisma.roles.findUnique({
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
