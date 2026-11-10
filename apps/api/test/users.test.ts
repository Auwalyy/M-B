import { beforeEach, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { testMailbox } from '../src/core/mail/mailer';
import { AuditLog } from '../src/modules/audit/audit.model';
import { Branch } from '../src/modules/branches/branch.model';
import { PASSWORD, as, login, makeApp, makeBranch, makeWorld } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;

const staffBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'New Staff',
  email: 'new.staff@test.local',
  phone: '0809 111 2222',
  role: 'SALES_STAFF',
  branches: [world.branches.kano._id.toString()],
  temporaryPassword: 'Temp12345',
  ...overrides,
});

beforeEach(async () => {
  world = await makeWorld(app);
});

describe('creating staff', () => {
  it('super admin creates a branch admin; the branch admin list and welcome email follow', async () => {
    const res = await as(app, world.sessions.superAdmin).post('/api/v1/users', staffBody({ role: 'BRANCH_ADMIN' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: 'BRANCH_ADMIN', mustChangePassword: true, branches: [{ code: 'KAN01' }] });
    const branch = await Branch.findById(world.branches.kano._id).lean();
    expect(branch?.admins.map(String)).toContain(res.body.data.id);
    await processOutboxBatch();
    expect(testMailbox.map((m) => m.to)).toContain('new.staff@test.local');

    // The new account works with the temporary password and must change it.
    const s = await login(app, 'new.staff@test.local', 'Temp12345');
    expect((await as(app, s).get('/api/v1/users')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('branch admin creates sales staff for their own branch', async () => {
    const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/users', staffBody());
    expect(res.status).toBe(201);
    expect(await AuditLog.countDocuments({ action: 'user.created', branch: world.branches.kano._id })).toBe(1);
  });

  it('branch admin cannot create staff in another branch', async () => {
    const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/users', staffBody({ branches: [world.branches.abuja._id.toString()] }));
    expect(res.status).toBe(403);
  });

  it('branch admin cannot create another branch admin or a super admin', async () => {
    for (const role of ['BRANCH_ADMIN', 'SUPER_ADMIN']) {
      const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/users', staffBody({ role }));
      expect(res.status).toBe(403);
    }
  });

  it('sales staff cannot create users', async () => {
    expect((await as(app, world.sessions.kanoSales).post('/api/v1/users', staffBody())).status).toBe(403);
  });

  it('enforces branch rules per role', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const noBranch = await sa.post('/api/v1/users', staffBody({ branches: [] }));
    expect(noBranch.status).toBe(400);
    expect(noBranch.body.error.code).toBe('BRANCHES_REQUIRED');
    const superWithBranch = await sa.post('/api/v1/users', staffBody({ role: 'SUPER_ADMIN' }));
    expect(superWithBranch.status).toBe(400);
    await Branch.updateOne({ _id: world.branches.abuja._id }, { status: 'inactive' });
    const inactive = await sa.post('/api/v1/users', staffBody({ branches: [world.branches.abuja._id.toString()] }));
    expect(inactive.status).toBe(400);
  });

  it('rejects duplicate email or phone', async () => {
    const res = await as(app, world.sessions.superAdmin).post('/api/v1/users', staffBody({ email: 'admin.kano@test.local' }));
    expect(res.status).toBe(409);
  });
});

describe('viewing staff', () => {
  it('super admin sees all staff; branch admin sees only staff in their branch', async () => {
    const all = await as(app, world.sessions.superAdmin).get('/api/v1/users');
    expect(all.body.meta.total).toBe(5);
    const kano = await as(app, world.sessions.kanoAdmin).get('/api/v1/users');
    expect(kano.body.data.map((u: { fullName: string }) => u.fullName).sort()).toEqual(['Kano Admin', 'Kano Sales']);
  });

  it('branch admin cannot open a staff record from another branch (404)', async () => {
    const res = await as(app, world.sessions.kanoAdmin).get(`/api/v1/users/${world.users.abujaSales._id}`);
    expect(res.status).toBe(404);
    const sa = await as(app, world.sessions.kanoAdmin).get(`/api/v1/users/${world.users.superAdmin._id}`);
    expect(sa.status).toBe(404);
  });

  it('filters by role, branch and search', async () => {
    const sa = as(app, world.sessions.superAdmin);
    expect((await sa.get('/api/v1/users?role=BRANCH_ADMIN')).body.meta.total).toBe(2);
    expect((await sa.get(`/api/v1/users?branch=${world.branches.abuja._id}`)).body.meta.total).toBe(2);
    expect((await sa.get('/api/v1/users?q=abuja%20sales')).body.data[0].fullName).toBe('Abuja Sales');
    // A branch admin filtering on another branch gets nothing rather than an error.
    expect((await as(app, world.sessions.kanoAdmin).get(`/api/v1/users?branch=${world.branches.abuja._id}`)).body.meta.total).toBe(0);
  });
});

describe('managing staff', () => {
  it('branch admin can update and deactivate their sales staff, which signs them out', async () => {
    const ba = as(app, world.sessions.kanoAdmin);
    const id = world.users.kanoSales._id;
    expect((await ba.patch(`/api/v1/users/${id}`, { fullName: 'Renamed' })).body.data.fullName).toBe('Renamed');
    const res = await ba.post(`/api/v1/users/${id}/deactivate`);
    expect(res.body.data.status).toBe('deactivated');
    expect((await as(app, world.sessions.kanoSales).get('/api/v1/auth/me')).status).toBe(401);
    expect((await ba.post(`/api/v1/users/${id}/activate`)).body.data.status).toBe('active');
  });

  it('branch admin cannot manage a peer branch admin or promote staff', async () => {
    const other = await makeBranch('KAN02');
    await as(app, world.sessions.superAdmin).put(`/api/v1/users/${world.users.abujaAdmin._id}/branches`, {
      branches: [world.branches.abuja._id.toString(), world.branches.kano._id.toString()],
    });
    const ba = as(app, world.sessions.kanoAdmin);
    expect((await ba.post(`/api/v1/users/${world.users.abujaAdmin._id}/deactivate`)).status).toBe(403);
    expect((await ba.patch(`/api/v1/users/${world.users.kanoSales._id}`, { role: 'BRANCH_ADMIN' })).status).toBe(403);
    expect((await ba.patch(`/api/v1/users/${world.users.kanoSales._id}`, { branches: [other._id.toString()] })).status).toBe(403);
  });

  it('prevents self-deactivation and removing the last super admin', async () => {
    const sa = as(app, world.sessions.superAdmin);
    expect((await sa.post(`/api/v1/users/${world.users.superAdmin._id}/deactivate`)).status).toBe(403);
    expect((await sa.patch(`/api/v1/users/${world.users.superAdmin._id}`, { role: 'BRANCH_ADMIN' })).status).toBe(403);
  });

  it('admin password reset sets a temporary password, signs the user out and forces a change', async () => {
    const res = await as(app, world.sessions.kanoAdmin).post(`/api/v1/users/${world.users.kanoSales._id}/reset-password`, {
      temporaryPassword: 'Reset12345',
    });
    expect(res.body.data.mustChangePassword).toBe(true);
    expect((await as(app, world.sessions.kanoSales).get('/api/v1/auth/me')).status).toBe(401);
    await expect(login(app, 'sales.kano@test.local', PASSWORD)).rejects.toThrow();
    await login(app, 'sales.kano@test.local', 'Reset12345');
  });

  it('reassigning a branch admin moves them between branch admin lists', async () => {
    const res = await as(app, world.sessions.superAdmin).put(`/api/v1/users/${world.users.kanoAdmin._id}/branches`, {
      branches: [world.branches.abuja._id.toString()],
    });
    expect(res.status).toBe(200);
    const [kano, abuja] = await Promise.all([Branch.findById(world.branches.kano._id).lean(), Branch.findById(world.branches.abuja._id).lean()]);
    expect(kano?.admins.map(String)).not.toContain(world.users.kanoAdmin._id.toString());
    expect(abuja?.admins.map(String)).toContain(world.users.kanoAdmin._id.toString());
    // Their scope changes on the very next request.
    const list = await as(app, world.sessions.kanoAdmin).get('/api/v1/users');
    expect(list.body.data.map((u: { fullName: string }) => u.fullName)).toContain('Abuja Sales');
  });

  it('promotes a super admin demotion only with branches, and only while another super admin exists', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const second = await sa.post('/api/v1/users', staffBody({ role: 'SUPER_ADMIN', branches: [], email: 'second@test.local', phone: '08091112223' }));
    expect(second.status).toBe(201);
    const noBranches = await sa.patch(`/api/v1/users/${second.body.data.id}`, { role: 'BRANCH_ADMIN' });
    expect(noBranches.body.error.code).toBe('BRANCHES_REQUIRED');
    const ok = await sa.patch(`/api/v1/users/${second.body.data.id}`, { role: 'BRANCH_ADMIN', branches: [world.branches.kano._id.toString()] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.role).toBe('BRANCH_ADMIN');
    expect(await AuditLog.countDocuments({ action: 'user.role_changed' })).toBe(1);
  });
});

describe('cross-branch access grants', () => {
  const grantBody = (branch: string, permissions = ['users:read'], days = 7) => ({
    branch,
    permissions,
    expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    reason: 'Covering for the Abuja admin on leave',
  });

  it('gives a branch admin explicit, time-limited access to another branch', async () => {
    const abujaId = world.branches.abuja._id.toString();
    const before = await as(app, world.sessions.kanoAdmin).get(`/api/v1/users/${world.users.abujaSales._id}`);
    expect(before.status).toBe(404);

    const grant = await as(app, world.sessions.superAdmin).post(`/api/v1/users/${world.users.kanoAdmin._id}/branch-access-grants`, grantBody(abujaId));
    expect(grant.status).toBe(201);
    expect(grant.body.data.grants).toHaveLength(1);

    const during = await as(app, world.sessions.kanoAdmin).get(`/api/v1/users/${world.users.abujaSales._id}`);
    expect(during.status).toBe(200);
    // The grant covers only the listed permission: still no edits in Abuja.
    const edit = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/users/${world.users.abujaSales._id}`, { fullName: 'X' });
    expect(edit.status).toBe(404);
    const me = await as(app, world.sessions.kanoAdmin).get('/api/v1/auth/me');
    expect(me.body.data.grants[0].branch.code).toBe('ABJ01');

    const revoke = await as(app, world.sessions.superAdmin).delete(
      `/api/v1/users/${world.users.kanoAdmin._id}/branch-access-grants/${grant.body.data.grants[0].id}`,
    );
    expect(revoke.status).toBe(200);
    expect((await as(app, world.sessions.kanoAdmin).get(`/api/v1/users/${world.users.abujaSales._id}`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: { $in: ['user.branch_access_granted', 'user.branch_access_revoked'] } })).toBe(2);
  });

  it('rejects grants for permissions the role does not have, or company-only permissions', async () => {
    const abujaId = world.branches.abuja._id.toString();
    const sa = as(app, world.sessions.superAdmin);
    expect((await sa.post(`/api/v1/users/${world.users.kanoSales._id}/branch-access-grants`, grantBody(abujaId, ['users:read']))).status).toBe(400);
    expect((await sa.post(`/api/v1/users/${world.users.kanoAdmin._id}/branch-access-grants`, grantBody(abujaId, ['branches:create']))).status).toBe(400);
    expect((await sa.post(`/api/v1/users/${world.users.kanoAdmin._id}/branch-access-grants`, grantBody(world.branches.kano._id.toString()))).status).toBe(400);
    const past = { ...grantBody(abujaId), expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect((await sa.post(`/api/v1/users/${world.users.kanoAdmin._id}/branch-access-grants`, past)).status).toBe(422);
  });

  it('only the super admin can issue grants', async () => {
    const res = await as(app, world.sessions.kanoAdmin).post(
      `/api/v1/users/${world.users.kanoSales._id}/branch-access-grants`,
      grantBody(world.branches.abuja._id.toString(), ['orders:read']),
    );
    expect(res.status).toBe(403);
  });
});
