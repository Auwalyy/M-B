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
import { Brand, Category, Product } from '../modules/catalog/catalog.models';
import { applyStockChange } from '../modules/inventory/inventory.service';
import { slugify } from '../core/text/slug';

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

  await seedCatalog(branchIds);

  console.warn('\nSeed complete. Sign in with any of these (password: %s):', process.env.SEED_PASSWORD ? '$SEED_PASSWORD' : PASSWORD);
  for (const u of [...USERS, { email: 'customer@mb.test', role: 'CUSTOMER', branches: ['KAN01'] }]) {
    console.warn(`  ${u.role.padEnd(13)} ${u.email.padEnd(24)} ${u.branches.join(', ')}`);
  }
}

/** Development catalogue with opening stock, recorded through the normal stock ledger. Runs only on an empty catalogue. */
async function seedCatalog(branchIds: Map<string, mongoose.Types.ObjectId>) {
  if (await Product.exists({})) return;
  const naira = (n: number) => n * 100;
  const cat = async (name: string, parent?: { _id: mongoose.Types.ObjectId; ancestors: mongoose.Types.ObjectId[] }) =>
    Category.create({ name, slug: slugify(name), parent: parent?._id ?? null, ancestors: parent ? [...parent.ancestors, parent._id] : [] });
  const electronics = await cat('Electronics');
  const tvs = await cat('Televisions', electronics);
  const appliances = await cat('Home Appliances');
  const cooling = await cat('Fridges & Freezers', appliances);
  const fans = await cat('Fans & Air Conditioners', appliances);
  const fashion = await cat('Fashion');

  const brand = async (name: string) => Brand.create({ name, slug: slugify(name) });
  const [samsung, lg, hisense, thermocool, binatone] = await Promise.all(['Samsung', 'LG', 'Hisense', 'Thermocool', 'Binatone'].map(brand));

  type Seed = { name: string; sku: string; category: typeof tvs; brand?: typeof samsung; price: number; discount?: number; cost: number; featured?: boolean; specs?: [string, string][]; variants?: { sku: string; size: string; color?: string }[]; stock: Record<string, number> };
  const products: Seed[] = [
    { name: 'Samsung 55" Crystal UHD 4K Smart TV', sku: 'SAM-TV-055', category: tvs, brand: samsung, price: 685_000, discount: 649_000, cost: 560_000, featured: true, specs: [['Screen size', '55"'], ['Resolution', '4K UHD'], ['Warranty', '2 years']], stock: { KAN01: 12, KAN02: 4, ABJ01: 7 } },
    { name: 'Hisense 43" Full HD Smart TV', sku: 'HIS-TV-043', category: tvs, brand: hisense, price: 315_000, cost: 260_000, specs: [['Screen size', '43"'], ['Resolution', 'Full HD']], stock: { KAN01: 9, ABJ01: 3 } },
    { name: 'LG 2-Door Refrigerator 360L', sku: 'LG-FRG-360', category: cooling, brand: lg, price: 845_000, cost: 700_000, featured: true, specs: [['Capacity', '360 litres'], ['Energy rating', 'A+']], stock: { KAN01: 3, ABJ01: 5 } },
    { name: 'Thermocool Chest Freezer 250L', sku: 'THC-FRZ-250', category: cooling, brand: thermocool, price: 498_000, discount: 475_000, cost: 400_000, specs: [['Capacity', '250 litres']], stock: { KAN01: 6, KAN02: 6, ABJ01: 2 } },
    { name: 'Binatone 18" Standing Fan', sku: 'BIN-FAN-018', category: fans, brand: binatone, price: 42_000, cost: 31_000, stock: { KAN01: 40, KAN02: 25, ABJ01: 15 } },
    { name: 'Hisense 1.5HP Split Air Conditioner', sku: 'HIS-AC-15', category: fans, brand: hisense, price: 465_000, cost: 380_000, stock: { ABJ01: 4 } },
    {
      name: 'Embroidered Kaftan',
      sku: 'MB-KAF-001',
      category: fashion,
      price: 35_000,
      cost: 18_000,
      variants: [{ sku: 'MB-KAF-001-M', size: 'M', color: 'White' }, { sku: 'MB-KAF-001-L', size: 'L', color: 'White' }, { sku: 'MB-KAF-001-XL', size: 'XL', color: 'Sky blue' }],
      stock: { KAN01: 8, KAN02: 10 },
    },
  ];

  const settings = await getSettingsDoc();
  for (const s of products) {
    const product = await Product.create({
      name: s.name,
      slug: slugify(s.name),
      sku: s.sku,
      category: s.category._id,
      categoryPath: [...s.category.ancestors, s.category._id],
      brand: s.brand?._id ?? null,
      price: naira(s.price),
      discountPrice: s.discount ? naira(s.discount) : null,
      costPrice: naira(s.cost),
      description: `${s.name}. Genuine product with warranty, available for pickup or delivery from Mudassir & Brothers branches.`,
      specifications: (s.specs ?? []).map(([label, value]) => ({ label, value })),
      hasVariants: Boolean(s.variants),
      variants: s.variants ?? [],
      isFeatured: Boolean(s.featured),
      status: 'active',
    });
    for (const [code, qty] of Object.entries(s.stock)) {
      const lines = product.hasVariants ? product.variants.map((v) => ({ variantId: v._id, sku: v.sku, qty: Math.ceil(qty / product.variants.length) })) : [{ variantId: null, sku: product.sku, qty }];
      for (const l of lines) {
        await applyStockChange({
          branch: branchIds.get(code)!,
          product: product._id,
          variantId: l.variantId,
          sku: l.sku,
          delta: l.qty,
          type: 'stock_in',
          reference: { kind: 'StockReceipt', id: new mongoose.Types.ObjectId(), label: 'Opening stock (seed)' },
          reason: 'Opening stock',
          performedBy: null,
          lowStockDefault: settings.lowStockDefault,
        });
      }
    }
  }
  console.warn(`Seeded ${products.length} products in 6 categories with opening stock.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
