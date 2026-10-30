import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import type {
  RoleProfileItem,
  RoleProfilesResponse,
} from '@pulsefeedback/shared';
import { AuthModule } from '../auth/auth.module';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { RolesModule } from './roles.module';

/**
 * Integration tests against a REAL MongoDB with the real JwtAuthGuard / PermissionsGuard.
 *
 * Runs only when RBAC_TEST_MONGODB_URI is set (e.g. mongodb://127.0.0.1:27018 — a disposable
 * container, NOT the shared dev database). Each run uses its own throwaway database
 * (resona_rbac_test_<random>) which is dropped at the end. Otherwise the suite is skipped.
 */
const BASE_URI = process.env.RBAC_TEST_MONGODB_URI;
const suite = BASE_URI ? describe : describe.skip;

const ADMIN_PERMS = [
  'org:read',
  'org:write',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  'contacts:read',
  'contacts:write',
  'contacts:import',
  'sessions:read',
  'sessions:write',
  'sessions:launch',
  'sessions:archive',
  'campaigns:read',
  'campaigns:write',
  'templates:read',
  'templates:write',
  'reports:read',
  'reports:export',
  'ai:use',
  'settings:read',
  'settings:write',
];
const ANALYST_PERMS = [
  'org:read',
  'contacts:read',
  'sessions:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'settings:read',
];
const EMPLOYEE_PERMS = ['sessions:read', 'responses:write'];
const PASSWORD = 'test-password-123';

