import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit.model';
import { Branch } from '../src/modules/branches/branch.model';
import { as, makeApp, makeWorld, validBranchBody } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;

beforeEach(async () => {
  world = await makeWorld(app);
});

describe('creating branches', () => {
  it('lets the super admin create a branch, with default hours and services, and audits it', async () => {
    const res = await as(app, world.sessions.superAdmin).post('/api/v1/branches', {
      ...validBranchBody('kan02'),
      coordinates: { lat: 12.0, lng: 8.52 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: 'KAN02',
      phone: '+2348035550101',
      status: 'active',
      coordinates: { lat: 12.0, lng: 8.52 },
      settings: { reservationsEnabled: true, pickupEnabled: true, deliveryEnabled: true, reservationHoldHours: null },
    });
    expect(res.body.data.openingHours).toHaveLength(7);
    const log = await AuditLog.findOne({ action: 'branch.created' }).lean();
    expect(log?.branch?.toString()).toBe(res.body.data.id);
  });

  it('rejects duplicate codes', async () => {
    const res = await as(app, world.sessions.superAdmin).post('/api/v1/branches', validBranchBody('KAN01'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('does not let branch admins or sales staff create branches', async () => {
    for (const s of [world.sessions.kanoAdmin, world.sessions.kanoSales]) {
      const res = await as(app, s).post('/api/v1/branches', validBranchBody('KAN09'));
      expect(res.status).toBe(403);
    }
  });
});

describe('listing and viewing branches', () => {
  beforeEach(async () => {
    await Branch.create({ ...validBranchBody('ABJ02'), phone: '+2348035550101', whatsapp: '+2348035550101', status: 'inactive' });
  });

  it('shows visitors only active branches, without internal fields', async () => {
    const res = await request(app).get('/api/v1/branches');
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { code: string }) => b.code).sort()).toEqual(['ABJ01', 'KAN01']);
    expect(res.body.data[0]).not.toHaveProperty('admins');
    expect(res.body.data[0]).not.toHaveProperty('status');
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('lets visitors look up an active branch by code, but not an inactive one', async () => {
    expect((await request(app).get('/api/v1/branches/kan01')).status).toBe(200);
    expect((await request(app).get('/api/v1/branches/ABJ02')).status).toBe(404);
  });

  it('shows the super admin every branch, including inactive ones, with admins and staff counts', async () => {
    const res = await as(app, world.sessions.superAdmin).get('/api/v1/branches');
    expect(res.body.data).toHaveLength(3);
    const kano = res.body.data.find((b: { code: string }) => b.code === 'KAN01');
    expect(kano.admins).toEqual([{ id: world.users.kanoAdmin._id.toString(), fullName: 'Kano Admin' }]);
    expect(kano.staffCount).toBe(2);
  });

  it('shows a branch admin only their own branch in the management list', async () => {
    const res = await as(app, world.sessions.kanoAdmin).get('/api/v1/branches');
    expect(res.body.data.map((b: { code: string }) => b.code)).toEqual(['KAN01']);
    expect(res.body.data[0]).toHaveProperty('status');
  });

  it('gives a branch admin only the public view of another branch', async () => {
    const res = await as(app, world.sessions.kanoAdmin).get(`/api/v1/branches/${world.branches.abuja._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('admins');
  });

  it('filters by state and search text', async () => {
    const res = await as(app, world.sessions.superAdmin).get('/api/v1/branches?state=FCT&status=active');
    expect(res.body.data.map((b: { code: string }) => b.code)).toEqual(['ABJ01']);
    const search = await request(app).get('/api/v1/branches?q=abj');
    expect(search.body.data.map((b: { code: string }) => b.code)).toEqual(['ABJ01']);
  });
});

describe('updating branches', () => {
  it('lets the super admin change any field', async () => {
    const res = await as(app, world.sessions.superAdmin).patch(`/api/v1/branches/${world.branches.kano._id}`, {
      name: 'Kano – Zoo Road',
      settings: { deliveryEnabled: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Kano – Zoo Road', settings: { deliveryEnabled: false, pickupEnabled: true } });
    const log = await AuditLog.findOne({ action: 'branch.updated' }).lean();
    expect(log?.before).toMatchObject({ name: 'Branch KAN01' });
  });

  it('lets a branch admin edit contact details, hours and services of their own branch only', async () => {
    const own = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/branches/${world.branches.kano._id}`, {
      whatsapp: '0812 345 6789',
      openingHours: [{ day: 5, open: '14:00', close: '20:00', closed: false }],
      settings: { reservationHoldHours: 72 },
    });
    expect(own.status).toBe(200);
    expect(own.body.data.whatsapp).toBe('+2348123456789');
    expect(own.body.data.settings.reservationHoldHours).toBe(72);
  });

  it('stops a branch admin from changing restricted fields', async () => {
    const res = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/branches/${world.branches.kano._id}`, {
      name: 'Renamed',
      code: 'KAN99',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FIELD_NOT_EDITABLE');
  });

  it("returns 404 when a branch admin edits another branch, so its details aren't revealed", async () => {
    const res = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/branches/${world.branches.abuja._id}`, { phone: '08031234567' });
    expect(res.status).toBe(404);
  });

  it('does not let sales staff edit their branch', async () => {
    const res = await as(app, world.sessions.kanoSales).patch(`/api/v1/branches/${world.branches.kano._id}`, { phone: '08031234567' });
    expect(res.status).toBe(403);
  });

  it('deactivates and reactivates a branch, hiding it from the storefront', async () => {
    const sa = as(app, world.sessions.superAdmin);
    expect((await sa.post(`/api/v1/branches/${world.branches.abuja._id}/deactivate`)).body.data.status).toBe('inactive');
    expect((await request(app).get('/api/v1/branches')).body.data).toHaveLength(1);
    expect((await sa.post(`/api/v1/branches/${world.branches.abuja._id}/deactivate`)).status).toBe(400);
    expect((await sa.post(`/api/v1/branches/${world.branches.abuja._id}/activate`)).body.data.status).toBe('active');
    expect((await as(app, world.sessions.kanoAdmin).post(`/api/v1/branches/${world.branches.kano._id}/deactivate`)).status).toBe(403);
  });
});
