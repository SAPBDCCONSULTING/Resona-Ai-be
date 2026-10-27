import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { CustomRoleItem } from '@pulsefeedback/shared';
import { AuthModule } from '../auth/auth.module';
import { OWNER_LEGACY_PERMISSIONS } from '../roles/owner-role';
import { RolesModule } from '../roles/roles.module';
import {
  Organization,
  OrganizationSchema,
} from '../schemas/organization.schema';
import {
  RbacAuditEvent,
  RbacAuditEventDocument,
} from '../schemas/rbac-audit-event.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import {
  DEV_ORG,
  DEV_USERS,
  assertSafeEnvironment,
  seedDevFixtures,
  type FixtureDeps,
} from './dev-fixtures';
import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from './system-roles';

describe('assertSafeEnvironment', () => {
  it('refuses production and non-local databases, allows local ones', () => {
    expect(() =>
      assertSafeEnvironment(
        { NODE_ENV: 'production' },
        'mongodb://127.0.0.1/x',
      ),
    ).toThrow(/production/);
    expect(() =>
      assertSafeEnvironment({}, 'mongodb://db.example.com/x'),
    ).toThrow(/non-local/);
    expect(() =>
      assertSafeEnvironment({}, 'mongodb+srv://u:p@cluster0.mongodb.net/x'),
    ).toThrow(/non-local/);
    expect(() => assertSafeEnvironment({}, 'not a uri')).toThrow(/valid URI/);
    expect(() =>
      assertSafeEnvironment({}, 'mongodb://127.0.0.1:27017/resona'),
    ).not.toThrow();
    expect(() =>
      assertSafeEnvironment({}, 'mongodb://localhost/resona'),
    ).not.toThrow();
    expect(() =>
      assertSafeEnvironment({}, 'mongodb://mongo:27017/resona'),
    ).not.toThrow();
  });

  it('even --allow-remote cannot override production', () => {
    expect(() =>
      assertSafeEnvironment(
        { NODE_ENV: 'production' },
        'mongodb://db.example.com/x',
        true,
      ),
    ).toThrow(/production/);
    expect(() =>
      assertSafeEnvironment({}, 'mongodb://db.example.com/x', true),
    ).not.toThrow();
  });
});

describe('system role definitions', () => {
  it('match the permission sets the application seed uses', () => {
    const { readFileSync } =
      jest.requireActual<typeof import('node:fs')>('node:fs');
    const text = readFileSync(`${__dirname}/seed.service.ts`, 'utf8');
    const read = (name: string) =>
      [
        ...(
          text.match(
            new RegExp(`const ${name}[^=]*= \\[([\\s\\S]*?)\\];`),
          )?.[1] ?? ''
        ).matchAll(/'([^']+)'/g),
      ].map((m) => m[1]);
    expect(ADMIN_PERMS).toEqual(read('ADMIN_PERMS'));
    expect(ANALYST_PERMS).toEqual(read('ANALYST_PERMS'));
    expect(EMPLOYEE_PERMS).toEqual(read('EMPLOYEE_PERMS'));
  });
});

const BASE_URI = process.env.RBAC_TEST_MONGODB_URI;
const suite = BASE_URI ? describe : describe.skip;
const PASSWORD = 'dev-fixture-password-1';

