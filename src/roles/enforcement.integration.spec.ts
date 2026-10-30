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
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { OWNER_LEGACY_PERMISSIONS } from './owner-role';
import { RolesModule } from './roles.module';

/**
 * Stage 6: enforcement of custom-role grants (exact mappings only) and per-request permission
 * freshness, against a REAL MongoDB with the real guards. Runs only when RBAC_TEST_MONGODB_URI is
 * set; uses its own throwaway database and drops only that.
 */
const BASE_URI = process.env.RBAC_TEST_MONGODB_URI;
const suite = BASE_URI ? describe : describe.skip;

const ADMIN_PERMS = [...OWNER_LEGACY_PERMISSIONS];
const ANALYST_PERMS = ['org:read', 'sessions:read', 'reports:read'];
const EMPLOYEE_PERMS = ['sessions:read', 'responses:write'];
const PASSWORD = 'test-password-123';

suite('Stage 6 enforcement — integration', () => {
  const dbName = `resona_rbac_test_${Math.random().toString(36).slice(2, 10)}`;
  let app: INestApplication<App>;
  let connection: Connection;
  let roles: Model<RoleDocument>;
  let users: Model<UserDocument>;
  let jwt: JwtService;

  const orgA = new Types.ObjectId();
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function seed() {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const mk = (name: string, permissions: string[], kind?: 'owner') =>
      roles.create({
        orgId: orgA,
        name,
        permissions: permissions as never,
        kind,
      });
    const admin = await mk('Admin', ADMIN_PERMS);
    const analyst = await mk('Analyst', ANALYST_PERMS);
    const employee = await mk('Employee', EMPLOYEE_PERMS);
    const owner = await mk('Owner', OWNER_LEGACY_PERMISSIONS, 'owner');
    Object.assign(ids, {
      adminRole: String(admin._id),
      analystRole: String(analyst._id),
      employeeRole: String(employee._id),
      ownerRole: String(owner._id),
    });
    const mkUser = async (email: string, roleId: Types.ObjectId) => {
      const u = await users.create({
        orgId: orgA,
        email,
        name: email.split('@')[0],
        passwordHash: hash,
        roleId,
        locale: 'en',
      });
      ids[email] = String(u._id);
    };
    await mkUser('owner@a.test', owner._id);
    await mkUser('admin@a.test', admin._id);
    await mkUser('admin2@a.test', admin._id);
    await mkUser('analyst@a.test', analyst._id);
    await mkUser('member@a.test', employee._id);
    await mkUser('member2@a.test', employee._id);
    await mkUser('ghost@a.test', employee._id);
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }
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
  const me = async (who: string) =>
    (
      (await get('/api/auth/me', who).expect(200)).body as {
        permissions: string[];
      }
    ).permissions;

  /** Owner creates a custom role and assigns it to a user, who then logs in fresh. */
  async function giveCustomRole(
    userKey: string,
    tokenKey: string,
    name: string,
    grants: string[],
  ): Promise<string> {
    const res = await post(
      '/api/roles/custom',
      { name, description: `${name} role`, grants },
      'owner',
    ).expect(201);
    const roleId = (res.body as CustomRoleItem).id;
    await patch(`/api/users/${ids[userKey]}/role`, { roleId }, 'owner').expect(
      200,
    );
    tokens[tokenKey] = await login(userKey);
    return roleId;
  }

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
    jwt = app.get(JwtService);
    await roles.syncIndexes();
    await seed();
    for (const k of [
      'owner',
      'admin',
      'admin2',
      'analyst',
      'member',
      'member2',
      'ghost',
    ]) {
      tokens[k] = await login(`${k}@a.test`);
    }
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  describe('system roles are unaffected', () => {
    it('Admin, Analyst and Employee keep exactly their stored legacy permissions', async () => {
      expect(await me('admin')).toEqual(ADMIN_PERMS);
      expect(await me('analyst')).toEqual(ANALYST_PERMS);
      expect(await me('member')).toEqual(EMPLOYEE_PERMS);
      expect(await me('owner')).toEqual(OWNER_LEGACY_PERMISSIONS);
    });

    it('saved granular config does not narrow or widen a system role', async () => {
      await connection.collection('role_profiles').insertOne({
        orgId: orgA,
        profileKey: 'admin',
        grants: [], // an Admin profile with NOTHING granted
        version: 1,
      });
      expect(await me('admin')).toEqual(ADMIN_PERMS);
      await get('/api/users', 'admin').expect(200);
      await get('/api/roles/profiles', 'admin').expect(200);
      await connection.collection('role_profiles').deleteMany({ orgId: orgA });
    });
  });

  describe('custom roles: exact-mapped grants take effect, nothing else does', () => {
    it('users.read lets the holder list users — and nothing more', async () => {
      ids.readerRole = await giveCustomRole(
        'member@a.test',
        'reader',
        'User Reader',
        ['users.read', 'sessions.read'],
      );
      expect(await me('reader')).toEqual(['users:read']);
      await get('/api/users', 'reader').expect(200);
      await get('/api/users/assignable-roles', 'reader').expect(403); // needs users:write
      await patch(
        `/api/users/${ids['member2@a.test']}/role`,
        { roleId: ids.adminRole },
        'reader',
      ).expect(403);
      await get('/api/roles', 'reader').expect(403); // roles:read not granted
      await get('/api/roles/custom', 'reader').expect(403);
      await post(
        '/api/roles/custom',
        { name: 'X1', description: 'd', grants: ['users.read'] },
        'reader',
      ).expect(403);
    });

    it('roles.read gives read access to roles but not any mutation', async () => {
      await giveCustomRole('member2@a.test', 'roleViewer', 'Role Viewer', [
        'roles.read',
      ]);
      expect(await me('roleViewer')).toEqual(['roles:read']);
      await get('/api/roles', 'roleViewer').expect(200);
      const list = (await get('/api/roles/custom', 'roleViewer').expect(200))
        .body as {
        canCreate: boolean;
        items: Array<{ editable: boolean; deletable: boolean }>;
      };
      expect(list.canCreate).toBe(false);
      expect(list.items.every((i) => !i.editable && !i.deletable)).toBe(true);
      await post(
        '/api/roles/custom',
        { name: 'X2', description: 'd', grants: ['roles.read'] },
        'roleViewer',
      ).expect(403);
      await patch(
        '/api/roles/profiles/admin/grants',
        { grants: ['roles.read'], expectedVersion: 0 },
        'roleViewer',
      ).expect(403);
      expect(await roles.countDocuments({ name: { $in: ['X1', 'X2'] } })).toBe(
        0,
      );
    });

    it('unmapped (partial / ambiguous / admin) grants confer no access at all', async () => {
      const everythingElse = [
        'roles.create',
        'roles.update',
        'roles.assign',
        'roles.delete',
        'org.update',
        'users.invite',
        'users.update',
        'users.deactivate',
        'contacts.create',
        'contacts.update',
        'contacts.export',
        'sessions.create',
        'sessions.update',
        'sessions.archive',
        'programs.update',
        'templates.create',
        'templates.publish',
        'reports.export',
      ];
      await giveCustomRole(
        'ghost@a.test',
        'nothing',
        'Looks Powerful',
        everythingElse,
      );
      expect(await me('nothing')).toEqual([]);
      for (const path of [
        '/api/users',
        '/api/roles',
        '/api/roles/custom',
        '/api/roles/profiles',
      ]) {
        await get(path, 'nothing').expect(403);
      }
      await post(
        '/api/roles/custom',
        { name: 'X3', description: 'd', grants: ['roles.read'] },
        'nothing',
      ).expect(403);
      await patch(
        `/api/users/${ids['member@a.test']}/role`,
        { roleId: ids.adminRole },
        'nothing',
      ).expect(403);
    });

    it('a stored legacy `permissions` value on a custom role is never honoured', async () => {
      const id = ids.readerRole;
      await roles.updateOne(
        { _id: id },
        { $set: { permissions: ['org:write', 'roles:write'] } },
      );
      expect(await me('reader')).toEqual(['users:read']);
      await patch(
        '/api/roles/profiles/analyst/grants',
        { grants: ['roles.read'], expectedVersion: 0 },
        'reader',
      ).expect(403); // roles:write
      await roles.updateOne({ _id: id }, { $set: { permissions: [] } });
    });
  });

  describe('permissions are re-read on every request', () => {
    it('removing a grant takes effect immediately for already-issued tokens', async () => {
      await get('/api/users', 'reader').expect(200);
      const role = await roles.findById(ids.readerRole);
      await patch(
        `/api/roles/custom/${ids.readerRole}`,
        {
          name: 'User Reader',
          description: 'User Reader role',
          grants: ['sessions.read'],
          expectedVersion: role?.version,
        },
        'owner',
      ).expect(200);
      await get('/api/users', 'reader').expect(403); // same token, no re-login
    });

    it('demoting an Admin takes effect immediately for their existing token', async () => {
      await get('/api/roles', 'admin2').expect(200);
      await users.updateOne(
        { _id: ids['admin2@a.test'] },
        { $set: { roleId: ids.employeeRole } },
      );
      await get('/api/roles', 'admin2').expect(403);
      await post(
        '/api/roles/custom',
        { name: 'X4', description: 'd', grants: ['sessions.read'] },
        'admin2',
      ).expect(403);
    });

    it('a deleted user’s token stops working (401)', async () => {
      await users.deleteOne({ _id: ids['ghost@a.test'] });
      await get('/api/auth/me', 'nothing').expect(401);
    });

    it('a token for a user whose role no longer exists is rejected (401)', async () => {
      await roles.updateOne(
        { _id: ids.analystRole },
        { $set: { orgId: new Types.ObjectId() } },
      );
      await get('/api/auth/me', 'analyst').expect(401);
      await roles.updateOne(
        { _id: ids.analystRole },
        { $set: { orgId: orgA } },
      );
    });
  });

  describe('privilege escalation', () => {
    it('claims inside a validly signed token are ignored: permissions come from the database', async () => {
      const forged = await jwt.signAsync(
        {
          sub: ids['analyst@a.test'],
          orgId: String(new Types.ObjectId()),
          roleId: ids.ownerRole,
          permissions: OWNER_LEGACY_PERMISSIONS,
        },
        { secret: 'test-only-access-secret', expiresIn: '1h' },
      );
      const asAnalyst = (r: request.Test) =>
        r.set('Authorization', `Bearer ${forged}`);
      await asAnalyst(request(app.getHttpServer()).get('/api/users')).expect(
        403,
      );
      await asAnalyst(
        request(app.getHttpServer())
          .post('/api/roles/custom')
          .send({
            name: 'Forged',
            description: 'd',
            grants: ['roles.read'],
          }),
      ).expect(403);
      const meRes = await asAnalyst(
        request(app.getHttpServer()).get('/api/auth/me'),
      ).expect(200);
      expect(meRes.body).toMatchObject({ roleId: String(ids.analystRole) });
      expect((meRes.body as { permissions: string[] }).permissions).toEqual(
        ANALYST_PERMS,
      );
    });

    it('a token signed with the wrong secret is rejected', async () => {
      const bad = await jwt.signAsync(
        { sub: ids['owner@a.test'] },
        { secret: 'not-the-secret' },
      );
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${bad}`)
        .expect(401);
    });

    it('unauthenticated requests are refused', async () => {
      await get('/api/users').expect(401);
      await get('/api/roles/custom').expect(401);
      await post('/api/roles/custom', {}).expect(401);
    });

    it('a custom-role holder cannot mint enforced access for themselves or anyone', async () => {
      // role viewer (roles:read only) tries every route that could elevate someone
      await patch(
        `/api/users/${ids['analyst@a.test']}/role`,
        { roleId: ids.adminRole },
        'roleViewer',
      ).expect(403);
      await patch(
        `/api/users/${ids['member2@a.test']}/role`,
        { roleId: ids.ownerRole },
        'roleViewer',
      ).expect(403);
      expect(
        String((await users.findById(ids['member2@a.test']))?.roleId),
      ).not.toBe(ids.adminRole);
      expect(
        String((await users.findById(ids['member2@a.test']))?.roleId),
      ).not.toBe(ids.ownerRole);
    });

    it('an Admin cannot create a role whose grants (and so access) exceed what was delegated to them', async () => {
      await connection.collection('role_profiles').insertOne({
        orgId: orgA,
        profileKey: 'admin',
        grants: ['roles.read', 'roles.create', 'sessions.read'],
        version: 1,
      });
      // users.read would give the new role real access to the user list; Admin was not delegated it.
      await post(
        '/api/roles/custom',
        { name: 'Escalate', description: 'd', grants: ['users.read'] },
        'admin',
      ).expect(403);
      await post(
        '/api/roles/custom',
        { name: 'Fine', description: 'd', grants: ['roles.read'] },
        'admin',
      ).expect(201);
      expect(await roles.countDocuments({ name: 'Escalate' })).toBe(0);
    });
  });
});
