/**
 * Development seed: branches in Kano and Abuja, plus a super admin, branch admins,
 * sales staff and a customer. Safe to run repeatedly (upserts by code, email or phone).
 *
 *   npm run seed            # add or update seed data
 *   npm run seed -- --reset # drop the database first (development only)
 *
 * Branch addresses and phone numbers are placeholders. Replace them with real details
 * in the admin before going live.
 */
import mongoose from 'mongoose';
import type { RoleKey } from '@mb/shared';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { hashPassword } from '../core/auth/password';
import { Branch } from '../modules/branches/branch.model';
import { Customer } from '../modules/customers/customer.model';
import { ensureSystemRoles, getRoleByKey } from '../modules/roles/role.service';
import { getSettingsDoc } from '../modules/settings/settings.service';
import { syncBranchAdmins } from '../modules/users/user.service';
import { User } from '../modules/users/user.model';

const args = new Set(process.argv.slice(2));
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123';

const BRANCHES = [
  {
    code: 'KAN01',
    name: 'Kano – Zoo Road',
    address: '12 Zoo Road',
    area: 'Gyadi-Gyadi',
    landmark: 'Opposite the Kano Zoological Garden',
    city: 'Kano',
    state: 'Kano',
    phone: '+2348000000101',
    whatsapp: '+2348000000101',
    location: { type: 'Point' as const, coordinates: [8.5167, 11.9833] as [number, number] },
  },
  {
    code: 'KAN02',
    name: 'Kano – Sabon Gari',
    address: '45 Bello Road',
    area: 'Sabon Gari',
    landmark: 'Near Sabon Gari Market',
    city: 'Kano',
    state: 'Kano',
    phone: '+2348000000102',
    whatsapp: '+2348000000102',
    location: { type: 'Point' as const, coordinates: [8.5306, 12.0122] as [number, number] },
  },
  {
    code: 'ABJ01',
    name: 'Abuja – Wuse 2',
    address: '8 Aminu Kano Crescent',
    area: 'Wuse 2',
    landmark: 'Beside Banex Plaza',
    city: 'Abuja',
    state: 'FCT',
    phone: '+2348000000201',
    whatsapp: '+2348000000201',
    location: { type: 'Point' as const, coordinates: [7.4723, 9.0765] as [number, number] },
  },
];

interface SeedUser {
  fullName: string;
  email: string;
  phone: string;
  role: RoleKey;
  branches: string[];
}

const USERS: SeedUser[] = [
  { fullName: 'Mudassir Owner', email: 'owner@mb.test', phone: '+2348000001000', role: 'SUPER_ADMIN', branches: [] },
  { fullName: 'Aminu Kabir', email: 'admin.kan01@mb.test', phone: '+2348000001101', role: 'BRANCH_ADMIN', branches: ['KAN01'] },
  { fullName: 'Hauwa Sani', email: 'admin.kan02@mb.test', phone: '+2348000001102', role: 'BRANCH_ADMIN', branches: ['KAN02'] },
  { fullName: 'Chinedu Okafor', email: 'admin.abj01@mb.test', phone: '+2348000001201', role: 'BRANCH_ADMIN', branches: ['ABJ01'] },
  { fullName: 'Yusuf Bello', email: 'sales.kan01@mb.test', phone: '+2348000002101', role: 'SALES_STAFF', branches: ['KAN01'] },
  { fullName: 'Zainab Musa', email: 'sales.kan02@mb.test', phone: '+2348000002102', role: 'SALES_STAFF', branches: ['KAN02'] },
  { fullName: 'Grace Adeyemi', email: 'sales.abj01@mb.test', phone: '+2348000002201', role: 'SALES_STAFF', branches: ['ABJ01'] },
];

async function main() {
  if (env.isProd && !args.has('--force')) {
    throw new Error('Refusing to seed a production database. Use `create-super-admin` instead.');
  }
  await connectDatabase(env.MONGODB_URI);
  if (args.has('--reset')) {
    if (env.isProd) throw new Error('--reset is not allowed in production.');
    await mongoose.connection.dropDatabase();
    console.warn('Database dropped.');
  }
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
  await ensureSystemRoles();
  await getSettingsDoc();

  const branchIds = new Map<string, mongoose.Types.ObjectId>();
  for (const b of BRANCHES) {
    const doc = await Branch.findOneAndUpdate({ code: b.code }, { $set: b }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    branchIds.set(b.code, doc._id);
  }

  const passwordHash = await hashPassword(PASSWORD);
  for (const u of USERS) {
    const role = await getRoleByKey(u.role);
    const user = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          fullName: u.fullName,
          phone: u.phone,
          role: role._id,
          roleKey: role.key,
          branches: u.branches.map((c) => branchIds.get(c)!),
          status: 'active',
          mustChangePassword: false,
          failedLoginCount: 0,
        },
        $setOnInsert: { passwordHash },
        $unset: { lockedUntil: 1 },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    await syncBranchAdmins(user._id);
  }

  // A registered customer who prefers the Kano Zoo Road branch.
  const customerRole = await getRoleByKey('CUSTOMER');
  const customer = await Customer.findOneAndUpdate(
    { phone: '+2348000003001' },
    {
      $set: {
        fullName: 'Fatima Abdullahi',
        email: 'customer@mb.test',
        preferredBranch: branchIds.get('KAN01'),
        source: 'online',
      },
      $addToSet: { branchesServed: branchIds.get('KAN01') },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  const customerUser = await User.findOneAndUpdate(
    { email: 'customer@mb.test' },
    {
      $set: { fullName: customer.fullName, phone: customer.phone, role: customerRole._id, roleKey: 'CUSTOMER', customer: customer._id, status: 'active' },
      $setOnInsert: { passwordHash },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await Customer.updateOne({ _id: customer._id }, { $set: { user: customerUser._id } });

  console.warn('\nSeed complete. Sign in with any of these (password: %s):', process.env.SEED_PASSWORD ? '$SEED_PASSWORD' : PASSWORD);
  for (const u of [...USERS, { email: 'customer@mb.test', role: 'CUSTOMER', branches: ['KAN01'] }]) {
    console.warn(`  ${u.role.padEnd(13)} ${u.email.padEnd(24)} ${u.branches.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
