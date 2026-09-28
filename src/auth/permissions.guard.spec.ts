import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard, PERMISSIONS_KEY } from './permissions.guard';

function mockContext(user?: { permissions?: string[] }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const guard = new PermissionsGuard(reflector as unknown as Reflector);

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
  });

  it('allows when no permissions required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('allows when user has required permission', () => {
    reflector.getAllAndOverride.mockReturnValue(['sessions:write']);
    expect(
      guard.canActivate(
        mockContext({ permissions: ['sessions:read', 'sessions:write'] }),
      ),
    ).toBe(true);
  });

  it('returns 403 when permission is missing', () => {
    reflector.getAllAndOverride.mockReturnValue(['sessions:write']);
    expect(() =>
      guard.canActivate(mockContext({ permissions: ['sessions:read'] })),
    ).toThrow(ForbiddenException);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      PERMISSIONS_KEY,
      expect.any(Array),
    );
  });
});
