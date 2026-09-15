import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../schemas/user.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    private readonly jwt: JwtService,
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
    const payload = {
      sub: user.id,
      orgId: user.orgId.toString(),
      roleId: user.roleId.toString(),
      permissions: role?.permissions ?? [],
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        orgId: user.orgId.toString(),
        email: user.email,
        name: user.name,
        roleId: user.roleId.toString(),
        locale: user.locale,
        permissions: role?.permissions ?? [],
      },
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
      locale: user.locale,
      permissions: role?.permissions ?? [],
    };
  }
}
