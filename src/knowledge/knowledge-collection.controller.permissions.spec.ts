import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@pulsefeedback/shared';
import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from '../seed/role-permission-sets';
import { PermissionsGuard } from '../auth/permissions.guard';
import { KnowledgeCollectionController } from './knowledge-collection.controller';

function mockContext(
  handlerName: keyof KnowledgeCollectionController,
  permissions: PermissionKey[],
): ExecutionContext {
  return {
    getHandler: () => KnowledgeCollectionController.prototype[handlerName],
    getClass: () => KnowledgeCollectionController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());

const ENDPOINTS: { handler: keyof KnowledgeCollectionController; needs: PermissionKey }[] = [
  { handler: 'list', needs: 'kb:read' },
  { handler: 'getOne', needs: 'kb:read' },
  { handler: 'create', needs: 'kb:collections_manage' },
  { handler: 'update', needs: 'kb:collections_manage' },
  { handler: 'archive', needs: 'kb:collections_manage' },
];

describe('KnowledgeCollectionController — real PermissionsGuard against real route metadata', () => {
  it.each(ENDPOINTS)('Admin can call $handler ($needs)', ({ handler }) => {
    expect(guard.canActivate(mockContext(handler, ADMIN_PERMS))).toBe(true);
  });

  it('Analyst (kb:read only) can read but cannot manage collections', () => {
    expect(guard.canActivate(mockContext('list', ANALYST_PERMS))).toBe(true);
    expect(guard.canActivate(mockContext('getOne', ANALYST_PERMS))).toBe(true);
    for (const handler of ['create', 'update', 'archive'] as const) {
      expect(() => guard.canActivate(mockContext(handler, ANALYST_PERMS))).toThrow(ForbiddenException);
    }
  });

  it.each(ENDPOINTS)('Employee is blocked (403) from $handler', ({ handler }) => {
    expect(() => guard.canActivate(mockContext(handler, EMPLOYEE_PERMS))).toThrow(ForbiddenException);
  });

  it('a role with kb:read but not kb:collections_manage still cannot create/update/archive', () => {
    for (const handler of ['create', 'update', 'archive'] as const) {
      expect(() => guard.canActivate(mockContext(handler, ['kb:read'] as PermissionKey[]))).toThrow(
        ForbiddenException,
      );
    }
  });
});
