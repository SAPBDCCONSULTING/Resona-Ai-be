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
  CustomRoleItem,
  CustomRolesResponse,
  RoleProfileItem,
  RoleProfilesResponse,
} from '@pulsefeedback/shared';
import { AuthModule } from '../auth/auth.module';
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
import { BootstrapError, bootstrapOwner } from './owner-bootstrap';
import { OWNER_LEGACY_PERMISSIONS } from './owner-role';
import { RolesModule } from './roles.module';

/**
 * Owner / Admin bootstrap and role-creation authorization, against a REAL MongoDB with the real
 * guards. Same safety rules as the other integration suites: runs only when RBAC_TEST_MONGODB_URI
 * is set, uses its own throwaway database and drops only that.
 */
const BASE_URI = process.env.RBAC_TEST_MONGODB_URI;
const suite = BASE_URI ? describe : describe.skip;

const ADMIN_PERMS = [...OWNER_LEGACY_PERMISSIONS]; // the seeded Admin holds the same set
const ANALYST_PERMS = ['org:read', 'sessions:read', 'reports:read'];
const EMPLOYEE_PERMS = ['sessions:read', 'responses:write'];
const PASSWORD = 'test-password-123';
const OPERATOR = 'test-operator@ci';

suite('Owner bootstrap & role-creation authorization — integration', () => {
  const dbName = `resona_rbac_test_${Math.random().toString(36).slice(2, 10)}`;
  let app: INestApplication<App>;
  let connection: Connection;
  let roles: Model<RoleDocument>;
  let users: Model<UserDocument>;
  let audit: Model<RbacAuditEventDocument>;
  let orgs: Model<Organization>;

  const orgA = new Types.ObjectId();
  const orgB = new Types.ObjectId();
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const deps = () => ({
    orgs: orgs as never,
    roles: roles as never,
    users: users as never,
    audit: audit as never,
  });
  const boot = (orgSlug: string, email: string) =>
    bootstrapOwner(deps(), { orgSlug, email, operator: OPERATOR });

  async function seed() {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await connection.collection('organizations').insertMany([
      { _id: orgA, name: 'Org A', slug: 'org-a' },
      { _id: orgB, name: 'Org B', slug: 'org-b' },
    ]);
    const mk = (o: Types.ObjectId, name: string, permissions: string[]) =>
      roles.create({ orgId: o, name, permissions: permissions as never });
    const aAdmin = await mk(orgA, 'Admin', ADMIN_PERMS);
    const aAnalyst = await mk(orgA, 'Analyst', ANALYST_PERMS);
    const aEmployee = await mk(orgA, 'Employee', EMPLOYEE_PERMS);
    const bAdmin = await mk(orgB, 'Admin', ADMIN_PERMS);
    const bEmployee = await mk(orgB, 'Employee', EMPLOYEE_PERMS);
    Object.assign(ids, {
      aAdminRole: String(aAdmin._id),
      aAnalystRole: String(aAnalyst._id),
      aEmployeeRole: String(aEmployee._id),
      bAdminRole: String(bAdmin._id),
      bEmployeeRole: String(bEmployee._id),
    });
    const mkUser = async (
      o: Types.ObjectId,
      email: string,
      roleId: Types.ObjectId,
    ) => {
      const u = await users.create({
        orgId: o,
        email,
        name: email.split('@')[0],
        passwordHash: hash,
        roleId,
        locale: 'en',
      });
      ids[email] = String(u._id);
    };
    await mkUser(orgA, 'admin@a.test', aAdmin._id);
    await mkUser(orgA, 'owner@a.test', aAnalyst._id); // becomes Owner via the CLI logic
    await mkUser(orgA, 'analyst@a.test', aAnalyst._id);
    await mkUser(orgA, 'employee@a.test', aEmployee._id);
    await mkUser(orgA, 'employee2@a.test', aEmployee._id);
    await mkUser(orgB, 'admin@b.test', bAdmin._id);
    await mkUser(orgB, 'owner@b.test', bEmployee._id);
    await mkUser(orgB, 'employee@b.test', bEmployee._id);
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }
  const relogin = async (key: string, email: string) => {
    tokens[key] = await login(email);
  };

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
  const del = (p: string, who?: string) =>
    auth(request(app.getHttpServer()).delete(p), who);

  const valid = (name: string, grants = ['sessions.read']) => ({
    name,
    description: `${name} description`,
    grants,
  });
  const customList = async (who: string) =>
    (await get('/api/roles/custom', who).expect(200))
      .body as CustomRolesResponse;
  const assign = (userKey: string, roleId: string, who: string) =>
    patch(`/api/users/${ids[userKey]}/role`, { roleId }, who);
  const setAdminGrants = (grants: string[], expectedVersion: number) =>
    patch(
      '/api/roles/profiles/admin/grants',
      { grants, expectedVersion },
      'owner',
    );
  const roleOf = async (userKey: string) =>
    String((await users.findById(ids[userKey]))?.roleId);

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
    orgs = connection.model<Organization>(
      Organization.name,
      OrganizationSchema,
    );
    await roles.syncIndexes();
    await seed();
    for (const k of ['admin', 'analyst', 'employee'])
      await relogin(k, `${k}@a.test`);
    await relogin('adminB', 'admin@b.test');
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  // ------------------------------------------------------------------------------------------

  describe('the reported problem: no Owner has configured the Admin yet', () => {
    it('Admin cannot create a role, and the API says why', async () => {
      const list = await customList('admin');
      expect(list.canCreate).toBe(false);
      expect(list.createBlockedReason).toMatch(/An Owner can configure/);
      await post('/api/roles/custom', valid('Too Early'), 'admin').expect(403);
      expect(await roles.countDocuments({ name: 'Too Early' })).toBe(0);
    });

    it('Admin cannot unblock themselves by editing their own profile', async () => {
      await patch(
        '/api/roles/profiles/admin/grants',
        { grants: ['roles.create', 'sessions.read'], expectedVersion: 0 },
        'admin',
      ).expect(403);
      expect(
        await connection
          .collection('role_profiles')
          .countDocuments({ orgId: orgA }),
      ).toBe(0);
    });

    it('there is no HTTP route that creates an Owner', async () => {
      for (const [method, path] of [
        ['post', '/api/roles/owner'],
        ['post', '/api/owner/bootstrap'],
        ['post', '/api/roles/bootstrap'],
        ['patch', '/api/roles/profiles/owner/grants'],
      ] as const) {
        const r = request(app.getHttpServer())
          [method](path)
          .send({ grants: [], expectedVersion: 0 })
          .set('Authorization', `Bearer ${tokens.admin}`);
        expect([403, 404]).toContain((await r).status);
      }
      expect(await roles.countDocuments({ kind: 'owner' })).toBe(0);
    });
  });

  describe('operator bootstrap', () => {
    it('refuses unknown organizations, unknown users and users from another organization', async () => {
      await expect(boot('nope', 'owner@a.test')).rejects.toThrow(
        BootstrapError,
      );
      await expect(boot('org-a', 'nobody@a.test')).rejects.toThrow(/No user/);
      await expect(boot('org-a', 'owner@b.test')).rejects.toThrow(/No user/); // org B's user
      await expect(boot('', '')).rejects.toThrow(BootstrapError);
      expect(await roles.countDocuments({ kind: 'owner' })).toBe(0);
    });

    it('does not take over a pre-existing role that is merely named Owner', async () => {
      const fake = await roles.create({
        orgId: orgB,
        name: 'Owner',
        permissions: [],
      });
      await expect(boot('org-b', 'owner@b.test')).rejects.toThrow(
        /not a system Owner role/,
      );
      expect(await roles.countDocuments({ orgId: orgB, kind: 'owner' })).toBe(
        0,
      );
      await roles.deleteOne({ _id: fake._id });
    });

    it('makes exactly one existing user the Owner, and records who did it', async () => {
      const res = await boot('org-a', 'OWNER@a.test'); // email is normalised
      ids.aOwnerRole = res.roleId;
      const role = await roles.findById(res.roleId).lean();
      expect(role).toMatchObject({ name: 'Owner', kind: 'owner' });
      expect(String(role?.orgId)).toBe(String(orgA));
      expect(role?.permissions).toEqual(OWNER_LEGACY_PERMISSIONS);
      expect(role?.permissions).not.toContain('responses:write');
      expect(await roleOf('owner@a.test')).toBe(res.roleId);
      expect(
        await users.countDocuments({
          orgId: orgA,
          roleId: new Types.ObjectId(res.roleId),
        }),
      ).toBe(1);

      const events = await audit.find({ action: 'owner.bootstrap' }).lean();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorKind: 'operator',
        actorLabel: OPERATOR,
      });
      expect(String(events[0].orgId)).toBe(String(orgA));
      expect(String(events[0].targetUserId)).toBe(ids['owner@a.test']);
      expect(events[0].detail).toMatchObject({ previousRoleName: 'Analyst' });
    });

    it('refuses to create a second Owner, for the same or any other user', async () => {
      await expect(boot('org-a', 'owner@a.test')).rejects.toThrow(
        /already has an Owner/,
      );
      await expect(boot('org-a', 'admin@a.test')).rejects.toThrow(
        /already has an Owner/,
      );
      expect(await roleOf('admin@a.test')).toBe(ids.aAdminRole);
      expect(
        await users.countDocuments({
          orgId: orgA,
          roleId: new Types.ObjectId(ids.aOwnerRole),
        }),
      ).toBe(1);
    });

    it('the database allows at most one Owner role per organization', async () => {
      await expect(
        roles.create({
          orgId: orgA,
          name: 'Owner 2',
          kind: 'owner',
          permissions: [],
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('is scoped: the other organization still has no Owner', async () => {
      expect(await roles.countDocuments({ orgId: orgB, kind: 'owner' })).toBe(
        0,
      );
    });

    it('the Owner signs in with the full administrative permission set', async () => {
      await relogin('owner', 'owner@a.test');
      const me = await get('/api/auth/me', 'owner').expect(200);
      expect((me.body as { permissions: string[] }).permissions).toEqual(
        OWNER_LEGACY_PERMISSIONS,
      );
    });

    it('the Owner profile is linked to the real Owner role and stays read-only', async () => {
      const body = (await get('/api/roles/profiles', 'owner').expect(200))
        .body as RoleProfilesResponse;
      const owner = body.items.find(
        (i) => i.profileKey === 'owner',
      ) as RoleProfileItem;
      expect(owner.legacyRole?.id).toBe(ids.aOwnerRole);
      expect(owner).toMatchObject({
        userCount: 1,
        assignable: false,
        editable: false,
      });
      expect(body.unlinkedLegacyRoles.map((r) => r.name)).not.toContain(
        'Owner',
      );
    });
  });

  describe('Owner configures the Admin; Admin then creates within that authority', () => {
    it('the Owner can set the Admin profile (the Admin could not)', async () => {
      const res = await setAdminGrants(
        ['roles.read', 'roles.create', 'sessions.read', 'sessions.create'],
        0,
      ).expect(200);
      expect((res.body as RoleProfileItem).config?.version).toBe(1);
    });

    it('a properly authorized Admin can create a custom role', async () => {
      const list = await customList('admin');
      expect(list.canCreate).toBe(true);
      expect(list.delegableGrants).toEqual([
        'roles.read',
        'roles.create',
        'sessions.read',
        'sessions.create',
      ]);
      const res = await post(
        '/api/roles/custom',
        valid('Team Lead', ['sessions.read', 'sessions.create']),
        'admin',
      ).expect(201);
      ids.teamLead = (res.body as CustomRoleItem).id;
      expect(await roles.findById(ids.teamLead).lean()).toMatchObject({
        kind: 'custom',
        permissions: [],
        grants: ['sessions.read', 'sessions.create'],
      });
      const evt = await audit
        .findOne({
          action: 'role.create',
          targetRoleId: new Types.ObjectId(ids.teamLead),
        })
        .lean();
      expect(String(evt?.actorId)).toBe(ids['admin@a.test']);
      expect(evt?.actorKind).toBe('user');
    });

    it('the Admin cannot grant what the Owner did not delegate to them', async () => {
      for (const grants of [
        ['sessions.launch'],
        ['sessions.read', 'users.deactivate'],
        ['roles.assign'],
      ]) {
        await post(
          '/api/roles/custom',
          valid('Over Reach', grants),
          'admin',
        ).expect(403);
      }
      expect(await roles.countDocuments({ name: 'Over Reach' })).toBe(0);
    });

    it('rejects unknown permissions even when the caller is fully authorized', async () => {
      await post(
        '/api/roles/custom',
        valid('Bogus', ['sessions.read', 'bogus.key']),
        'admin',
      ).expect(400);
      await post(
        '/api/roles/custom',
        valid('Bogus', ['bogus.key']),
        'owner',
      ).expect(400);
    });

    it('editing and deleting need their own grants, which this Admin lacks', async () => {
      const item = (await customList('admin')).items.find(
        (i) => i.id === ids.teamLead,
      );
      expect(item).toMatchObject({ editable: false, deletable: false });
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        { ...valid('Team Lead 2', ['sessions.read']), expectedVersion: 1 },
        'admin',
      ).expect(403);
      await del(`/api/roles/custom/${ids.teamLead}`, 'admin').expect(403);
      expect(await roles.findById(ids.teamLead)).not.toBeNull();
    });

    it('an Admin without roles.create is denied, and the UI gets the reason', async () => {
      await setAdminGrants(['roles.read', 'sessions.read'], 1).expect(200);
      const list = await customList('admin');
      expect(list.canCreate).toBe(false);
      expect(list.createBlockedReason).toMatch(/not allowed to create roles/);
      await post('/api/roles/custom', valid('Denied'), 'admin').expect(403);
      expect(await roles.countDocuments({ name: 'Denied' })).toBe(0);
      await setAdminGrants(
        [
          'roles.read',
          'roles.create',
          'roles.update',
          'roles.delete',
          'roles.assign',
          'sessions.read',
          'sessions.create',
        ],
        2,
      ).expect(200);
    });

    it('with edit/delete/assign delegated, existing safeguards still apply', async () => {
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        { ...valid('Team Leader', ['sessions.read']), expectedVersion: 1 },
        'admin',
      ).expect(200);
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        { ...valid('Team Leader', ['sessions.read']), expectedVersion: 1 },
        'admin',
      ).expect(409); // stale version
      await patch(
        `/api/roles/custom/${ids.teamLead}`,
        {
          ...valid('Team Leader', ['sessions.read', 'sessions.launch']),
          expectedVersion: 2,
        },
        'admin',
      ).expect(403); // adding a non-delegable grant
      await assign('employee@a.test', ids.teamLead, 'admin').expect(200);
      await del(`/api/roles/custom/${ids.teamLead}`, 'admin').expect(409); // still assigned
      await assign('employee@a.test', ids.aEmployeeRole, 'admin').expect(200);
      await del(`/api/roles/custom/${ids.teamLead}`, 'admin').expect(200);
      expect(await roles.findById(ids.teamLead)).toBeNull();
    });
  });

  describe('ordinary users', () => {
    it('cannot create, edit, delete or list custom roles', async () => {
      for (const who of ['analyst', 'employee']) {
        await post('/api/roles/custom', valid('Nope'), who).expect(403);
        await patch(
          `/api/roles/custom/${ids.aAdminRole}`,
          { ...valid('Nope'), expectedVersion: 1 },
          who,
        ).expect(403);
        await del(`/api/roles/custom/${ids.aAdminRole}`, who).expect(403);
        await get('/api/roles/custom', who).expect(403);
      }
      await post('/api/roles/custom', valid('Nope')).expect(401);
      expect(await roles.countDocuments({ name: 'Nope' })).toBe(0);
    });
  });

  describe('self-promotion and escalation', () => {
    it('nobody can assign Owner through the API — not an Admin, not even the Owner', async () => {
      await assign('admin@a.test', ids.aOwnerRole, 'admin').expect(403); // self
      await assign('employee@a.test', ids.aOwnerRole, 'admin').expect(403);
      await assign('employee@a.test', ids.aOwnerRole, 'owner').expect(403);
      await assign('analyst@a.test', ids.aOwnerRole, 'owner').expect(403);
      expect(
        await users.countDocuments({
          orgId: orgA,
          roleId: new Types.ObjectId(ids.aOwnerRole),
        }),
      ).toBe(1);
      expect(await roleOf('admin@a.test')).toBe(ids.aAdminRole);
      for (const who of ['admin', 'owner']) {
        const names = (
          (await get('/api/users/assignable-roles', who).expect(200)).body as {
            items: Array<{ name: string }>;
          }
        ).items.map((r) => r.name);
        expect(names).not.toContain('Owner');
      }
    });

    it('users without users:write cannot change anyone’s role, including their own', async () => {
      await assign('employee@a.test', ids.aAdminRole, 'employee').expect(403);
      await assign('analyst@a.test', ids.aOwnerRole, 'analyst').expect(403);
      expect(await roleOf('employee@a.test')).toBe(ids.aEmployeeRole);
    });

    it('an Admin cannot name a custom role Owner or Admin', async () => {
      await post('/api/roles/custom', valid('Owner'), 'admin').expect(400);
      await post('/api/roles/custom', valid(' owner '), 'owner').expect(400);
      await post('/api/roles/custom', valid('Admin'), 'owner').expect(400);
      expect(
        await roles.countDocuments({ kind: 'custom', nameKey: 'owner' }),
      ).toBe(0);
    });

    it('client-supplied role kind / org / permissions are refused', async () => {
      for (const extra of [
        { kind: 'owner' },
        { orgId: String(orgB) },
        { permissions: ['org:write'] },
      ]) {
        await post(
          '/api/roles/custom',
          { ...valid('Smuggle'), ...extra },
          'owner',
        ).expect(400);
      }
      expect(await roles.countDocuments({ name: 'Smuggle' })).toBe(0);
    });

    it('an Admin cannot edit the Owner profile or the Owner role', async () => {
      await patch(
        '/api/roles/profiles/owner/grants',
        { grants: ['roles.read'], expectedVersion: 0 },
        'admin',
      ).expect(403);
      await patch(
        '/api/roles/profiles/owner/grants',
        { grants: ['roles.read'], expectedVersion: 0 },
        'owner',
      ).expect(403);
    });
  });

  describe('protected system roles and last-Owner protection', () => {
    it('system roles and the Owner role cannot be edited or deleted as custom roles', async () => {
      for (const who of ['admin', 'owner']) {
        for (const id of [
          ids.aAdminRole,
          ids.aAnalystRole,
          ids.aEmployeeRole,
          ids.aOwnerRole,
        ]) {
          await patch(
            `/api/roles/custom/${id}`,
            { ...valid('Hijack'), expectedVersion: 1 },
            who,
          ).expect(403);
          await del(`/api/roles/custom/${id}`, who).expect(403);
        }
      }
      expect(await roles.findById(ids.aOwnerRole)).toMatchObject({
        name: 'Owner',
        kind: 'owner',
      });
      expect((await roles.findById(ids.aAdminRole))?.permissions).toEqual(
        ADMIN_PERMS,
      );
    });

    it('the last Owner cannot be demoted or removed — by an Admin, by themselves or by role deletion', async () => {
      await assign('owner@a.test', ids.aEmployeeRole, 'admin').expect(403);
      await assign('owner@a.test', ids.aAdminRole, 'owner').expect(403); // self
      expect(await roleOf('owner@a.test')).toBe(ids.aOwnerRole);
      const rows = (
        (await get('/api/users', 'admin').expect(200)).body as {
          items: Array<{
            email: string;
            canChangeRole: boolean;
            roleChangeBlockedReason: string | null;
          }>;
        }
      ).items;
      const row = rows.find((u) => u.email === 'owner@a.test');
      expect(row?.canChangeRole).toBe(false);
      expect(row?.roleChangeBlockedReason).toMatch(/Owner/);
      await del(`/api/roles/custom/${ids.aOwnerRole}`, 'owner').expect(403);
      expect(
        await users.countDocuments({
          orgId: orgA,
          roleId: new Types.ObjectId(ids.aOwnerRole),
        }),
      ).toBe(1);
    });

    it('an Admin who holds only a custom-role grant cannot reach the Owner’s account either', async () => {
      await assign('owner@a.test', ids.aAnalystRole, 'admin').expect(403);
      expect(await roleOf('owner@a.test')).toBe(ids.aOwnerRole);
    });
  });

  describe('organization isolation', () => {
    it('bootstrapping one organization does not give anything in another', async () => {
      await boot('org-b', 'owner@b.test');
      await relogin('ownerB', 'owner@b.test');
      expect(await roles.countDocuments({ kind: 'owner' })).toBe(2);
      const bOwnerRole = (await roles.findOne({ orgId: orgB, kind: 'owner' }))!;
      ids.bOwnerRole = String(bOwnerRole._id);
      expect(ids.bOwnerRole).not.toBe(ids.aOwnerRole);
    });

    it('a role created by an Owner lands in the Owner’s own organization only', async () => {
      const res = await post(
        '/api/roles/custom',
        valid('Shared Name', ['users.read']),
        'owner',
      ).expect(201);
      ids.sharedA = (res.body as CustomRoleItem).id;
      expect(String((await roles.findById(ids.sharedA))?.orgId)).toBe(
        String(orgA),
      );
      expect((await customList('ownerB')).items.map((i) => i.id)).not.toContain(
        ids.sharedA,
      );
      // The same name is fine in the other organization.
      await post(
        '/api/roles/custom',
        valid('Shared Name', ['users.read']),
        'ownerB',
      ).expect(201);
    });

    it('cannot edit, delete or assign across organizations', async () => {
      await patch(
        `/api/roles/custom/${ids.sharedA}`,
        { ...valid('X'), expectedVersion: 1 },
        'ownerB',
      ).expect(404);
      await del(`/api/roles/custom/${ids.sharedA}`, 'ownerB').expect(404);
      await assign('employee@b.test', ids.sharedA, 'ownerB').expect(400); // role from org A
      await assign('employee@a.test', ids.bEmployeeRole, 'owner').expect(400); // role from org B
      await assign('employee@b.test', ids.aEmployeeRole, 'owner').expect(404); // user from org B
      await assign('employee@a.test', ids.bEmployeeRole, 'ownerB').expect(404); // user from org A
      expect(await roleOf('employee@b.test')).toBe(ids.bEmployeeRole);
      expect(await roleOf('employee@a.test')).toBe(ids.aEmployeeRole);
    });
  });

  describe('existing legitimate workflows keep working', () => {
    it('the Owner can create with protected grants, assign, edit and delete', async () => {
      const res = await post(
        '/api/roles/custom',
        valid('Governance', ['org.update', 'users.deactivate']),
        'owner',
      ).expect(201);
      const id = (res.body as CustomRoleItem).id;
      await assign('employee2@a.test', id, 'owner').expect(200);
      await del(`/api/roles/custom/${id}`, 'owner').expect(409);
      await patch(
        `/api/roles/custom/${id}`,
        { ...valid('Governance', ['org.update']), expectedVersion: 1 },
        'owner',
      ).expect(200);
      ids.governance = id;
    });

    it('an Admin cannot hand out or take over a role beyond the grants delegated to them', async () => {
      await assign('employee@a.test', ids.governance, 'admin').expect(403);
      await assign('employee2@a.test', ids.aEmployeeRole, 'admin').expect(403); // current role is beyond Admin's grants
      expect(await roleOf('employee2@a.test')).toBe(ids.governance);
    });

    it('legacy role assignment is unchanged for Admin and Owner', async () => {
      await assign('employee@a.test', ids.aAnalystRole, 'admin').expect(200);
      await assign('employee@a.test', ids.aEmployeeRole, 'owner').expect(200);
      await assign('employee2@a.test', ids.aEmployeeRole, 'owner').expect(200);
    });

    it('login still returns legacy permissions for non-Owner users', async () => {
      const me = await get('/api/auth/me', 'analyst').expect(200);
      expect((me.body as { permissions: string[] }).permissions).toEqual(
        ANALYST_PERMS,
      );
    });
  });

  describe('auditability', () => {
    it('records role and assignment changes with the acting user', async () => {
      for (const action of [
        'owner.bootstrap',
        'role.create',
        'role.update',
        'role.delete',
        'user.role.assign',
      ]) {
        expect(await audit.countDocuments({ action })).toBeGreaterThan(0);
      }
      const assigns = await audit.find({ action: 'user.role.assign' }).lean();
      expect(
        assigns.every(
          (e) => e.actorKind === 'user' && !!e.actorId && !!e.targetUserId,
        ),
      ).toBe(true);
      // Rejected attempts leave no audit trail of a change that did not happen.
      expect(
        await audit.countDocuments({
          action: 'role.create',
          'detail.name': 'Too Early',
        }),
      ).toBe(0);
    });
  });
});