suite('dev fixtures + all four system roles — integration', () => {
  const dbName = `resona_rbac_test_${Math.random().toString(36).slice(2, 10)}`;
  let app: INestApplication<App>;
  let connection: Connection;
  let roles: Model<RoleDocument>;
  let users: Model<UserDocument>;
  let audit: Model<RbacAuditEventDocument>;
  let orgs: Model<Organization>;
  let jwt: JwtService;
  const tokens: Record<string, string> = {};
  const email = (k: string) => `${k}.test@rbac-dev.local`;
  const deps = (): FixtureDeps => ({
    orgs: orgs as never,
    roles: roles as never,
    users: users as never,
    audit: audit as never,
  });
  const seed = (extra: { resetPasswords?: boolean; password?: string } = {}) =>
    seedDevFixtures(deps(), { password: PASSWORD, operator: 'ci', ...extra });

  const auth = (r: request.Test, who?: string) =>
    who ? r.set('Authorization', `Bearer ${tokens[who]}`) : r;
  const get = (p: string, who?: string) =>
    auth(request(app.getHttpServer()).get(p), who);
  const post = (p: string, b: unknown, who?: string) =>
    auth(
      request(app.getHttpServer())
        .post(p)
        .send(b as object),
      who,
    );
  const patch = (p: string, b: unknown, who?: string) =>
    auth(
      request(app.getHttpServer())
        .patch(p)
        .send(b as object),
      who,
    );
  const login = async (e: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: e, password });

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-only-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-only-refresh-secret';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(`${BASE_URI}/${dbName}`),
        AuthModule,
        RolesModule,
        UsersModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    roles = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    users = app.get<Model<UserDocument>>(getModelToken(User.name));
    audit = app.get<Model<RbacAuditEventDocument>>(
      getModelToken(RbacAuditEvent.name),
    );
    jwt = app.get(JwtService);
    orgs = connection.model<Organization>(
      Organization.name,
      OrganizationSchema,
    );
    await roles.syncIndexes();
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  describe('fixture creation', () => {
    let realUserBefore: unknown;

    it('creates the test organization, roles and five accounts without touching other data', async () => {
      const otherOrg = new Types.ObjectId();
      const realRole = await roles.create({
        orgId: otherOrg,
        name: 'Admin',
        permissions: ['org:read'],
      });
      const real = await users.create({
        orgId: otherOrg,
        email: 'real.person@company.test',
        name: 'Real',
        passwordHash: await bcrypt.hash('their-own-password', 4),
        roleId: realRole._id,
      });
      realUserBefore = await users.findById(real._id).lean();

      const results = await seed();
      expect(results.map((r) => r.email)).toEqual(
        DEV_USERS.map((u) => u.email),
      );
      expect(results.every((r) => r.created)).toBe(true);

      const org = await orgs.findOne({ slug: DEV_ORG.slug }).lean();
      expect(org).not.toBeNull();
      expect(await users.countDocuments({ orgId: org?._id })).toBe(5);
      expect(
        await roles.countDocuments({ orgId: org?._id, kind: 'owner' }),
      ).toBe(1);
      expect(await users.findById(real._id).lean()).toEqual(realUserBefore);
      expect(await roles.countDocuments({ orgId: otherOrg })).toBe(1);
    });

    it('promotes exactly the Owner account, through the audited bootstrap', async () => {
      const org = await orgs.findOne({ slug: DEV_ORG.slug }).lean();
      const ownerRole = await roles
        .findOne({ orgId: org?._id, kind: 'owner' })
        .lean();
      expect(await users.countDocuments({ roleId: ownerRole?._id })).toBe(1);
      expect((await users.findOne({ email: email('owner') }))?.roleId).toEqual(
        ownerRole?._id,
      );
      expect(
        await audit.countDocuments({
          action: 'owner.bootstrap',
          actorLabel: 'ci',
        }),
      ).toBe(1);
    });

    it('is repeatable: a second run changes nothing and does not touch passwords', async () => {
      const before = await users
        .find({ email: /rbac-dev\.local$/ })
        .sort({ email: 1 })
        .lean();
      const results = await seed({ password: 'a-different-password-9' });
      expect(results.every((r) => !r.created && !r.passwordReset)).toBe(true);
      const after = await users
        .find({ email: /rbac-dev\.local$/ })
        .sort({ email: 1 })
        .lean();
      expect(after).toEqual(before);
      expect((await login(email('owner'), PASSWORD)).status).toBe(201);
    });

    it('resets passwords only when asked', async () => {
      const results = await seed({
        password: 'reset-password-value-1',
        resetPasswords: true,
      });
      expect(results.every((r) => r.passwordReset)).toBe(true);
      expect((await login(email('owner'), PASSWORD)).status).toBe(401);
      expect(
        (await login(email('owner'), 'reset-password-value-1')).status,
      ).toBe(201);
      await seed({ password: PASSWORD, resetPasswords: true });
    });

    it('refuses weak passwords and emails that belong to another organization', async () => {
      await expect(seed({ password: 'short' })).rejects.toThrow(/at least 12/);
      await users.updateOne(
        { email: email('analyst') },
        { $set: { orgId: new Types.ObjectId() } },
      );
      await expect(seed()).rejects.toThrow(/another organization/);
      const org = await orgs.findOne({ slug: DEV_ORG.slug }).lean();
      await users.updateOne(
        { email: email('analyst') },
        { $set: { orgId: org?._id } },
      );
    });

    it('uses real bcrypt hashes and stores no plaintext', async () => {
      const u = await users.findOne({ email: email('admin') }).lean();
      expect(u?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(JSON.stringify(u)).not.toContain(PASSWORD);
    });
  });

  describe('sign-in for every test account', () => {
    it('each of the four system roles (and the custom-role user) signs in as themselves', async () => {
      const expected: Record<
        string,
        { roleName: string; roleKind: string; permissions: string[] }
      > = {
        owner: {
          roleName: 'Owner',
          roleKind: 'owner',
          permissions: OWNER_LEGACY_PERMISSIONS,
        },
        admin: {
          roleName: 'Admin',
          roleKind: 'system',
          permissions: ADMIN_PERMS,
        },
        analyst: {
          roleName: 'Analyst',
          roleKind: 'system',
          permissions: ANALYST_PERMS,
        },
        employee: {
          roleName: 'Employee',
          roleKind: 'system',
          permissions: EMPLOYEE_PERMS,
        },
        custom: {
          roleName: 'Employee',
          roleKind: 'system',
          permissions: EMPLOYEE_PERMS,
        },
      };
      for (const [key, want] of Object.entries(expected)) {
        const res = await login(email(key));
        expect(res.status).toBe(201);
        const body = res.body as {
          accessToken: string;
          user: Record<string, unknown>;
        };
        tokens[key] = body.accessToken;
        expect(body.user).toMatchObject({ email: email(key), ...want });
        const me = (await get('/api/auth/me', key).expect(200)).body as Record<
          string,
          unknown
        >;
        expect(me).toMatchObject({ email: email(key), ...want });
        expect(JSON.stringify(body)).not.toContain('passwordHash');
      }
    });
  });

  describe('system-role matrix on the role / user routes', () => {
    const ok = [200, 201];
    const status = async (
      who: string,
      method: 'get' | 'post' | 'patch',
      path: string,
      body?: unknown,
    ) =>
      (method === 'get'
        ? await get(path, who)
        : method === 'post'
          ? await post(path, body, who)
          : await patch(path, body, who)
      ).status;

    it('Owner: full access, including creating a custom role', async () => {
      expect(ok).toContain(await status('owner', 'get', '/api/users'));
      expect(ok).toContain(
        await status('owner', 'get', '/api/users/assignable-roles'),
      );
      expect(ok).toContain(await status('owner', 'get', '/api/roles'));
      expect(ok).toContain(await status('owner', 'get', '/api/roles/profiles'));
      const list = (await get('/api/roles/custom', 'owner').expect(200))
        .body as { canCreate: boolean };
      expect(list.canCreate).toBe(true);
      const res = await post(
        '/api/roles/custom',
        {
          name: 'Directory Viewer',
          description: 'Reads users and roles',
          grants: ['users.read', 'roles.read'],
        },
        'owner',
      ).expect(201);
      expect((res.body as CustomRoleItem).name).toBe('Directory Viewer');
    });

    it('Admin: legacy admin access, but cannot create roles until an Owner delegates grants', async () => {
      expect(ok).toContain(await status('admin', 'get', '/api/users'));
      expect(ok).toContain(await status('admin', 'get', '/api/roles'));
      const list = (await get('/api/roles/custom', 'admin').expect(200))
        .body as { canCreate: boolean; createBlockedReason: string };
      expect(list.canCreate).toBe(false);
      expect(list.createBlockedReason).toMatch(/Owner/);
      expect(
        await status('admin', 'post', '/api/roles/custom', {
          name: 'Nope',
          description: 'd',
          grants: ['users.read'],
        }),
      ).toBe(403);
    });

    it('Analyst and Employee: no user/role administration at all', async () => {
      for (const who of ['analyst', 'employee']) {
        for (const p of [
          '/api/users',
          '/api/users/assignable-roles',
          '/api/roles',
          '/api/roles/profiles',
          '/api/roles/custom',
        ]) {
          expect(await status(who, 'get', p)).toBe(403);
        }
        expect(
          await status(who, 'post', '/api/roles/custom', {
            name: 'Nope',
            description: 'd',
            grants: ['users.read'],
          }),
        ).toBe(403);
        expect(
          await status(
            who,
            'patch',
            `/api/users/${new Types.ObjectId().toString()}/role`,
            { roleId: new Types.ObjectId().toString() },
          ),
        ).toBe(403);
        expect(
          await status(who, 'patch', '/api/roles/profiles/admin/grants', {
            grants: [],
            expectedVersion: 0,
          }),
        ).toBe(403);
      }
    });

    it('unauthenticated requests are 401 everywhere', async () => {
      for (const p of [
        '/api/users',
        '/api/roles',
        '/api/roles/custom',
        '/api/roles/profiles',
        '/api/auth/me',
      ]) {
        expect(await status('nobody', 'get', p)).toBe(401);
      }
    });
  });

  describe('the manager demo: create → assign → sign in → revoke', () => {
    it('Owner assigns the custom role; the user gets exactly users.read + roles.read', async () => {
      const roleId = (await roles.findOne({ name: 'Directory Viewer' }))!
        .id as string;
      const user = await users.findOne({ email: email('custom') });
      const res = await patch(
        `/api/users/${user!.id as string}/role`,
        { roleId },
        'owner',
      ).expect(200);
      expect(res.body).toMatchObject({
        roleName: 'Directory Viewer',
        roleKind: 'custom',
      });

      tokens.custom = (
        (await login(email('custom'))).body as { accessToken: string }
      ).accessToken;
      const me = (await get('/api/auth/me', 'custom').expect(200)).body as {
        permissions: string[];
        roleName: string;
        roleKind: string;
      };
      expect(me).toMatchObject({
        roleName: 'Directory Viewer',
        roleKind: 'custom',
      });
      expect(me.permissions.sort()).toEqual(['roles:read', 'users:read']);

      await get('/api/users', 'custom').expect(200);
      await get('/api/roles', 'custom').expect(200);
      await get('/api/roles/custom', 'custom').expect(200);
      // Denied without their effective permissions — via the API, not the UI.
      await get('/api/users/assignable-roles', 'custom').expect(403);
      await post(
        '/api/roles/custom',
        { name: 'Escalate', description: 'd', grants: ['users.read'] },
        'custom',
      ).expect(403);
      await patch(
        `/api/users/${user!.id as string}/role`,
        { roleId: (await roles.findOne({ kind: 'owner' }))!.id as string },
        'custom',
      ).expect(403);
      await patch(
        `/api/roles/custom/${roleId}`,
        {
          name: 'Hacked',
          description: 'd',
          grants: ['users.read'],
          expectedVersion: 1,
        },
        'custom',
      ).expect(403);
    });

    it('revoking users.read blocks the next request on the still-authenticated session', async () => {
      const role = await roles.findOne({ name: 'Directory Viewer' });
      await get('/api/users', 'custom').expect(200);
      await patch(
        `/api/roles/custom/${role!.id as string}`,
        {
          name: 'Directory Viewer',
          description: 'Reads users and roles',
          grants: ['roles.read'],
          expectedVersion: role!.version,
        },
        'owner',
      ).expect(200);
      await get('/api/users', 'custom').expect(403);
      await get('/api/roles', 'custom').expect(200); // roles.read is still granted
      const me = (await get('/api/auth/me', 'custom').expect(200)).body as {
        permissions: string[];
      };
      expect(me.permissions).toEqual(['roles:read']);
    });

    it('forged grants in a request body or token are ignored', async () => {
      await get('/api/users?permissions=users:read', 'custom').expect(403);
      const forged = await jwt.signAsync(
        {
          sub: (await users.findOne({ email: email('custom') }))!.id as string,
          permissions: ['users:read', 'roles:write'],
        },
        { secret: 'test-only-access-secret' },
      );
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${forged}`)
        .expect(403);
    });
  });
});
