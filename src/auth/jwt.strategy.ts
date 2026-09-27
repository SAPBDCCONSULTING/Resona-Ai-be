import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { PermissionKey } from '@pulsefeedback/shared';

export type JwtPayload = {
  sub: string;
  orgId: string;
  roleId: string;
  permissions: PermissionKey[];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>(
        'JWT_ACCESS_SECRET',
        'dev-access-secret-change-me',
      ),
    });
  }

  validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      orgId: payload.orgId,
      roleId: payload.roleId,
      permissions: payload.permissions,
    };
  }
}
