/**
 * Branch isolation matrix. For every role and every protected endpoint built so far,
 * check what each caller may do against their own branch and against another branch.
 * Requirement 17: authorization is enforced on the backend.
 */
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Session, as, makeApp, makeWorld } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;

beforeEach(async () => {
  world = await makeWorld(app);
});

type Caller = 'anonymous' | 'customer' | 'kanoSales' | 'kanoAdmin' | 'superAdmin';
type Expectation = Partial<Record<Caller, number>>;

interface Case {
  name: string;
  run: (caller: Caller) => Promise<request.Response>;
  expect: Expectation;
}

function client(caller: Caller) {
  if (caller === 'anonymous') {
    return {
      get: (u: string) => request(app).get(u),
      post: (u: string, b?: object) => request(app).post(u).send(b ?? {}),
      patch: (u: string, b?: object) => request(app).patch(u).send(b ?? {}),
      put: (u: string, b?: object) => request(app).put(u).send(b ?? {}),
      delete: (u: string) => request(app).delete(u),
    };
  }
  if (caller === 'customer') return as(app, customerSession!);
  return as(app, world.sessions[caller]);
}

let customerSession: Session | undefined;
beforeEach(async () => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ fullName: 'Shopper', phone: '08097776666', password: 'Shopper123' });
  customerSession = { token: res.body.data.accessToken, cookie: '', userId: res.body.data.user.id };
});

const OWN = () => world.branches.kano._id.toString();
const OTHER = () => world.branches.abuja._id.toString();

const cases: Case[] = [
  {
    name: 'PATCH own branch contact details',
    run: (c) => client(c).patch(`/api/v1/branches/${OWN()}`, { phone: '08030000001' }),
    // Callers who cannot manage branches get 404: out-of-scope records are never confirmed to exist.
    expect: { anonymous: 401, customer: 404, kanoSales: 403, kanoAdmin: 200, superAdmin: 200 },
  },
  {
    name: 'PATCH other branch contact details',
    run: (c) => client(c).patch(`/api/v1/branches/${OTHER()}`, { phone: '08030000001' }),
    expect: { anonymous: 401, customer: 404, kanoSales: 404, kanoAdmin: 404, superAdmin: 200 },
  },
  {
    name: 'POST create branch',
    run: (c) => client(c).post('/api/v1/branches', { name: 'X', code: 'KAN07', address: 'x', city: 'Kano', state: 'Kano', phone: '08030000001', whatsapp: '08030000001' }),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 201 },
  },
  {
    name: 'POST deactivate other branch',
    run: (c) => client(c).post(`/api/v1/branches/${OTHER()}/deactivate`),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 200 },
  },
  {
    name: 'GET staff list',
    run: (c) => client(c).get('/api/v1/users'),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 200, superAdmin: 200 },
  },
  {
    name: 'GET own-branch staff member',
    run: (c) => client(c).get(`/api/v1/users/${world.users.kanoSales._id}`),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 200, superAdmin: 200 },
  },
  {
    name: 'GET other-branch staff member',
    run: (c) => client(c).get(`/api/v1/users/${world.users.abujaSales._id}`),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 404, superAdmin: 200 },
  },
  {
    name: 'PATCH other-branch staff member',
    run: (c) => client(c).patch(`/api/v1/users/${world.users.abujaSales._id}`, { fullName: 'Hacked' }),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 404, superAdmin: 200 },
  },
  {
    name: 'POST deactivate other-branch staff',
    run: (c) => client(c).post(`/api/v1/users/${world.users.abujaSales._id}/deactivate`),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 404, superAdmin: 200 },
  },
  {
    name: 'POST reset password of other-branch staff',
    run: (c) => client(c).post(`/api/v1/users/${world.users.abujaSales._id}/reset-password`, { temporaryPassword: 'Temp12345' }),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 404, superAdmin: 200 },
  },
  {
    name: 'PUT assign branches',
    run: (c) => client(c).put(`/api/v1/users/${world.users.kanoSales._id}/branches`, { branches: [OTHER()] }),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 200 },
  },
  {
    name: 'GET roles',
    run: (c) => client(c).get('/api/v1/roles'),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 200 },
  },
  {
    name: 'PATCH company settings',
    run: (c) => client(c).patch('/api/v1/settings', { companyName: 'Hijacked' }),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 200 },
  },
  {
    name: 'GET audit log',
    run: (c) => client(c).get('/api/v1/audit-logs'),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 200, superAdmin: 200 },
  },
  {
    name: 'GET login activity',
    run: (c) => client(c).get('/api/v1/audit-logs/logins'),
    expect: { anonymous: 401, customer: 403, kanoSales: 403, kanoAdmin: 403, superAdmin: 200 },
  },
];

describe('branch isolation matrix', () => {
  beforeAll(() => {
    expect(cases.length).toBeGreaterThan(10);
  });

  for (const c of cases) {
    for (const [caller, status] of Object.entries(c.expect) as [Caller, number][]) {
      it(`${c.name}: ${caller} -> ${status}`, async () => {
        const res = await c.run(caller);
        expect(res.status, JSON.stringify(res.body)).toBe(status);
      });
    }
  }

  it('branch admin audit view never includes another branch’s entries', async () => {
    await as(app, world.sessions.superAdmin).patch(`/api/v1/branches/${OTHER()}`, { phone: '08030000009' });
    await as(app, world.sessions.kanoAdmin).patch(`/api/v1/branches/${OWN()}`, { phone: '08030000008' });
    const res = await as(app, world.sessions.kanoAdmin).get('/api/v1/audit-logs?action=branch.');
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const entry of res.body.data) expect(entry.branch?.code).toBe('KAN01');
    const sneaky = await as(app, world.sessions.kanoAdmin).get(`/api/v1/audit-logs?branch=${OTHER()}`);
    expect(sneaky.body.data).toHaveLength(0);
  });

  it('filters sign-in activity by exact action or by prefix', async () => {
    const sa = as(app, world.sessions.superAdmin);
    await request(app).post('/api/v1/auth/login').send({ identifier: 'owner@test.local', password: 'wrong-pass1' });
    const ok = await sa.get('/api/v1/audit-logs/logins?action=login');
    expect(ok.body.data.length).toBeGreaterThan(0);
    for (const e of ok.body.data) expect(e.action).toBe('auth.login');
    const failed = await sa.get('/api/v1/audit-logs/logins?action=login_failed');
    expect(failed.body.data.map((e: { action: string }) => e.action)).toEqual(['auth.login_failed']);
    const prefix = await sa.get('/api/v1/audit-logs/logins?action=login*');
    expect(prefix.body.meta.total).toBe(ok.body.meta.total + 1);
  });
});
