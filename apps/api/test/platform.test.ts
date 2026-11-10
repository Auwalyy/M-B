import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextReference } from '../src/core/db/counter';
import { OutboxEvent, processOutboxBatch, registerOutboxHandler } from '../src/core/events/outbox';
import { AuditLog } from '../src/modules/audit/audit.model';
import { Role } from '../src/modules/roles/role.model';
import { as, makeApp, makeUser, makeWorld } from './helpers';

const app = makeApp();

describe('HTTP hardening', () => {
  it('sets security headers and a request id, and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports readiness from the database connection', async () => {
    expect((await request(app).get('/health/ready')).body).toMatchObject({ status: 'ready', database: 'up' });
  });

  it('returns a consistent error envelope for unknown routes and malformed JSON', async () => {
    const missing = await request(app).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND', requestId: expect.any(String) });

    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"identifier":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MALFORMED_JSON');
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts/); // no stack traces
  });

  it('rejects NoSQL operator injection in bodies and query strings', async () => {
    await makeUser({ role: 'SUPER_ADMIN', email: 'owner@test.local' });
    const body = await request(app).post('/api/v1/auth/login').send({ identifier: { $ne: null }, password: { $ne: null } });
    expect(body.status).toBe(422);
    const query = await request(app).get('/api/v1/branches?status[$ne]=x');
    expect(query.status).toBe(200); // the operator key is ignored, not executed
  });

  it('rejects oversized bodies', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'x'.repeat(1_100_000), password: 'x' });
    expect(res.status).toBe(413);
  });

  it('rate-limits sign-in attempts', async () => {
    const limited = makeApp({ rateLimits: { authPer15Min: 3 } });
    const attempt = () => request(limited).post('/api/v1/auth/login').send({ identifier: 'x@test.local', password: 'nope' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('publishes an OpenAPI document that covers every route', async () => {
    const { routes } = (await import('../src/app')).createApp();
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const documented = Object.values(res.body.paths as Record<string, object>).reduce((n, ops) => n + Object.keys(ops).length, 0);
    expect(documented).toBe(routes.length);
    expect(res.body.paths['/api/v1/branches/{id}'].patch.requestBody).toBeTruthy();
    expect(res.body.paths['/api/v1/users'].get.parameters.map((p: { name: string }) => p.name)).toContain('branch');
  });
});

describe('outbox', () => {
  it('retries failed events with backoff and completes them once the handler succeeds', async () => {
    let calls = 0;
    registerOutboxHandler('test.flaky', async () => {
      calls++;
      if (calls === 1) throw new Error('temporary failure');
    });
    await OutboxEvent.create({ type: 'test.flaky', payload: {} });
    await processOutboxBatch();
    let ev = await OutboxEvent.findOne({ type: 'test.flaky' }).lean();
    expect(ev).toMatchObject({ status: 'pending', attempts: 1, lastError: 'temporary failure' });
    expect(ev!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await OutboxEvent.updateOne({ _id: ev!._id }, { nextAttemptAt: new Date() });
    await processOutboxBatch();
    ev = await OutboxEvent.findOne({ type: 'test.flaky' }).lean();
    expect(ev).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('does not deliver the same event twice under concurrent workers', async () => {
    let calls = 0;
    registerOutboxHandler('test.once', async () => {
      calls++;
    });
    await OutboxEvent.create(Array.from({ length: 10 }, () => ({ type: 'test.once', payload: {} })));
    await Promise.all([processOutboxBatch(), processOutboxBatch(), processOutboxBatch()]);
    expect(calls).toBe(10);
  });
});

describe('reference numbers', () => {
  it('are unique and sequential under concurrency', async () => {
    const refs = await Promise.all(Array.from({ length: 25 }, () => nextReference('ORD', 'KAN01', new Date('2026-05-01'))));
    expect(new Set(refs).size).toBe(25);
    expect(refs.sort()[0]).toBe('ORD-KAN01-260001');
    expect(refs.sort()[24]).toBe('ORD-KAN01-260025');
  });
});

describe('audit log integrity', () => {
  it('cannot be modified or deleted through the application', async () => {
    await AuditLog.create({ action: 'test.entry' });
    await expect(AuditLog.updateOne({ action: 'test.entry' }, { action: 'changed' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('never stores secrets', async () => {
    const world = await makeWorld(app);
    await as(app, world.sessions.superAdmin).post(`/api/v1/users/${world.users.kanoSales._id}/reset-password`, { temporaryPassword: 'Secret12345' });
    await as(app, world.sessions.superAdmin).post('/api/v1/users', {
      fullName: 'X', phone: '08091234567', role: 'SALES_STAFF', branches: [world.branches.kano._id.toString()], temporaryPassword: 'Secret12345',
    });
    const all = JSON.stringify(await AuditLog.find().lean());
    expect(all).not.toContain('Secret12345');
    expect(all).not.toMatch(/\$argon2/);
  });
});

describe('roles and settings', () => {
  let world: Awaited<ReturnType<typeof makeWorld>>;
  beforeEach(async () => {
    world = await makeWorld(app);
  });

  it('lists roles with user counts', async () => {
    const res = await as(app, world.sessions.superAdmin).get('/api/v1/roles');
    const byKey = Object.fromEntries(res.body.data.map((r: { key: string; userCount: number }) => [r.key, r.userCount]));
    expect(byKey).toMatchObject({ SUPER_ADMIN: 1, BRANCH_ADMIN: 2, SALES_STAFF: 2 });
  });

  it('editing a role takes effect immediately; company-only and super admin rules are enforced', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const roles = (await sa.get('/api/v1/roles')).body.data as { id: string; key: string; permissions: string[] }[];
    const ba = roles.find((r) => r.key === 'BRANCH_ADMIN')!;
    const sar = roles.find((r) => r.key === 'SUPER_ADMIN')!;

    expect((await sa.patch(`/api/v1/roles/${sar.id}`, { permissions: [] })).status).toBe(400);
    expect((await sa.patch(`/api/v1/roles/${ba.id}`, { permissions: [...ba.permissions, 'branches:create'] })).status).toBe(400);

    const without = ba.permissions.filter((p) => p !== 'users:read');
    const edit = await sa.patch(`/api/v1/roles/${ba.id}`, { permissions: without });
    expect(edit.body.data.customized).toBe(true);
    expect((await as(app, world.sessions.kanoAdmin).get('/api/v1/users')).status).toBe(403);

    const reset = await sa.post(`/api/v1/roles/${ba.id}/reset`);
    expect(reset.body.data.customized).toBe(false);
    expect((await as(app, world.sessions.kanoAdmin).get('/api/v1/users')).status).toBe(200);
  });

  it('keeps customised roles when system roles are synced', async () => {
    const { ensureSystemRoles } = await import('../src/modules/roles/role.service');
    await Role.updateOne({ key: 'SALES_STAFF' }, { permissions: ['branches:read'], customized: true });
    await ensureSystemRoles();
    expect((await Role.findOne({ key: 'SALES_STAFF' }).lean())?.permissions).toEqual(['branches:read']);
  });

  it('shows visitors public settings only, and lets the super admin update everything', async () => {
    const pub = await request(app).get('/api/v1/settings');
    expect(pub.body.data.companyName).toBe('Mudassir & Brothers');
    expect(pub.body.data).not.toHaveProperty('reservation');

    const res = await as(app, world.sessions.superAdmin).patch('/api/v1/settings', {
      whatsapp: '0803 000 1234',
      reservation: { pendingExpiryHours: 12 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ whatsapp: '+2348030001234', reservation: { pendingExpiryHours: 12, confirmedHoldHours: 48 } });
    expect(await AuditLog.countDocuments({ action: 'settings.updated' })).toBe(1);
  });
});
