import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@pulsefeedback/shared';
import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from '../seed/role-permission-sets';
import { PermissionsGuard } from '../auth/permissions.guard';
import { KnowledgeWebApprovalController } from './knowledge-web-approval.controller';

/**
 * Proves kb:web_manage — a separate, more sensitive permission from the
 * ordinary kb:* set — is the one actually gating every approval-management
 * endpoint, against the real route metadata (not a mock of the guard).
 */
function mockContext(
  handlerName: keyof KnowledgeWebApprovalController,
  permissions: PermissionKey[],
): ExecutionContext {
  return {
    getHandler: () => KnowledgeWebApprovalController.prototype[handlerName],
    getClass: () => KnowledgeWebApprovalController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());
const HANDLERS: (keyof KnowledgeWebApprovalController)[] = ['list', 'create', 'revoke'];

describe('KnowledgeWebApprovalController — real PermissionsGuard against real route metadata', () => {
  it.each(HANDLERS)('Admin (has kb:web_manage) can call %s', (handler) => {
    expect(guard.canActivate(mockContext(handler, ADMIN_PERMS))).toBe(true);
  });

  it.each(HANDLERS)('Analyst (kb:read only, no kb:web_manage) is blocked (403) from %s', (handler) => {
    expect(() => guard.canActivate(mockContext(handler, ANALYST_PERMS))).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('Employee is blocked (403) from %s', (handler) => {
    expect(() => guard.canActivate(mockContext(handler, EMPLOYEE_PERMS))).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('a role with only kb:web_ingest (not kb:web_manage) is still blocked from %s', (handler) => {
    expect(() => guard.canActivate(mockContext(handler, ['kb:web_ingest'] as PermissionKey[]))).toThrow(
      ForbiddenException,
    );
  });
});
