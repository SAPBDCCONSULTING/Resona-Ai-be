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
import { normalizeGrants } from '@pulsefeedback/shared';
import type {
  CustomRoleItem,
  CustomRolesResponse,
  OrgUser,
} from '@pulsefeedback/shared';
import { AuthModule } from '../auth/auth.module';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { RolesModule } from './roles.module';

/**
 * Stage 5 integration tests (custom role lifecycle + user-role assignment) against a REAL
 * MongoDB with the real guards. Same safety rules as role-profiles.integration.spec.ts: runs only
 * when RBAC_TEST_MONGODB_URI is set, uses its own throwaway database and drops only that.
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
  'settings:read',
  'settings:write',
  'ai:use',
];
const ANALYST_PERMS = ['org:read', 'sessions:read', 'reports:read'];
const EMPLOYEE_PERMS = ['sessions:read', 'responses:write'];
// A legacy role that can manage users/roles but holds far less than Admin.
const DELEGATE_PERMS = [
  'users:read',
  'users:write',
  'roles:read',
  'sessions:read',
];
const PASSWORD = 'test-password-123';

// What the (saved) Admin profile lets an Admin delegate. Deliberately excludes sessions.launch.
const ADMIN_DELEGABLE = [
  'roles.read',
  'roles.create',
  'roles.update',
  'roles.delete',
  'roles.assign',
  'users.read',
  'sessions.read',
  'sessions.create',
  'sessions.update',
  'contacts.read',
];

suite('Custom roles & role assignment (Stage 5) — integration', () => {
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
    const mk = (orgId: Types.ObjectId, name: string, permissions: string[]) =>
      roles.create({ orgId, name, permissions: permissions as never });
    const aAdmin = await mk(orgA, 'Admin', ADMIN_PERMS);
    const aAnalyst = await mk(orgA, 'Analyst', ANALYST_PERMS);
    const aEmployee = await mk(orgA, 'Employee', EMPLOYEE_PERMS);
    const aDelegate = await mk(orgA, 'Delegate', DELEGATE_PERMS);
    const bAdmin = await mk(orgB, 'Admin', ADMIN_PERMS);
    const bEmployee = await mk(orgB, 'Employee', EMPLOYEE_PERMS);
    Object.assign(ids, {
      aAdminRole: String(aAdmin._id),
      aAnalystRole: String(aAnalyst._id),
      aEmployeeRole: String(aEmployee._id),
      aDelegateRole: String(aDelegate._id),
      bAdminRole: String(bAdmin._id),
      bEmployeeRole: String(bEmployee._id),
    });

    // Saved granular config for the Admin profile in each org (what an Admin may delegate).
    await connection.collection('role_profiles').insertMany([
      { orgId: orgA, profileKey: 'admin', grants: ADMIN_DELEGABLE, version: 1 },
      {
        orgId: orgB,
        profileKey: 'admin',
        grants: [
          'roles.read',
          'roles.create',
          'sessions.read',
          'sessions.launch',
        ],
        version: 1,
      },
    ]);

    const mkUser = async (
      orgId: Types.ObjectId,
      email: string,
      roleId: Types.ObjectId,
    ) => {
      const u = await users.create({
        orgId,
        email,
        name: email.split('@')[0],
        passwordHash: hash,
        roleId,
        locale: 'en',
      });
      ids[email] = String(u._id);
      return u;
    };
    await mkUser(orgA, 'admin@a.test', aAdmin._id);
    await mkUser(orgA, 'admin2@a.test', aAdmin._id);
    await mkUser(orgA, 'analyst@a.test', aAnalyst._id);
    await mkUser(orgA, 'employee@a.test', aEmployee._id);
    await mkUser(orgA, 'employee2@a.test', aEmployee._id);
    await mkUser(orgA, 'delegate@a.test', aDelegate._id);
    await mkUser(orgB, 'admin@b.test', bAdmin._id);
    await mkUser(orgB, 'employee@b.test', bEmployee._id);
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
  const get = (path: string, who?: string) =>
    auth(request(app.getHttpServer()).get(path), who);
  const post = (path: string, body: unknown, who?: string) =>
    auth(
      request(app.getHttpServer())
        .post(path)
        .send(body as object),
      who,
    );
  const patch = (path: string, body: unknown, who?: string) =>
    auth(
      request(app.getHttpServer())
        .patch(path)
        .send(body as object),
      who,
    );
  const del = (path: string, who?: string) =>
    auth(request(app.getHttpServer()).delete(path), who);

  const create = (body: unknown, who = 'admin') =>
    post('/api/roles/custom', body, who);
  const valid = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    description: `${name} description`,
    grants: ['sessions.read'],
    ...extra,
  });
  const assign = (userKey: string, roleId: string, who = 'admin') =>
    patch(`/api/users/${ids[userKey]}/role`, { roleId }, who);
  const customList = async (who = 'admin') =>
    (await get('/api/roles/custom', who).expect(200))
      .body as CustomRolesResponse;
  const dbRole = (id: string) => roles.findById(id).lean();

  /** Inserts a custom role directly (bypassing the API) to set up states the API forbids. */
  async function rawCustom(
    org: Types.ObjectId,
    name: string,
    grants: string[],
  ): Promise<string> {
    const r = await roles.create({
      orgId: org,
      name,
      nameKey: name.toLowerCase(),
      description: 'raw',
      permissions: [],
      kind: 'custom',
      grants,
      version: 1,
    });
    return String(r._id);
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
    await roles.syncIndexes(); // make sure the partial unique index exists before racing writes
    await seed();
    for (const who of [
      'admin@a.test',
      'admin2@a.test',
      'analyst@a.test',
      'employee@a.test',
      'delegate@a.test',
      'admin@b.test',
    ]) {
      tokens[who.split('@')[0] + (who.endsWith('b.test') ? 'B' : '')] =
        await login(who);
    }
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  // ------------------------------------------------------------------------------------------

  describe('authentication and authorization', () => {
    it('requires authentication on every custom-role route', async () => {
      await get('/api/roles/custom').expect(401);
      await post('/api/roles/custom', valid('X')).expect(401);
      await patch(`/api/roles/custom/${ids.aAdminRole}`, {}).expect(401);
      await del(`/api/roles/custom/${ids.aAdminRole}`).expect(401);
    });

    it('rejects callers without the legacy permission', async () => {
      await get('/api/roles/custom', 'employee').expect(403);
      await create(valid('Nope'), 'analyst').expect(403);
      await del(`/api/roles/custom/${ids.aAdminRole}`, 'analyst').expect(403);
    });
  });

  describe('1. creating a custom role', () => {
    it('creates a valid custom role and reloads it from the backend', async () => {
      const res = await create(
        valid('  Team   Lead ', {
          description: ' Leads a team ',
          grants: ['sessions.read', 'contacts.read'],
        }),
      ).expect(201);
      const made = res.body as CustomRoleItem;
      expect(made.name).toBe('Team Lead'); // whitespace normalised
      expect(made.description).toBe('Leads a team');
      expect(made.grants).toEqual(['contacts.read', 'sessions.read']); // registry order
      expect(made.version).toBe(1);
      expect(made.userCount).toBe(0);
      ids.teamLead = made.id;

      const list = await customList();
      expect(list.items.map((i) => i.name)).toContain('Team Lead');
      expect(list.items.find((i) => i.id === made.id)).toMatchObject({
        grants: ['contacts.read', 'sessions.read'],
        editable: true,
        deletable: true,
      });
      expect(list.delegableGrants).toEqual(normalizeGrants(ADMIN_DELEGABLE));
    });

    it('stores it as a non-protected role with NO legacy permissions', async () => {
      const doc = await dbRole(ids.teamLead);
      expect(doc).toMatchObject({
        kind: 'custom',
        permissions: [],
        nameKey: 'team lead',
        version: 1,
      });
      expect(String(doc?.orgId)).toBe(String(orgA));
    });

    it('is exposed to the existing role list and hidden from the legacy "other roles" list', async () => {
      const all = (await get('/api/roles', 'admin').expect(200)).body as {
        items: Array<{ id: string; kind?: string; permissions: string[] }>;
      };
      expect(all.items.find((r) => r.id === ids.teamLead)).toMatchObject({
        kind: 'custom',
        permissions: [],
      });
      const profiles = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as { unlinkedLegacyRoles: Array<{ id: string }> };
      expect(profiles.unlinkedLegacyRoles.map((r) => r.id)).not.toContain(
        ids.teamLead,
      );
    });

    it('ignores any attempt to set protected fields from the client', async () => {
      for (const extra of [
        { kind: 'system' },
        { permissions: ['org:write'] },
        { orgId: String(orgB) },
        { version: 9 },
      ]) {
        await create(valid('Sneaky', extra)).expect(400);
      }
      expect(await roles.countDocuments({ name: 'Sneaky' })).toBe(0);
    });
  });

  describe('2. invalid and duplicate names', () => {
    it('rejects duplicates case-insensitively, including legacy role names', async () => {
      await create(valid('team lead')).expect(409);
      await create(valid('TEAM  LEAD')).expect(409);
      await create(valid('analyst')).expect(400); // reserved system name
      await create(valid('Employee')).expect(409); // existing legacy role in this org
      await create(valid('Delegate')).expect(409);
    });

    it('rejects reserved and Owner names', async () => {
      for (const name of [
        'Owner',
        'owner',
        ' OWNER ',
        'Admin',
        'Administrator',
      ]) {
        const res = await create(valid(name));
        expect([400, 409]).toContain(res.status);
      }
      expect(
        await roles.countDocuments({ kind: 'custom', nameKey: 'owner' }),
      ).toBe(0);
    });

    it('rejects missing, too short, too long and malformed names', async () => {
      await create({ description: 'd', grants: ['sessions.read'] }).expect(400);
      await create(valid('')).expect(400);
      await create(valid(' a ')).expect(400);
      await create(valid('x'.repeat(51))).expect(400);
      await create(valid('Bad<script>')).expect(400);
      await create(valid(7 as never)).expect(400);
    });

    it('requires a description and at least one permission', async () => {
      await create(valid('No Desc', { description: '   ' })).expect(400);
      await create(valid('Too Long', { description: 'd'.repeat(501) })).expect(
        400,
      );
      await create(valid('No Grants', { grants: [] })).expect(400);
    });

    it('allows the same name in another organization', async () => {
      const res = await create(
        valid('Team Lead', { grants: ['sessions.read'] }),
        'adminB',
      );
      expect(res.status).toBe(201);
      ids.bTeamLead = (res.body as CustomRoleItem).id;
    });

    it('the unique index stops a concurrent duplicate that slips past the pre-check', async () => {
      await expect(
        roles.create({
          orgId: orgA,
          name: 'TEAM LEAD',
          nameKey: 'team lead',
          permissions: [],
          kind: 'custom',
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('3. unknown permissions', () => {
    it('rejects unknown, malformed and duplicate keys on the server', async () => {
      await create(
        valid('Bad Keys', { grants: ['sessions.read', 'nope.nothing'] }),
      ).expect(400);
      await create(valid('Bad Keys', { grants: ['sessions:read'] })).expect(
        400,
      ); // legacy style
      await create(valid('Bad Keys', { grants: [42] })).expect(400);
      await create(valid('Bad Keys', { grants: 'sessions.read' })).expect(400);
      await create(
        valid('Bad Keys', { grants: ['sessions.read', 'sessions.read'] }),
      ).expect(400);
      expect(await roles.countDocuments({ name: 'Bad Keys' })).toBe(0);
    });
  });

  describe('5. permission delegation', () => {
    it('cannot create a role containing a permission the caller does not hold', async () => {
      const res = await create(
        valid('Launcher', { grants: ['sessions.read', 'sessions.launch'] }),
      ).expect(403);
      expect(JSON.stringify(res.body)).toContain('sessions.launch');
      expect(await roles.countDocuments({ name: 'Launcher' })).toBe(0);
    });

    it('an Admin with no configured grants cannot create any role (fails closed)', async () => {
      await connection
        .collection('role_profiles')
        .updateOne(
          { orgId: orgA, profileKey: 'admin' },
          { $set: { grants: [] } },
        );
      try {
        const list = await customList();
        expect(list.canCreate).toBe(false);
        expect(list.createBlockedReason).toMatch(/no configured permissions/i);
        await create(valid('Blocked')).expect(403);
      } finally {
        await connection
          .collection('role_profiles')
          .updateOne(
            { orgId: orgA, profileKey: 'admin' },
            { $set: { grants: ADMIN_DELEGABLE } },
          );
      }
    });

    it('uses the CURRENT database role, not a stale token', async () => {
      // admin2's token was issued while they were an Admin. Demote them in the database.
      await users.updateOne(
        { _id: ids['admin2@a.test'] },
        { $set: { roleId: ids.aEmployeeRole } },
      );
      try {
        await create(valid('Stale Token'), 'admin2').expect(403);
        await assign('employee@a.test', ids.aAnalystRole, 'admin2').expect(403);
      } finally {
        await users.updateOne(
          { _id: ids['admin2@a.test'] },
          { $set: { roleId: ids.aAdminRole } },
        );
      }
      expect(await roles.countDocuments({ name: 'Stale Token' })).toBe(0);
    });
  });

  describe('4. editing a custom role', () => {
    it('edits name, description and grants, then reloads the persisted result', async () => {
      const res = await patch(
        `/api/roles/custom/${ids.teamLead}`,
        {
          name: 'Team Leader',
          description: 'Leads a team, updated',
          grants: ['sessions.read', 'sessions.create'],
          expectedVersion: 1,
        },
        'admin',
      ).expect(200);
      expect(res.body).toMatchObject({
        name: 'Team Leader',
        description: 'Leads a team, updated',
        grants: ['sessions.read', 'sessions.create'],
        version: 2,
      });
      const reloaded = (await customList()).items.find(
        (i) => i.id === ids.teamLead,
      );
      expect(reloaded).toMatchObject({ name: 'Team Leader', version: 2 });
      expect(await dbRole(ids.teamLead)).toMatchObject({
        name: 'Team Leader',
        nameKey: 'team leader',
        permissions: [], // still no legacy permissions
      });
    });

    it('rejects a stale version with 409 and changes nothing', async () => {
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        { ...valid('Stale Edit'), expectedVersion: 1 },
        'admin',
      ).expect(409);
      expect((await dbRole(ids.teamLead))?.name).toBe('Team Leader');
    });

    it('validates edits on the server (name, grants, version)', async () => {
      const path = `/api/roles/custom/${ids.teamLead}`;
      await patch(
        path,
        { ...valid('Employee'), expectedVersion: 2 },
        'admin',
      ).expect(409);
      await patch(
        path,
        { ...valid('Owner'), expectedVersion: 2 },
        'admin',
      ).expect(400);
      await patch(
        path,
        { ...valid('Ok Name', { grants: ['bogus.key'] }), expectedVersion: 2 },
        'admin',
      ).expect(400);
      await patch(
        path,
        { ...valid('Ok Name', { grants: [] }), expectedVersion: 2 },
        'admin',
      ).expect(400);
      await patch(path, valid('Ok Name'), 'admin').expect(400); // missing expectedVersion
      await patch(
        path,
        { ...valid('Ok Name'), expectedVersion: 0 },
        'admin',
      ).expect(400);
      await patch(
        path,
        { ...valid('Ok Name'), expectedVersion: 2, kind: 'system' },
        'admin',
      ).expect(400);
      expect((await dbRole(ids.teamLead))?.version).toBe(2);
    });

    it('cannot add a grant the caller does not hold', async () => {
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        {
          ...valid('Team Leader', {
            grants: ['sessions.read', 'sessions.launch'],
          }),
          expectedVersion: 2,
        },
        'admin',
      ).expect(403);
      expect((await dbRole(ids.teamLead))?.grants).toEqual([
        'sessions.read',
        'sessions.create',
      ]);
    });

    it('cannot strip a grant the caller does not hold, but can leave it untouched', async () => {
      const powerful = await rawCustom(orgA, 'Powerful', [
        'sessions.read',
        'sessions.launch',
      ]);
      // Removing sessions.launch (not held by the Admin) is refused...
      await patch(
        `/api/roles/custom/${powerful}`,
        { ...valid('Powerful'), expectedVersion: 1 },
        'admin',
      ).expect(403);
      // ...and a role that carries it is outside the Admin's authority altogether.
      const item = (await customList()).items.find((i) => i.id === powerful);
      expect(item).toMatchObject({ editable: false, deletable: false });
      expect(item?.editBlockedReason).toMatch(/beyond your own/);
      ids.powerful = powerful;
    });

    it('cannot edit protected system roles through the custom-role API', async () => {
      for (const id of [ids.aAdminRole, ids.aAnalystRole, ids.aEmployeeRole]) {
        await patch(
          `/api/roles/custom/${id}`,
          { ...valid('Hijack'), expectedVersion: 1 },
          'admin',
        ).expect(403);
      }
      expect((await dbRole(ids.aAdminRole))?.permissions).toEqual(ADMIN_PERMS);
      expect((await dbRole(ids.aAdminRole))?.name).toBe('Admin');
    });

    it('is organization-scoped: another org cannot see or edit it', async () => {
      expect((await customList('adminB')).items.map((i) => i.id)).not.toContain(
        ids.teamLead,
      );
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        { ...valid('Cross Org'), expectedVersion: 2 },
        'adminB',
      ).expect(404);
      await del(`/api/roles/custom/${ids.teamLead}`, 'adminB').expect(404);
      expect((await dbRole(ids.teamLead))?.name).toBe('Team Leader');
    });

    it('rejects malformed role ids', async () => {
      await patch(
        '/api/roles/custom/not-an-id',
        { ...valid('X'), expectedVersion: 1 },
        'admin',
      ).expect(400);
      await del('/api/roles/custom/not-an-id', 'admin').expect(400);
      await patch(
        `/api/roles/custom/${String(new Types.ObjectId())}`,
        { ...valid('X'), expectedVersion: 1 },
        'admin',
      ).expect(404);
    });
  });

  describe('6/7. deleting a custom role', () => {
    it('never deletes protected system roles', async () => {
      for (const id of [
        ids.aAdminRole,
        ids.aAnalystRole,
        ids.aEmployeeRole,
        ids.aDelegateRole,
      ]) {
        await del(`/api/roles/custom/${id}`, 'admin').expect(403);
        expect(await dbRole(id)).not.toBeNull();
      }
      const owner = await roles.create({
        orgId: orgA,
        name: 'Owner',
        permissions: [],
      });
      await del(`/api/roles/custom/${String(owner._id)}`, 'admin').expect(403);
      expect(await dbRole(String(owner._id))).not.toBeNull();
    });

    it('refuses to delete a role that still has users, and leaves everything intact', async () => {
      const made = (await create(valid('Assigned Role')).expect(201))
        .body as CustomRoleItem;
      await assign('employee2@a.test', made.id).expect(200);

      const res = await del(`/api/roles/custom/${made.id}`, 'admin').expect(
        409,
      );
      expect(JSON.stringify(res.body)).toMatch(/still assigned to 1 user/);
      expect(await dbRole(made.id)).not.toBeNull();
      expect(
        String((await users.findById(ids['employee2@a.test']))?.roleId),
      ).toBe(made.id);

      const item = (await customList()).items.find((i) => i.id === made.id);
      expect(item).toMatchObject({ userCount: 1, deletable: false });
      ids.assignedRole = made.id;
    });

    it('deletes an unassigned custom role once its users are moved off', async () => {
      await assign('employee2@a.test', ids.aEmployeeRole).expect(200);
      await del(`/api/roles/custom/${ids.assignedRole}`, 'admin').expect(200);
      expect(await dbRole(ids.assignedRole)).toBeNull();
      expect((await customList()).items.map((i) => i.id)).not.toContain(
        ids.assignedRole,
      );
    });

    it('refuses to delete a role beyond the caller’s authority', async () => {
      await del(`/api/roles/custom/${ids.powerful}`, 'admin').expect(403);
      expect(await dbRole(ids.powerful)).not.toBeNull();
    });

    it('does not touch other organizations’ roles or data', async () => {
      expect(await dbRole(ids.bTeamLead)).not.toBeNull();
      expect(await users.countDocuments({ orgId: orgB })).toBe(2);
    });
  });

  describe('8. assigning roles', () => {
    it('lists only this organization’s users, with role kind and change status', async () => {
      const res = await get('/api/users', 'admin').expect(200);
      const rows = (res.body as { items: OrgUser[] }).items;
      expect(rows.every((u) => u.orgId === String(orgA))).toBe(true);
      expect(rows.map((u) => u.email)).not.toContain('admin@b.test');
      const self = rows.find((u) => u.email === 'admin@a.test');
      expect(self).toMatchObject({ canChangeRole: false, roleKind: 'system' });
      expect(self?.roleChangeBlockedReason).toMatch(/own role/);
      expect(rows.find((u) => u.email === 'employee@a.test')).toMatchObject({
        canChangeRole: true,
        roleName: 'Employee',
      });
    });

    it('assigns a custom role to an eligible user in the same organization', async () => {
      const res = await assign('employee@a.test', ids.teamLead).expect(200);
      expect(res.body).toMatchObject({
        id: ids['employee@a.test'],
        roleId: ids.teamLead,
        roleName: 'Team Leader',
        roleKind: 'custom',
      });
      const rows = (
        (await get('/api/users', 'admin').expect(200)).body as {
          items: OrgUser[];
        }
      ).items;
      expect(rows.find((u) => u.email === 'employee@a.test')).toMatchObject({
        roleName: 'Team Leader',
        roleKind: 'custom',
      });
      expect(
        (await customList()).items.find((i) => i.id === ids.teamLead)
          ?.userCount,
      ).toBe(1);
    });

    it('a custom role adds no enforced access (legacy permissions stay empty)', async () => {
      const token = await login('employee@a.test');
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((me.body as { permissions: string[] }).permissions).toEqual([]);
      for (const path of ['/api/roles', '/api/roles/custom', '/api/users']) {
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('legacy assignment between legacy roles still works', async () => {
      await assign('employee@a.test', ids.aAnalystRole).expect(200);
      await assign('employee@a.test', ids.aEmployeeRole).expect(200);
      const delegateAssign = await assign(
        'employee2@a.test',
        ids.aEmployeeRole,
        'delegate',
      );
      expect(delegateAssign.status).toBe(200); // Delegate may hand out Employee (within authority)
    });

    it('assignable-roles lists only roles within the caller’s authority', async () => {
      const names = async (who: string) =>
        (
          (await get('/api/users/assignable-roles', who).expect(200)).body as {
            items: Array<{ name: string }>;
          }
        ).items.map((r) => r.name);
      const admin = await names('admin');
      expect(admin).toEqual(
        expect.arrayContaining(['Admin', 'Analyst', 'Employee', 'Team Leader']),
      );
      expect(admin).not.toContain('Powerful'); // beyond the Admin's delegable grants
      const delegate = await names('delegate');
      expect(delegate).toContain('Employee');
      expect(delegate).not.toContain('Admin');
      // Delegate's role has no configured grants, so it cannot hand out custom roles (fails closed).
      expect(delegate).not.toContain('Team Leader');
      await get('/api/users/assignable-roles', 'analyst').expect(403);
    });
  });

  describe('9. cross-organization attempts', () => {
    it('rejects assigning another organization’s role', async () => {
      await assign('employee@a.test', ids.bEmployeeRole).expect(400);
      await assign('employee@a.test', ids.bAdminRole).expect(400);
      await assign('employee@a.test', ids.bTeamLead).expect(400);
      expect(
        String((await users.findById(ids['employee@a.test']))?.roleId),
      ).toBe(ids.aEmployeeRole);
    });

    it('rejects assigning to another organization’s user', async () => {
      await assign('employee@b.test', ids.aEmployeeRole).expect(404);
      // Org B's role is valid for adminB, but the target user is not in org B.
      await patch(
        `/api/users/${ids['employee@a.test']}/role`,
        { roleId: ids.bEmployeeRole },
        'adminB',
      ).expect(404);
      await patch(
        `/api/users/${ids['employee@a.test']}/role`,
        { roleId: ids.aEmployeeRole },
        'adminB',
      ).expect(400);
      expect(
        String((await users.findById(ids['employee@b.test']))?.roleId),
      ).toBe(ids.bEmployeeRole);
    });

    it('rejects malformed ids', async () => {
      await patch(
        '/api/users/nope/role',
        { roleId: ids.aEmployeeRole },
        'admin',
      ).expect(400);
      await patch(
        `/api/users/${ids['employee@a.test']}/role`,
        { roleId: 'nope' },
        'admin',
      ).expect(400);
      await patch(
        `/api/users/${ids['employee@a.test']}/role`,
        { roleId: ids.aEmployeeRole, orgId: String(orgB) },
        'admin',
      ).expect(400);
    });
  });

  describe('10. self-escalation and unauthorized delegation', () => {
    it('a user cannot change their own role', async () => {
      await assign('admin@a.test', ids.aAdminRole, 'admin').expect(403);
      await assign('delegate@a.test', ids.aAdminRole, 'delegate').expect(403);
      await assign('delegate@a.test', ids.aEmployeeRole, 'delegate').expect(
        403,
      );
      expect(
        String((await users.findById(ids['delegate@a.test']))?.roleId),
      ).toBe(ids.aDelegateRole);
    });

    it('cannot assign a legacy role that holds permissions beyond the caller’s own', async () => {
      await assign('employee@a.test', ids.aAdminRole, 'delegate').expect(403);
      await assign('employee@a.test', ids.aAnalystRole, 'delegate').expect(403); // reports:read
      expect(
        String((await users.findById(ids['employee@a.test']))?.roleId),
      ).toBe(ids.aEmployeeRole);
    });

    it('cannot assign a custom role whose grants exceed the caller’s authority', async () => {
      await assign('employee@a.test', ids.powerful, 'admin').expect(403);
      await assign('employee@a.test', ids.powerful, 'delegate').expect(403);
      expect(
        String((await users.findById(ids['employee@a.test']))?.roleId),
      ).toBe(ids.aEmployeeRole);
    });

    it('cannot change the role of a user whose current role outranks the caller', async () => {
      await assign('admin2@a.test', ids.aEmployeeRole, 'delegate').expect(403);
      expect(String((await users.findById(ids['admin2@a.test']))?.roleId)).toBe(
        ids.aAdminRole,
      );
    });

    it('never assigns Owner-level access, even if an "Owner" role exists', async () => {
      const owner = await roles
        .create({ orgId: orgA, name: 'Owner', permissions: [] })
        .catch(() => null);
      const ownerRole =
        owner ?? (await roles.findOne({ orgId: orgA, name: 'Owner' }));
      await assign('employee@a.test', String(ownerRole?._id), 'admin').expect(
        403,
      );
      expect(
        String((await users.findById(ids['employee@a.test']))?.roleId),
      ).toBe(ids.aEmployeeRole);
    });
  });

  describe('11. existing behaviour is preserved', () => {
    it('legacy role directory and Stage 4 profile editing are unaffected', async () => {
      const profiles = (await get('/api/roles/profiles', 'admin').expect(200))
        .body as {
        items: Array<{ profileKey: string; legacyRole: { id: string } | null }>;
      };
      expect(profiles.items).toHaveLength(8);
      expect(
        profiles.items.find((i) => i.profileKey === 'admin')?.legacyRole?.id,
      ).toBe(ids.aAdminRole);
      // The custom-role TEMPLATE is still read-only in the Stage 4 endpoint.
      await patch(
        '/api/roles/profiles/custom-role/grants',
        { grants: ['sessions.read'], expectedVersion: 0 },
        'admin',
      ).expect(403);
    });

    it('legacy roles are byte-for-byte unchanged by custom-role activity', async () => {
      const admin = await dbRole(ids.aAdminRole);
      expect(admin?.permissions).toEqual(ADMIN_PERMS);
      expect(admin).not.toHaveProperty('kind');
      expect(admin).not.toHaveProperty('nameKey');
      expect(admin).not.toHaveProperty('grants');
    });

    it('login and /me for legacy users still return their legacy permissions', async () => {
      const token = await login('analyst@a.test');
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((me.body as { permissions: string[] }).permissions).toEqual(
        ANALYST_PERMS,
      );
    });
  });
});
