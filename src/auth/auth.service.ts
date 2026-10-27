import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { PermissionKey } from '@pulsefeedback/shared';
import { User, UserDocument } from '../schemas/user.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { LoginDto } from './dto/login.dto';
import { effectivePermissions } from './effective-permissions';

function roleKindOf(
  role: { kind?: string } | null,
): 'owner' | 'custom' | 'system' {
  return role?.kind === 'owner'
    ? 'owner'
    : role?.kind === 'custom'
      ? 'custom'
      : 'system';
}

type TokenPayload = {
  sub: string;
  orgId: string;
  roleId: string;
  permissions: PermissionKey[];
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ email: dto.email.toLowerCase() });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const role = await this.roles.findById(user.roleId);
    const permissions = effectivePermissions(role);
    const payload: TokenPayload = {
      sub: user.id,
      orgId: user.orgId.toString(),
      roleId: user.roleId.toString(),
      permissions,
    };

    return {
      accessToken: await this.signAccess(payload),
      refreshToken: await this.signRefresh(payload),
      user: {
        id: user.id,
        orgId: user.orgId.toString(),
        email: user.email,
        name: user.name,
        roleId: user.roleId.toString(),
        roleName: role?.name ?? null,
        roleKind: roleKindOf(role),
        locale: user.locale,
        permissions,
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const role = await this.roles.findById(user.roleId);
    const permissions = effectivePermissions(role);
    const next: TokenPayload = {
      sub: user.id,
      orgId: user.orgId.toString(),
      roleId: user.roleId.toString(),
      permissions,
    };

    return {
      accessToken: await this.signAccess(next),
      refreshToken: await this.signRefresh(next),
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    const role = await this.roles.findById(user.roleId);
    return {
      id: user.id,
      orgId: user.orgId.toString(),
      email: user.email,
      name: user.name,
      roleId: user.roleId.toString(),
      roleName: role?.name ?? null,
      roleKind: roleKindOf(role),
      locale: user.locale,
      permissions: effectivePermissions(role),
    };
  }

  private signAccess(payload: TokenPayload) {
    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>(
        'JWT_ACCESS_SECRET',
        'dev-access-secret-change-me',
      ),
      expiresIn: '8h',
    });
  }

  private signRefresh(payload: TokenPayload) {
    return this.jwt.signAsync(payload, {
      secret: this.refreshSecret(),
      expiresIn: '7d',
    });
  }

  private refreshSecret() {
    return this.config.get<string>(
      'JWT_REFRESH_SECRET',
      'dev-refresh-secret-change-me',
    );
  }
}
