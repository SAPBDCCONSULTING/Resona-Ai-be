import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@pulsefeedback/shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: { permissions?: PermissionKey[] };
    }>();
    const userPerms = req.user?.permissions ?? [];
    const ok = required.every((p) => userPerms.includes(p));
    if (!ok) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