suite('Role profiles (granular grants) — integration', () => {
  const dbName = `resona_rbac_test_${Math.random().toString(36).slice(2, 10)}`;
  let app: INestApplication<App>;
  let connection: Connection;
  let roles: Model<RoleDocument>;
  let users: Model<UserDocument>;

  const orgA = new Types.ObjectId();
  const orgB = new Types.ObjectId();
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function seed() {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const mk = async (
      orgId: Types.ObjectId,
      name: string,
      permissions: string[],
    ) => roles.create({ orgId, name, permissions: permissions as never });
    const aAdmin = await mk(orgA, 'Admin', ADMIN_PERMS);
    const aAnalyst = await mk(orgA, 'Analyst', ANALYST_PERMS);
    const aEmployee = await mk(orgA, 'Employee', EMPLOYEE_PERMS);
    const bAdmin = await mk(orgB, 'Admin', ADMIN_PERMS);
    Object.assign(ids, {
      aAdminRole: String(aAdmin._id),
      aAnalystRole: String(aAnalyst._id),
      aEmployeeRole: String(aEmployee._id),
      bAdminRole: String(bAdmin._id),
    });
    const mkUser = async (
      orgId: Types.ObjectId,
      email: string,
      roleId: Types.ObjectId,
    ) =>
      users.create({
        orgId,
        email,
        name: email.split('@')[0],
        passwordHash: hash,
        roleId,
        locale: 'en',
      });
    const ua = await mkUser(orgA, 'admin@a.test', aAdmin._id);
    const un = await mkUser(orgA, 'analyst@a.test', aAnalyst._id);
    const ue = await mkUser(orgA, 'employee@a.test', aEmployee._id);
    await mkUser(orgB, 'admin@b.test', bAdmin._id);
    Object.assign(ids, {
      aAdminUser: String(ua._id),
      aAnalystUser: String(un._id),
      aEmployeeUser: String(ue._id),
    });
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }

  const get = (path: string, who?: string) => {
    const r = request(app.getHttpServer()).get(path);
    return who ? r.set('Authorization', `Bearer ${tokens[who]}`) : r;
  };
  const patch = (path: string, body: unknown, who?: string) => {
    const r = request(app.getHttpServer())
      .patch(path)
      .send(body as object);
    return who ? r.set('Authorization', `Bearer ${tokens[who]}`) : r;
  };
  const grantsPath = (key: string) => `/api/roles/profiles/${key}/grants`;
  const item = (body: RoleProfilesResponse, key: string): RoleProfileItem =>
    body.items.find((i) => i.profileKey === key) as RoleProfileItem;

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
    // Same pipe configuration as src/main.ts.
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
    await seed();
    tokens.admin = await login('admin@a.test');
    tokens.analyst = await login('analyst@a.test');
    tokens.employee = await login('employee@a.test');
    tokens.adminB = await login('admin@b.test');
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  describe('listing', () => {
    it('requires authentication', async () => {
      await get('/api/roles/profiles').expect(401);
    });

    it('requires the legacy roles:read permission', async () => {
      await get('/api/roles/profiles', 'employee').expect(403);
    });

    it('returns the eight profiles with real, org-scoped data', async () => {
      const res = await get('/api/roles/profiles', 'admin').expect(200);
      const body = res.body as RoleProfilesResponse;
      expect(body.registryVersion).toMatch(/^[0-9a-f]{8}$/);
      expect(body.items.map((i) => i.profileKey)).toEqual([
        'owner',
        'admin',
        'hr-people-manager',
        'manager',
        'analyst',
        'facilitator',
        'viewer',
        'custom-role',
      ]);

      const admin = item(body, 'admin');
      expect(admin.legacyRole?.id).toBe(ids.aAdminRole);
      expect(admin.legacyRole?.permissions).toEqual(ADMIN_PERMS);
      expect(admin.userCount).toBe(1);
      expect(admin.assignable).toBe(true);
      expect(item(body, 'analyst').userCount).toBe(1);

      // Profiles with no legacy role: no fabricated counts, not assignable, not configured.
      for (const key of [
        'owner',
        'hr-people-manager',
        'manager',
        'facilitator',
        'viewer',
        'custom-role',
      ]) {
        const p = item(body, key);
        expect(p.legacyRole).toBeNull();
        expect(p.userCount).toBeNull();
        expect(p.assignable).toBe(false);
        expect(p.config).toBeNull();
      }
      // Existing roles outside the eight profiles stay visible.
      expect(
        body.unlinkedLegacyRoles.map((r) => [r.name, r.userCount]),
      ).toEqual([['Employee', 1]]);
    });

    it('marks protected profiles read-only', async () => {
      const body = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as RoleProfilesResponse;
      expect(item(body, 'owner').editable).toBe(false);
      expect(item(body, 'custom-role').editable).toBe(false);
      expect(item(body, 'admin').editable).toBe(false); // caller's own role
      expect(item(body, 'viewer').editable).toBe(true);
    });

    it('ignores a client-supplied orgId query parameter', async () => {
      const res = await get(
        `/api/roles/profiles?orgId=${String(orgB)}`,
        'admin',
      );
      // forbidNonWhitelisted only inspects DTOs; the param is simply never read.
      expect(res.status).toBe(200);
      expect(
        item(res.body as RoleProfilesResponse, 'admin').legacyRole?.id,
      ).toBe(ids.aAdminRole);
    });
  });

  describe('saving grants', () => {
    it('persists valid grants and returns them on reload', async () => {
      const put = await patch(
        grantsPath('hr-people-manager'),
        {
          grants: ['sessions.read', 'org.read', 'contacts.read'],
          expectedVersion: 0,
        },
        'admin',
      ).expect(200);
      const saved = put.body as RoleProfileItem;
      expect(saved.config?.version).toBe(1);
      expect(saved.config?.grants).toEqual([
        'org.read',
        'contacts.read',
        'sessions.read',
      ]); // registry order

      const reload = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as RoleProfilesResponse;
      expect(item(reload, 'hr-people-manager').config?.grants).toEqual([
        'org.read',
        'contacts.read',
        'sessions.read',
      ]);
      // Persisted in MongoDB, scoped to org A.
      const doc = await connection.collection('role_profiles').findOne({
        orgId: orgA,
        profileKey: 'hr-people-manager',
      });
      expect(doc?.grants).toEqual([
        'org.read',
        'contacts.read',
        'sessions.read',
      ]);
      expect(String(doc?.updatedBy)).toBe(ids.aAdminUser);
    });

    it('accepts an empty grant list (clear all)', async () => {
      const res = await patch(
        grantsPath('hr-people-manager'),
        { grants: [], expectedVersion: 1 },
        'admin',
      ).expect(200);
      expect((res.body as RoleProfileItem).config).toMatchObject({
        grants: [],
        version: 2,
      });
    });

    it('detects stale versions (409) and duplicate first-saves (409)', async () => {
      await patch(
        grantsPath('hr-people-manager'),
        { grants: ['org.read'], expectedVersion: 1 },
        'admin',
      ).expect(409);
      await patch(
        grantsPath('hr-people-manager'),
        { grants: ['org.read'], expectedVersion: 0 },
        'admin',
      ).expect(409);
      const ok = await patch(
        grantsPath('hr-people-manager'),
        { grants: ['org.read'], expectedVersion: 2 },
        'admin',
      ).expect(200);
      expect((ok.body as RoleProfileItem).config?.version).toBe(3);
    });

    it('can edit a legacy-linked profile other than the caller’s own', async () => {
      const res = await patch(
        grantsPath('analyst'),
        { grants: ['reports.read'], expectedVersion: 0 },
        'admin',
      ).expect(200);
      expect((res.body as RoleProfileItem).config?.grants).toEqual([
        'reports.read',
      ]);
      expect((res.body as RoleProfileItem).userCount).toBe(1);
    });
  });

  describe('validation', () => {
    // Bodies are built lazily: `ids` is only populated after seeding in beforeAll.
    const bad: Array<[string, () => unknown]> = [
      [
        'unknown key',
        () => ({
          grants: ['sessions.read', 'sessions.fly'],
          expectedVersion: 0,
        }),
      ],
      [
        'legacy colon key',
        () => ({ grants: ['roles:write'], expectedVersion: 0 }),
      ],
      ['non-string element', () => ({ grants: [1], expectedVersion: 0 })],
      [
        'object element (operator injection)',
        () => ({ grants: [{ $ne: '' }], expectedVersion: 0 }),
      ],
      [
        'grants not an array',
        () => ({ grants: 'org.read', expectedVersion: 0 }),
      ],
      ['missing grants', () => ({ expectedVersion: 0 })],
      [
        'duplicate keys',
        () => ({ grants: ['org.read', 'org.read'], expectedVersion: 0 }),
      ],
      ['negative version', () => ({ grants: [], expectedVersion: -1 })],
      ['fractional version', () => ({ grants: [], expectedVersion: 1.5 })],
      ['missing version', () => ({ grants: [] })],
      [
        'client-supplied orgId',
        () => ({ grants: [], expectedVersion: 0, orgId: String(orgB) }),
      ],
      [
        'client-supplied roleId',
        () => ({ grants: [], expectedVersion: 0, roleId: ids.aAdminRole }),
      ],
    ];
    it.each(bad)(
      'rejects %s with 400 and writes nothing',
      async (_name, body) => {
        await patch(grantsPath('manager'), body(), 'admin').expect(400);
        expect(
          await connection
            .collection('role_profiles')
            .countDocuments({ profileKey: 'manager' }),
        ).toBe(0);
      },
    );

    it('returns 404 for an unknown profile key', async () => {
      await patch(
        grantsPath('superuser'),
        { grants: [], expectedVersion: 0 },
        'admin',
      ).expect(404);
    });
  });

  describe('authorization', () => {
    const ok = { grants: ['org.read'], expectedVersion: 0 };
    it('rejects unauthenticated updates (401)', async () => {
      await patch(grantsPath('viewer'), ok).expect(401);
    });
    it('rejects users without roles:write (403) — Analyst and Employee', async () => {
      await patch(grantsPath('viewer'), ok, 'analyst').expect(403);
      await patch(grantsPath('viewer'), ok, 'employee').expect(403);
      expect(
        await connection
          .collection('role_profiles')
          .countDocuments({ profileKey: 'viewer' }),
      ).toBe(0);
    });
    it('keeps Owner immutable (403)', async () => {
      await patch(
        grantsPath('owner'),
        { grants: ['roles.delete'], expectedVersion: 0 },
        'admin',
      ).expect(403);
    });
    it('keeps Custom Role read-only (403)', async () => {
      await patch(grantsPath('custom-role'), ok, 'admin').expect(403);
    });
    it('blocks changing the caller’s own role (self-escalation)', async () => {
      await patch(
        grantsPath('admin'),
        { grants: ['roles.delete', 'roles.assign'], expectedVersion: 0 },
        'admin',
      ).expect(403);
      expect(
        await connection
          .collection('role_profiles')
          .countDocuments({ profileKey: 'admin' }),
      ).toBe(0);
    });
  });

  describe('organization isolation', () => {
    it('does not expose org A configuration to org B', async () => {
      const body = (await get('/api/roles/profiles', 'adminB').expect(200))
        .body as RoleProfilesResponse;
      expect(item(body, 'hr-people-manager').config).toBeNull();
      expect(item(body, 'analyst').config).toBeNull();
      expect(item(body, 'admin').legacyRole?.id).toBe(ids.bAdminRole);
      expect(item(body, 'admin').userCount).toBe(1);
      expect(body.unlinkedLegacyRoles).toEqual([]);
    });

    it('org B writes are independent and cannot touch org A', async () => {
      const before = await connection
        .collection('role_profiles')
        .findOne({ orgId: orgA, profileKey: 'hr-people-manager' });
      // A's version (3) must not be reachable from B.
      await patch(
        grantsPath('hr-people-manager'),
        { grants: ['ai.use'], expectedVersion: 3 },
        'adminB',
      ).expect(409);
      const created = await patch(
        grantsPath('hr-people-manager'),
        { grants: ['ai.use'], expectedVersion: 0 },
        'adminB',
      ).expect(200);
      expect((created.body as RoleProfileItem).config?.grants).toEqual([
        'ai.use',
      ]);
      const after = await connection
        .collection('role_profiles')
        .findOne({ orgId: orgA, profileKey: 'hr-people-manager' });
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      const bDoc = await connection
        .collection('role_profiles')
        .findOne({ orgId: orgB, profileKey: 'hr-people-manager' });
      expect(bDoc?.grants).toEqual(['ai.use']);
    });
  });

  describe('legacy roles and User Management are preserved', () => {
    it('never modifies roles or users while saving grants', async () => {
      const snap = async () =>
        JSON.stringify([
          await roles.find().sort({ _id: 1 }).lean(),
          await users.find().sort({ _id: 1 }).lean(),
        ]);
      const before = await snap();
      await patch(
        grantsPath('facilitator'),
        { grants: ['sessions.read', 'sessions.launch'], expectedVersion: 0 },
        'admin',
      ).expect(200);
      await patch(
        grantsPath('facilitator'),
        { grants: [], expectedVersion: 1 },
        'admin',
      ).expect(200);
      expect(await snap()).toBe(before);
    });

    it('GET /api/roles still returns only the legacy roles, unchanged', async () => {
      const res = await get('/api/roles', 'admin').expect(200);
      const items = (
        res.body as { items: Array<{ name: string; permissions: string[] }> }
      ).items;
      expect(items.map((r) => r.name)).toEqual([
        'Admin',
        'Analyst',
        'Employee',
      ]);
      expect(items.find((r) => r.name === 'Admin')?.permissions).toEqual(
        ADMIN_PERMS,
      );
      expect(items.find((r) => r.name === 'Analyst')?.permissions).toEqual(
        ANALYST_PERMS,
      );
      expect(items.find((r) => r.name === 'Employee')?.permissions).toEqual(
        EMPLOYEE_PERMS,
      );
    });

    it('login/me still return the legacy permissions only (granular grants have no effect)', async () => {
      const res = await get('/api/auth/me', 'analyst').expect(200);
      expect((res.body as { permissions: string[] }).permissions).toEqual(
        ANALYST_PERMS,
      );
      // The Analyst profile now has saved grants (reports.read) yet legacy access is identical:
      // the seeded Analyst has no roles:read, so it is still refused.
      await get('/api/roles', 'analyst').expect(403);
      await get('/api/roles/profiles', 'analyst').expect(403);
      await patch(
        grantsPath('viewer'),
        { grants: [], expectedVersion: 0 },
        'analyst',
      ).expect(403);
    });

    it('User Management list and role assignment behave as before', async () => {
      const list = await get('/api/users', 'admin').expect(200);
      const rows = (
        list.body as { items: Array<{ email: string; roleName: string }> }
      ).items;
      expect(rows.map((u) => [u.email, u.roleName])).toEqual([
        ['admin@a.test', 'Admin'],
        ['analyst@a.test', 'Analyst'],
        ['employee@a.test', 'Employee'],
      ]);

      const moved = await patch(
        `/api/users/${ids.aEmployeeUser}/role`,
        { roleId: ids.aAnalystRole },
        'admin',
      ).expect(200);
      expect((moved.body as { roleName: string }).roleName).toBe('Analyst');
      // The directory reflects the real assignment counts.
      const dir = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as RoleProfilesResponse;
      expect(item(dir, 'analyst').userCount).toBe(2);
      await patch(
        `/api/users/${ids.aEmployeeUser}/role`,
        { roleId: ids.aEmployeeRole },
        'admin',
      ).expect(200);
    });

    it('role assignment still rejects other orgs’ roles and profile keys', async () => {
      await patch(
        `/api/users/${ids.aEmployeeUser}/role`,
        { roleId: ids.bAdminRole },
        'admin',
      ).expect(400);
      await patch(
        `/api/users/${ids.aEmployeeUser}/role`,
        { roleId: 'viewer' },
        'admin',
      ).expect(400);
      await patch(
        `/api/users/${ids.aEmployeeUser}/role`,
        { roleId: ids.aAnalystRole },
        'employee',
      ).expect(403);
    });

    it('never returns a retired registry key even if one is stored', async () => {
      await connection
        .collection('role_profiles')
        .updateOne(
          { orgId: orgA, profileKey: 'analyst' },
          { $set: { grants: ['reports.read', 'legacy.removed'] } },
        );
      const body = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as RoleProfilesResponse;
      expect(item(body, 'analyst').config?.grants).toEqual(['reports.read']);
    });
  });
});
