import type { RoleKey } from '@mb/shared';
import type { Express } from 'express';
import type { Types } from 'mongoose';
import request from 'supertest';
import { type AppOptions, createApp } from '../src/app';
import { hashPassword } from '../src/core/auth/password';
import { Branch } from '../src/modules/branches/branch.model';
import { getRoleByKey } from '../src/modules/roles/role.service';
import { User } from '../src/modules/users/user.model';
import { syncBranchAdmins } from '../src/modules/users/user.service';

export const PASSWORD = 'Password123';
let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(PASSWORD));

export function makeApp(options?: AppOptions): Express {
  return createApp(options).app;
}

let phoneSeq = 1000;
const nextPhone = () => `+23480${String(10_000_000 + phoneSeq++).slice(-8)}`;

export async function makeBranch(code: string, overrides: Record<string, unknown> = {}) {
  return Branch.create({
    name: `Branch ${code}`,
    code,
    address: `1 ${code} Street`,
    city: code.startsWith('ABJ') ? 'Abuja' : 'Kano',
    state: code.startsWith('ABJ') ? 'FCT' : 'Kano',
    phone: nextPhone(),
    whatsapp: nextPhone(),
    ...overrides,
  });
}

export async function makeUser(opts: {
  role: RoleKey;
  branches?: Types.ObjectId[];
  email?: string;
  fullName?: string;
  status?: 'active' | 'suspended' | 'deactivated';
  mustChangePassword?: boolean;
}) {
  const role = await getRoleByKey(opts.role);
  const user = await User.create({
    fullName: opts.fullName ?? `${opts.role} user`,
    email: opts.email ?? `${opts.role.toLowerCase()}.${phoneSeq}@test.local`,
    phone: nextPhone(),
    passwordHash: await passwordHash(),
    role: role._id,
    roleKey: role.key,
    branches: opts.branches ?? [],
    status: opts.status ?? 'active',
    mustChangePassword: opts.mustChangePassword ?? false,
  });
  await syncBranchAdmins(user._id);
  return user;
}

export interface Session {
  token: string;
  cookie: string;
  userId: string;
}

export async function login(app: Express, identifier: string, password = PASSWORD): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`Login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('mb_rt='))!;
  return { token: res.body.data.accessToken, cookie: cookie.split(';')[0]!, userId: res.body.data.user.id };
}

/** Authenticated request helper. */
export function as(app: Express, session: Session) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${session.token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(app).put(url)).send(body ?? {}),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}

/**
 * A two-state company: Kano (KAN01) and Abuja (ABJ01), each with a branch admin
 * and a sales staff member, plus a super admin. Everyone is signed in.
 */
export async function makeWorld(app: Express) {
  const kano = await makeBranch('KAN01');
  const abuja = await makeBranch('ABJ01');
  const users = {
    superAdmin: await makeUser({ role: 'SUPER_ADMIN', email: 'owner@test.local', fullName: 'Owner' }),
    kanoAdmin: await makeUser({ role: 'BRANCH_ADMIN', branches: [kano._id], email: 'admin.kano@test.local', fullName: 'Kano Admin' }),
    abujaAdmin: await makeUser({ role: 'BRANCH_ADMIN', branches: [abuja._id], email: 'admin.abuja@test.local', fullName: 'Abuja Admin' }),
    kanoSales: await makeUser({ role: 'SALES_STAFF', branches: [kano._id], email: 'sales.kano@test.local', fullName: 'Kano Sales' }),
    abujaSales: await makeUser({ role: 'SALES_STAFF', branches: [abuja._id], email: 'sales.abuja@test.local', fullName: 'Abuja Sales' }),
  };
  const sessions = {
    superAdmin: await login(app, 'owner@test.local'),
    kanoAdmin: await login(app, 'admin.kano@test.local'),
    abujaAdmin: await login(app, 'admin.abuja@test.local'),
    kanoSales: await login(app, 'sales.kano@test.local'),
    abujaSales: await login(app, 'sales.abuja@test.local'),
  };
  return { branches: { kano, abuja }, users, sessions };
}

export const validBranchBody = (code: string) => ({
  name: `New ${code}`,
  code,
  address: '22 Murtala Mohammed Way',
  city: 'Kano',
  state: 'Kano',
  phone: '0803 555 0101',
  whatsapp: '0803 555 0101',
});

// ------------------------------------------------------------------ Phase 2 fixtures

/** Creates a category tree (Electronics > TVs) and two products through the API as the super admin. */
export async function makeCatalog(app: Express, sa: Session) {
  const api = as(app, sa);
  const electronics = (await api.post('/api/v1/categories', { name: 'Electronics' })).body.data;
  const tvs = (await api.post('/api/v1/categories', { name: 'Televisions', parent: electronics.id })).body.data;
  const samsung = (await api.post('/api/v1/brands', { name: 'Samsung' })).body.data;
  const tvRes = await api.post('/api/v1/products', {
    name: 'Samsung 55" QLED TV',
    sku: 'SAM-TV-001',
    category: tvs.id,
    brand: samsung.id,
    price: 65_000_000,
    discountPrice: 60_000_000,
    costPrice: 50_000_000,
    status: 'active',
  });
  if (tvRes.status !== 201) throw new Error(`product create failed: ${JSON.stringify(tvRes.body)}`);
  const shirtRes = await api.post('/api/v1/products', {
    name: 'Kaftan',
    sku: 'KAF-001',
    category: electronics.id,
    price: 1_500_000,
    status: 'active',
    hasVariants: true,
    variants: [
      { sku: 'KAF-001-M-WHT', size: 'M', color: 'White' },
      { sku: 'KAF-001-L-WHT', size: 'L', color: 'White' },
    ],
  });
  if (shirtRes.status !== 201) throw new Error(`variant product create failed: ${JSON.stringify(shirtRes.body)}`);
  return { electronics, tvs, samsung, tv: tvRes.body.data, kaftan: shirtRes.body.data };
}

export async function stockIn(app: Express, s: Session, branch: string, product: string, quantity: number, variantId: string | null = null) {
  const res = await as(app, s).post('/api/v1/inventory/stock-in', { branch, items: [{ product, variantId, quantity }], reference: 'INV-1' });
  if (res.status !== 201) throw new Error(`stock-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data[0];
}
