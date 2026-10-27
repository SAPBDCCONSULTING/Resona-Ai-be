import { ConfigService } from '@nestjs/config';
import { JwtStrategy, type JwtPayload } from './jwt.strategy';

/**
 * Documents a deliberate, load-bearing design trait that explains a real
 * support scenario: after the kb:* permissions backfill migration grants
 * new permissions to a role, a browser holding an access token issued
 * BEFORE that migration ran will keep getting 403 on kb:*-gated endpoints
 * until the user re-authenticates (logs out/in, or the token is
 * reissued) — even though GET /api/auth/me (a separate code path that
 * does re-read the role fresh from the DB on every call) correctly shows
 * the new permissions in the meantime. This is not a bug: JwtStrategy
 * never re-reads the database per request — req.user.permissions, which
 * PermissionsGuard enforces against, comes directly from whatever
 * permissions were embedded in the JWT payload at the moment it was
 * signed (see auth.service.ts's signAccess/TokenPayload). If this ever
 * changed to a fresh DB lookup per request, that would be a deliberate
 * architecture change (trading JWT statelessness for always-live
 * permissions) — not something a future refactor should do by accident.
 */
describe('JwtStrategy.validate — permissions come from the token payload, never a fresh DB read', () => {
  function makeStrategy(): JwtStrategy {
    const config = {
      get: jest.fn().mockReturnValue('dev-access-secret-change-me'),
    } as unknown as ConfigService;
    return new JwtStrategy(config);
  }

  it('returns exactly the permissions embedded in the payload, unchanged', () => {
    const strategy = makeStrategy();
    const payload: JwtPayload = {
      sub: 'user-1',
      orgId: 'org-1',
      roleId: 'role-1',
      permissions: ['sessions:read', 'kb:read'],
    };

    const result = strategy.validate(payload);

    expect(result.permissions).toEqual(['sessions:read', 'kb:read']);
    expect(result).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      roleId: 'role-1',
      permissions: ['sessions:read', 'kb:read'],
    });
  });

  it('returns an empty permissions array as-is when the token predates a permission grant — never upgraded in-flight', () => {
    const strategy = makeStrategy();
    const stalePayload: JwtPayload = {
      sub: 'user-1',
      orgId: 'org-1',
      roleId: 'role-1',
      permissions: [], // e.g. issued before a backfill migration granted kb:read to this role
    };

    const result = strategy.validate(stalePayload);

    // The whole point: validate() has no way to know the role's CURRENT
    // permissions changed — it only ever sees what the token itself
    // carries. A stale token stays stale until it is reissued.
    expect(result.permissions).toEqual([]);
  });
});
