import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@pulsefeedback/shared';
import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from '../seed/role-permission-sets';
import { PermissionsGuard } from '../auth/permissions.guard';
import { KnowledgeFeedbackController } from './knowledge-feedback.controller';

function mockContext(
  handlerName: keyof KnowledgeFeedbackController,
  permissions: PermissionKey[],
): ExecutionContext {
  return {
    getHandler: () => KnowledgeFeedbackController.prototype[handlerName],
    getClass: () => KnowledgeFeedbackController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());

const ENDPOINTS: { handler: keyof KnowledgeFeedbackController; needs: PermissionKey }[] = [
  { handler: 'submit', needs: 'ai:use' },
  { handler: 'list', needs: 'ai:use' },
  { handler: 'resolve', needs: 'ai:use' },
];

describe('KnowledgeFeedbackController — real PermissionsGuard against real route metadata', () => {
  it.each(ENDPOINTS)('Admin can call $handler ($needs)', ({ handler }) => {
    expect(guard.canActivate(mockContext(handler, ADMIN_PERMS))).toBe(true);
  });

  it.each(ENDPOINTS)('Analyst (no ai:use) is blocked (403) from $handler', ({ handler }) => {
    expect(() => guard.canActivate(mockContext(handler, ANALYST_PERMS))).toThrow(ForbiddenException);
  });

  it.each(ENDPOINTS)(
    'Employee can call $handler — ai:use was added so employees can submit/see their own AI-answer feedback',
    ({ handler }) => {
      expect(guard.canActivate(mockContext(handler, EMPLOYEE_PERMS))).toBe(true);
    },
  );

  it('kb:feedback_manage alone (without ai:use) is still not enough to pass the route guard', () => {
    for (const handler of ['submit', 'list', 'resolve'] as const) {
      expect(() =>
        guard.canActivate(mockContext(handler, ['kb:feedback_manage'] as PermissionKey[])),
      ).toThrow(ForbiddenException);
    }
  });
});
