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
import { RolesModule } from '../roles/roles.module';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { AuthModule } from './auth.module';

/**
 * Authentication behaviour against a REAL MongoDB with the real guards: sign-in, invalid
 * credentials, missing / invalid / expired tokens, refresh, revocation by deletion, and switching
 * between accounts. Runs only when RBAC_TEST_MONGODB_URI is set (throwaway database, dropped after).
 */
const BASE_URI = process.env.RBAC_TEST_MONGODB_URI;
const suite = BASE_URI ? describe : describe.skip;
const PASSWORD = 'test-password-123';

suite('Authentication — integration', () => {
  const dbName = `resona_rbac_test_${Math.random().toString(36).slice(2, 10)}`;
  let app: INestApplication<App>;
  let connection: Connection;
  let roles: Model<RoleDocument>;
  let users: Model<UserDocument>;
  let jwt: JwtService;
  const org = new Types.ObjectId();
  const ids: Record<string, string> = {};

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  const me = (token?: string) => {
    const r = request(app.getHttpServer()).get('/api/auth/me');
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

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
    const hash = await bcrypt.hash(PASSWORD, 4);
    const admin = await roles.create({
      orgId: org,
      name: 'Admin',
      permissions: ['users:read', 'roles:read'],
    });
    const employee = await roles.create({
      orgId: org,
      name: 'Employee',
      permissions: ['sessions:read'],
    });
    for (const [email, roleId] of [
      ['a@x.test', admin._id],
      ['b@x.test', employee._id],
    ] as const) {
      const u = await users.create({
        orgId: org,
        email,
        name: email.split('@')[0],
        passwordHash: hash,
        roleId,
        locale: 'en',
      });
      ids[email] = String(u._id);
    }
  });

  afterAll(async () => {
    if (connection && connection.name.startsWith('resona_rbac_test_')) {
      await connection.dropDatabase(); // only ever the throwaway DB created above
    }
    await app?.close();
  });

  it('valid sign-in returns tokens and the user’s identity, role and permissions — never the hash', async () => {
    const res = await login('a@x.test').expect(201);
    const body = res.body as {
      accessToken: string;
      refreshToken: string;
      user: Record<string, unknown>;
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user).toMatchObject({
      id: ids['a@x.test'],
      email: 'a@x.test',
      roleName: 'Admin',
      roleKind: 'system',
      permissions: ['users:read', 'roles:read'],
    });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('email is case-insensitive; wrong password and unknown user get the same 401', async () => {
    await login('A@X.TEST').expect(201);
    const wrong = await login('a@x.test', 'nope-nope-nope').expect(401);
    const unknown = await login('ghost@x.test').expect(401);
    expect((wrong.body as { message: string }).message).toBe(
      (unknown.body as { message: string }).message,
    );
  });

  it('rejects malformed sign-in bodies', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: PASSWORD })
      .expect(400);
  });

  it('rejects missing, malformed, wrong-secret and expired tokens', async () => {
    await me().expect(401);
    await me('garbage').expect(401);
    const wrong = await jwt.signAsync(
      { sub: ids['a@x.test'] },
      { secret: 'some-other-secret' },
    );
    await me(wrong).expect(401);
    const expired = await jwt.signAsync(
      { sub: ids['a@x.test'] },
      { secret: 'test-only-access-secret', expiresIn: -60 },
    );
    await me(expired).expect(401);
    const noSub = await jwt.signAsync(
      { foo: 'bar' },
      { secret: 'test-only-access-secret' },
    );
    await me(noSub).expect(401);
  });

  it('refresh issues a working access token; an access token cannot be used as a refresh token', async () => {
    const { accessToken, refreshToken } = (await login('a@x.test').expect(201))
      .body as { accessToken: string; refreshToken: string };
    const refreshed = (
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(201)
    ).body as { accessToken: string };
    await me(refreshed.accessToken).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: accessToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'junk-token-not-a-jwt' })
      .expect(401);
  });

  it('switching accounts: each token is only ever its own account, and old tokens keep their own identity', async () => {
    const a = (
      (await login('a@x.test').expect(201)).body as { accessToken: string }
    ).accessToken;
    const b = (
      (await login('b@x.test').expect(201)).body as { accessToken: string }
    ).accessToken;
    expect((await me(a).expect(200)).body).toMatchObject({
      email: 'a@x.test',
      roleName: 'Admin',
      permissions: ['users:read', 'roles:read'],
    });
    expect((await me(b).expect(200)).body).toMatchObject({
      email: 'b@x.test',
      roleName: 'Employee',
      permissions: ['sessions:read'],
    });
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${a}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${b}`)
      .expect(403);
  });

  it('there is no way to keep using a session after the account is deleted (token and refresh token)', async () => {
    const { accessToken, refreshToken } = (await login('b@x.test').expect(201))
      .body as { accessToken: string; refreshToken: string };
    await me(accessToken).expect(200);
    await users.deleteOne({ _id: ids['b@x.test'] });
    await me(accessToken).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    await login('b@x.test').expect(401);
  });

  it('a role change shows up in /me and in access on the very next request', async () => {
    const token = (
      (await login('a@x.test').expect(201)).body as { accessToken: string }
    ).accessToken;
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await roles.updateOne(
      { name: 'Admin', orgId: org },
      { $set: { permissions: ['roles:read'] } },
    );
    expect(
      ((await me(token).expect(200)).body as { permissions: string[] })
        .permissions,
    ).toEqual(['roles:read']);
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
