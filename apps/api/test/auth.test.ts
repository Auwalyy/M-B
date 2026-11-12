import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { testMailbox } from '../src/core/mail/mailer';
import { AuditLog } from '../src/modules/audit/audit.model';
import { Session } from '../src/modules/auth/session.model';
import { Customer } from '../src/modules/customers/customer.model';
import { User } from '../src/modules/users/user.model';
import { PASSWORD, as, login, makeApp, makeBranch, makeUser } from './helpers';

const app = makeApp();
const register = (body: object) => request(app).post('/api/v1/auth/register').send(body);
const cookieFrom = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('mb_rt='))?.split(';')[0];

describe('registration', () => {
  it('creates a customer account and a central customer record, normalising the phone', async () => {
    const res = await register({ fullName: 'Aisha Bello', phone: '0803 123 4567', email: 'Aisha@Example.com', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({ role: 'CUSTOMER', phone: '+2348031234567', email: 'aisha@example.com', permissions: [] });
    expect(cookieFrom(res)).toMatch(/^mb_rt=/);
    const set = res.headers['set-cookie'] as unknown as string[];
    expect(set.join(';')).toMatch(/HttpOnly/i);
    expect(set.join(';')).toMatch(/Path=\/api\/v1\/auth/);

    const customer = await Customer.findOne({ phone: '+2348031234567' }).lean();
    expect(customer?.user?.toString()).toBe(res.body.data.user.id);
    expect(res.body.data.user.customerId).toBe(customer?._id.toString());
  });

  it('links to an existing walk-in customer record instead of duplicating it', async () => {
    const existing = await Customer.create({ fullName: 'Walk In', phone: '+2348031234567', source: 'walk_in' });
    const res = await register({ fullName: 'Aisha Bello', phone: '08031234567', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.customerId).toBe(existing._id.toString());
    expect(await Customer.countDocuments()).toBe(1);
  });

  it('rejects duplicate phone or email with a clear error', async () => {
    await register({ fullName: 'A', phone: '08031234567', email: 'a@example.com', password: 'secret123' });
    const byPhone = await register({ fullName: 'B', phone: '+2348031234567', password: 'secret123' });
    expect(byPhone.status).toBe(409);
    expect(byPhone.body.error.code).toBe('ACCOUNT_EXISTS');
    const byEmail = await register({ fullName: 'B', phone: '08039999999', email: 'A@example.com', password: 'secret123' });
    expect(byEmail.status).toBe(409);
  });

  it('validates input and returns field errors', async () => {
    const res = await register({ fullName: '', phone: '123', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['fullName', 'phone', 'password']));
  });
});

describe('sign in', () => {
  beforeEach(async () => {
    await makeUser({ role: 'SUPER_ADMIN', email: 'owner@test.local' });
  });

  it('signs in with email (any case) or phone in local format', async () => {
    const byEmail = await login(app, 'OWNER@test.local');
    expect(byEmail.token).toBeTruthy();
    const user = await User.findOne({ email: 'owner@test.local' }).lean();
    const local = `0${user!.phone!.slice(4)}`;
    expect((await login(app, local)).userId).toBe(byEmail.userId);
  });

  it('returns the same error for an unknown account and a wrong password', async () => {
    const a = await request(app).post('/api/v1/auth/login').send({ identifier: 'nobody@test.local', password: 'x' });
    const b = await request(app).post('/api/v1/auth/login').send({ identifier: 'owner@test.local', password: 'wrong-pass1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(await AuditLog.countDocuments({ action: 'auth.login_failed' })).toBe(2);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ identifier: 'owner@test.local', password: 'wrong-pass1' });
    }
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'owner@test.local', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await AuditLog.countDocuments({ action: 'auth.account_locked' })).toBe(1);
  });

  it('blocks deactivated accounts', async () => {
    await makeUser({ role: 'SALES_STAFF', email: 'gone@test.local', status: 'deactivated' });
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'gone@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('returns the profile with effective permissions and records the sign-in', async () => {
    const s = await login(app, 'owner@test.local');
    const me = await as(app, s).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ role: 'SUPER_ADMIN', scope: 'company' });
    expect(me.body.data.permissions).toContain('branches:create');
    expect(await AuditLog.countDocuments({ action: 'auth.login' })).toBe(1);
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    const s = await login(app, 'owner@test.local');
    const tampered = `${s.token.slice(0, -4)}AAAA`;
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
  });
});

describe('refresh tokens', () => {
  beforeEach(async () => {
    await makeUser({ role: 'SALES_STAFF', email: 'staff@test.local' });
  });

  it('answers a signed-out visitor (no cookie) with 204, and a bad cookie with 401', async () => {
    const none = await request(app).post('/api/v1/auth/refresh');
    expect(none.status).toBe(204);
    expect(none.text).toBe('');
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', 'mb_rt=not-a-real-token')).status).toBe(401);
  });

  it('rotates the refresh token and issues a working access token', async () => {
    const s = await login(app, 'staff@test.local');
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(res.status).toBe(200);
    const next = cookieFrom(res)!;
    expect(next).not.toBe(s.cookie);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('treats a just-rotated token as a tab race, but revokes the session when an old token is replayed later', async () => {
    const s = await login(app, 'staff@test.local');
    await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie);

    const race = await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(race.status).toBe(401);
    expect(race.body.error.code).toBe('REFRESH_RACE');

    // Make the rotation look old: replaying the old token now counts as theft.
    await Session.updateMany({}, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    // The whole session is gone: the access token stops working too.
    expect((await as(app, s).get('/api/v1/auth/me')).status).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh_reuse_detected' })).toBe(1);
  });

  it('logout revokes the session immediately', async () => {
    const s = await login(app, 'staff@test.local');
    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', s.cookie);
    expect(out.status).toBe(204);
    expect((await as(app, s).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('rejects cookie requests from untrusted origins (CSRF defence)', async () => {
    const s = await login(app, 'staff@test.local');
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('ends sessions as soon as a user is deactivated', async () => {
    const s = await login(app, 'staff@test.local');
    await User.updateOne({ email: 'staff@test.local' }, { status: 'deactivated' });
    expect((await as(app, s).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });
});

describe('password management', () => {
  it('forgot password sends a reset email via the outbox, and the link resets the password once', async () => {
    await makeUser({ role: 'CUSTOMER', email: 'buyer@test.local' });
    const s = await login(app, 'buyer@test.local');

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'buyer@test.local' });
    expect(res.status).toBe(202);
    expect(testMailbox).toHaveLength(0); // queued, not sent inline
    await processOutboxBatch();
    expect(testMailbox).toHaveLength(1);
    const token = /token=([A-Za-z0-9_%-]+)/.exec(testMailbox[0]!.text)![1]!;

    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'BrandNew123' });
    expect(reset.status).toBe(200);
    // Old sessions are signed out; the new password works; the link cannot be reused.
    expect((await as(app, s).get('/api/v1/auth/me')).status).toBe(401);
    await login(app, 'buyer@test.local', 'BrandNew123');
    const again = await request(app).post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'Another123' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('forgot password responds identically for unknown emails and sends nothing', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@test.local' });
    expect(res.status).toBe(202);
    await processOutboxBatch();
    expect(testMailbox).toHaveLength(0);
  });

  it('forces staff with a temporary password to change it before doing anything else', async () => {
    const branch = await makeBranch('KAN01');
    await makeUser({ role: 'BRANCH_ADMIN', branches: [branch._id], email: 'new@test.local', mustChangePassword: true });
    const s = await login(app, 'new@test.local');

    const me = await as(app, s).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);
    const blocked = await as(app, s).get('/api/v1/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrong = await as(app, s).post('/api/v1/auth/change-password', { currentPassword: 'nope', newPassword: 'MyOwnPass1' });
    expect(wrong.status).toBe(400);
    const changed = await as(app, s).post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'MyOwnPass1' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.mustChangePassword).toBe(false);
    expect((await as(app, s).get('/api/v1/users')).status).toBe(200);
  });

  it('changing password signs out other devices but keeps the current one', async () => {
    await makeUser({ role: 'CUSTOMER', email: 'two@test.local' });
    const phone = await login(app, 'two@test.local');
    const laptop = await login(app, 'two@test.local');
    await as(app, laptop).post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed123' });
    expect((await as(app, laptop).get('/api/v1/auth/me')).status).toBe(200);
    expect((await as(app, phone).get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('profile and sessions', () => {
  it('updates the profile and keeps the customer record in sync', async () => {
    const reg = await register({ fullName: 'Old Name', phone: '08031234567', password: 'secret123' });
    const token = reg.body.data.accessToken;
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'New Name', phone: '0805 000 1111' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fullName: 'New Name', phone: '+2348050001111' });
    const customer = await Customer.findById(reg.body.data.user.customerId).lean();
    expect(customer).toMatchObject({ fullName: 'New Name', phone: '+2348050001111' });
  });

  it('lists devices and can sign out a specific one', async () => {
    await makeUser({ role: 'CUSTOMER', email: 'multi@test.local' });
    const a = await login(app, 'multi@test.local');
    const b = await login(app, 'multi@test.local');
    const list = await as(app, a).get('/api/v1/auth/sessions');
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect((await as(app, a).delete(`/api/v1/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await as(app, b).get('/api/v1/auth/me')).status).toBe(401);
    expect((await as(app, a).get('/api/v1/auth/me')).status).toBe(200);
  });
});
