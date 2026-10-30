import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { PermissionKey } from '@pulsefeedback/shared';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { effectivePermissions } from './effective-permissions';

export type JwtPayload = {
  sub: string;
  orgId: string;
  roleId: string;
  permissions: PermissionKey[];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>(
        'JWT_ACCESS_SECRET',
        'dev-access-secret-change-me',
      ),
    });
  }

  /**
   * The token only proves WHO the caller is. Organization, role and permissions are re-read from
   * the database on every request, so a demoted, re-assigned or deleted user loses access
   * immediately instead of keeping the permissions baked into an 8-hour token.
   */
  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub).lean();
    if (!user) throw new UnauthorizedException();
    const role = await this.roles
      .findOne({ _id: user.roleId, orgId: user.orgId })
      .lean();
    if (!role) throw new UnauthorizedException();
    return {
      userId: String(user._id),
      orgId: String(user.orgId),
      roleId: String(user.roleId),
      permissions: effectivePermissions(role),
    };
  }
}
