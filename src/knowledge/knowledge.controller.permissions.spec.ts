import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@pulsefeedback/shared';
import {
  ADMIN_PERMS,
  ANALYST_PERMS,
  EMPLOYEE_PERMS,
} from '../seed/role-permission-sets';
import { PermissionsGuard } from '../auth/permissions.guard';
import { KnowledgeController } from './knowledge.controller';

/**
 * Exercises the REAL PermissionsGuard against the REAL @RequirePermissions
 * metadata actually attached to KnowledgeController's methods — not a
 * generic guard unit test (that already exists in permissions.guard.spec.ts)
 * and not a mock of the guard's decision. This proves the specific
 * decorator placement on each of the 7 knowledge endpoints is correct, and
 * that the seeded Admin/Analyst/Employee permission sets produce the
 * intended allow/deny outcome per endpoint.
 */
function mockContext(
  handlerName: keyof KnowledgeController,
  permissions: PermissionKey[],
): ExecutionContext {
  return {
    getHandler: () => KnowledgeController.prototype[handlerName],
    getClass: () => KnowledgeController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());

const ENDPOINTS: { handler: keyof KnowledgeController; needs: PermissionKey }[] = [
  { handler: 'upload', needs: 'kb:write' },
  { handler: 'list', needs: 'kb:read' },
  { handler: 'getOne', needs: 'kb:read' },
  { handler: 'listChunks', needs: 'kb:read' },
  { handler: 'updateMetadata', needs: 'kb:write' },
  { handler: 'publish', needs: 'kb:publish' },
  { handler: 'archive', needs: 'kb:archive' },
  { handler: 'supersede', needs: 'kb:publish' },
  { handler: 'getAuditLog', needs: 'kb:read' },
  { handler: 'reprocess', needs: 'kb:write' },
  { handler: 'reindexEmbeddings', needs: 'kb:write' },
  { handler: 'delete', needs: 'kb:delete' },
  { handler: 'ingestWebPage', needs: 'kb:web_ingest' },
];

describe('KnowledgeController — real PermissionsGuard against real route metadata', () => {
  it.each(ENDPOINTS)('Admin can call $handler ($needs)', ({ handler }) => {
    expect(guard.canActivate(mockContext(handler, ADMIN_PERMS))).toBe(true);
  });

  it.each(ENDPOINTS.filter((e) => e.needs === 'kb:read'))(
    'Analyst (kb:read only) can call $handler',
    ({ handler }) => {
      expect(guard.canActivate(mockContext(handler, ANALYST_PERMS))).toBe(true);
    },
  );

  it.each(ENDPOINTS.filter((e) => e.needs !== 'kb:read'))(
    'Analyst (kb:read only) is blocked (403) from $handler, which needs $needs',
    ({ handler }) => {
      expect(() => guard.canActivate(mockContext(handler, ANALYST_PERMS))).toThrow(
        ForbiddenException,
      );
    },
  );

  it.each(ENDPOINTS)(
    'Employee (no kb:* permissions) is blocked (403) from $handler',
    ({ handler }) => {
      expect(() => guard.canActivate(mockContext(handler, EMPLOYEE_PERMS))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('a role with zero permissions is blocked from every endpoint', () => {
    for (const { handler } of ENDPOINTS) {
      expect(() => guard.canActivate(mockContext(handler, []))).toThrow(ForbiddenException);
    }
  });
});
