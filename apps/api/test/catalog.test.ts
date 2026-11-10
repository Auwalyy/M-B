import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from '../src/core/storage/storage';
import { Product } from '../src/modules/catalog/catalog.models';
import { type FakeStorage, pngBytes } from './fakeStorage';
import { as, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let cat: Awaited<ReturnType<typeof makeCatalog>>;
const storage = () => getStorage() as FakeStorage;

beforeEach(async () => {
  world = await makeWorld(app);
  cat = await makeCatalog(app, world.sessions.superAdmin);
});

describe('categories', () => {
  it('builds a tree and lets visitors see only active branches of it', async () => {
    expect(cat.tvs.ancestors).toEqual([cat.electronics.id]);
    await as(app, world.sessions.superAdmin).patch(`/api/v1/categories/${cat.electronics.id}`, { status: 'inactive' });
    const pub = await request(app).get('/api/v1/categories');
    // The parent is inactive, so its active child is hidden too.
    expect(pub.body.data).toEqual([]);
    const staff = await as(app, world.sessions.kanoAdmin).get('/api/v1/categories');
    expect(staff.body.data).toHaveLength(2);
  });

  it('moving a category re-roots its subcategories and products, and refuses cycles', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const home = (await sa.post('/api/v1/categories', { name: 'Home' })).body.data;
    const smart = (await sa.post('/api/v1/categories', { name: 'Smart TVs', parent: cat.tvs.id })).body.data;

    const cycle = await sa.patch(`/api/v1/categories/${cat.electronics.id}`, { parent: smart.id });
    expect(cycle.status).toBe(400);

    const moved = await sa.patch(`/api/v1/categories/${cat.tvs.id}`, { parent: home.id });
    expect(moved.body.data.ancestors).toEqual([home.id]);
    const smartAfter = (await sa.get('/api/v1/categories')).body.data.find((c: { id: string }) => c.id === smart.id);
    expect(smartAfter.ancestors).toEqual([home.id, cat.tvs.id]);
    const tv = await Product.findById(cat.tv.id).lean();
    expect(tv!.categoryPath.map(String)).toEqual([home.id, cat.tvs.id]);

    // Filtering by the new parent finds the TV.
    const byHome = await request(app).get(`/api/v1/products?category=${home.id}`);
    expect(byHome.body.data.map((p: { sku: string }) => p.sku)).toEqual(['SAM-TV-001']);
  });

  it('refuses to delete a category that is in use', async () => {
    const res = await as(app, world.sessions.superAdmin).delete(`/api/v1/categories/${cat.tvs.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('only head office can manage the catalogue', async () => {
    for (const s of [world.sessions.kanoAdmin, world.sessions.kanoSales]) {
      expect((await as(app, s).post('/api/v1/categories', { name: 'X' })).status).toBe(403);
      expect((await as(app, s).post('/api/v1/brands', { name: 'X' })).status).toBe(403);
      expect((await as(app, s).patch(`/api/v1/products/${cat.tv.id}`, { price: 1 })).status).toBe(403);
    }
  });
});

describe('products', () => {
  it('stores money in kobo, derives the effective price, and generates a slug', () => {
    expect(cat.tv).toMatchObject({ slug: 'samsung-55-qled-tv', price: 65_000_000, discountPrice: 60_000_000, costPrice: 50_000_000 });
  });

  it('keeps SKUs unique across products and variants', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const dupe = await sa.post('/api/v1/products', { name: 'Other', sku: 'KAF-001-M-WHT', category: cat.tvs.id, price: 100 });
    expect(dupe.status).toBe(409);
    const dupeVariant = await sa.post('/api/v1/products', {
      name: 'Other', sku: 'OTH-1', category: cat.tvs.id, price: 100, hasVariants: true, variants: [{ sku: 'SAM-TV-001', size: 'M' }],
    });
    expect(dupeVariant.status).toBe(409);
    const sameTwice = await sa.post('/api/v1/products', {
      name: 'Other', sku: 'OTH-2', category: cat.tvs.id, price: 100, hasVariants: true, variants: [{ sku: 'OTH-2-A', size: 'M' }, { sku: 'OTH-2-A', size: 'L' }],
    });
    expect(sameTwice.status).toBe(422);
  });

  it('rejects a discount that is not below the price, also on partial updates', async () => {
    const res = await as(app, world.sessions.superAdmin).patch(`/api/v1/products/${cat.tv.id}`, { price: 50_000_000 });
    expect(res.status).toBe(422);
    expect(res.body.error.details.discountPrice).toBeTruthy();
  });

  it('hides drafts and cost prices from visitors; branch staff see stock but not cost', async () => {
    const sa = as(app, world.sessions.superAdmin);
    await sa.post('/api/v1/products', { name: 'Secret draft', sku: 'DRF-1', category: cat.tvs.id, price: 100 });
    const pub = await request(app).get('/api/v1/products');
    expect(pub.body.data.map((p: { sku: string }) => p.sku).sort()).toEqual(['KAF-001', 'SAM-TV-001']);
    expect(pub.body.data[0]).not.toHaveProperty('costPrice');
    expect(pub.body.data[0]).not.toHaveProperty('stock');
    expect((await request(app).get('/api/v1/products/drf-1')).status).toBe(404);

    const sales = await as(app, world.sessions.kanoSales).get('/api/v1/products');
    expect(sales.body.meta.total).toBe(3);
    expect(sales.body.data[0]).toHaveProperty('stock');
    expect(sales.body.data[0]).not.toHaveProperty('costPrice');
  });

  it('searches by name, SKU and variant SKU, and filters by price', async () => {
    const q = async (qs: string) => (await request(app).get(`/api/v1/products?${qs}`)).body.data.map((p: { sku: string }) => p.sku);
    expect(await q('q=qled')).toEqual(['SAM-TV-001']);
    expect(await q('q=KAF-001-L')).toEqual(['KAF-001']);
    expect(await q('maxPrice=2000000')).toEqual(['KAF-001']);
    expect(await q('sort=price_desc')).toEqual(['SAM-TV-001', 'KAF-001']);
  });

  it('refuses to remove a variant that still has stock, but allows marking it inactive', async () => {
    const variant = cat.kaftan.variants[0];
    await stockIn(app, world.sessions.kanoAdmin, world.branches.kano._id.toString(), cat.kaftan.id, 3, variant.id);
    const sa = as(app, world.sessions.superAdmin);
    const keep = cat.kaftan.variants[1];
    const remove = await sa.patch(`/api/v1/products/${cat.kaftan.id}`, { variants: [{ id: keep.id, sku: keep.sku, size: keep.size, color: keep.color }] });
    expect(remove.status).toBe(409);
    expect(remove.body.error.code).toBe('HAS_STOCK');

    const inactive = await sa.patch(`/api/v1/products/${cat.kaftan.id}`, {
      variants: [{ id: variant.id, sku: variant.sku, size: 'M', color: 'White', status: 'inactive' }, { id: keep.id, sku: keep.sku, size: keep.size, color: keep.color }],
    });
    expect(inactive.status, JSON.stringify(inactive.body)).toBe(200);
    expect(inactive.body.data.variants[0]).toMatchObject({ id: variant.id, status: 'inactive' });
  });

  it('cannot switch variant mode while stock exists', async () => {
    await stockIn(app, world.sessions.kanoAdmin, world.branches.kano._id.toString(), cat.tv.id, 2);
    const res = await as(app, world.sessions.superAdmin).patch(`/api/v1/products/${cat.tv.id}`, { hasVariants: true, variants: [{ sku: 'SAM-TV-001-B', color: 'Black' }] });
    expect(res.status).toBe(409);
  });
});

describe('product images', () => {
  it('uploads, reorders and removes images, validating real file contents', async () => {
    const sa = world.sessions.superAdmin;
    const up = await request(app)
      .post(`/api/v1/products/${cat.tv.id}/images`)
      .set('Authorization', `Bearer ${sa.token}`)
      .attach('images', pngBytes(), 'front.png')
      .attach('images', pngBytes(), 'back.png');
    expect(up.status).toBe(201);
    expect(up.body.data.images).toHaveLength(2);
    expect(storage().uploads.map((u) => u.folder)).toEqual(['products', 'products']);

    const [a, b] = up.body.data.images;
    const reordered = await as(app, sa).put(`/api/v1/products/${cat.tv.id}/images`, { images: [{ id: b.id, alt: 'Back view' }, { id: a.id }] });
    expect(reordered.body.data.images.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    expect(reordered.body.data.images[0].alt).toBe('Back view');

    const removed = await as(app, sa).delete(`/api/v1/products/${cat.tv.id}/images/${a.id}`);
    expect(removed.body.data.images).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(storage().removed).toHaveLength(1);
  });

  it('rejects files that are not images even when named like one', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${cat.tv.id}/images`)
      .set('Authorization', `Bearer ${world.sessions.superAdmin.token}`)
      .attach('images', Buffer.from('<script>alert(1)</script>'), 'evil.png');
    expect(res.status).toBe(415);
    expect(storage().uploads).toHaveLength(0);
  });

  it('does not accept uploads from people without permission (and never stores them)', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${cat.tv.id}/images`)
      .set('Authorization', `Bearer ${world.sessions.kanoAdmin.token}`)
      .attach('images', pngBytes(), 'a.png');
    expect(res.status).toBe(403);
    expect(storage().uploads).toHaveLength(0);
  });

  it('sets a brand logo', async () => {
    const res = await request(app)
      .post(`/api/v1/brands/${cat.samsung.id}/logo`)
      .set('Authorization', `Bearer ${world.sessions.superAdmin.token}`)
      .attach('image', pngBytes(), 'logo.png');
    expect(res.status).toBe(200);
    expect(res.body.data.logo.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
  });
});

describe('branch availability (storefront)', () => {
  it('shows levels per branch and never exact quantities', async () => {
    await stockIn(app, world.sessions.kanoAdmin, world.branches.kano._id.toString(), cat.tv.id, 40);
    await stockIn(app, world.sessions.abujaAdmin, world.branches.abuja._id.toString(), cat.tv.id, 2);
    const res = await request(app).get(`/api/v1/products/${cat.tv.slug}/availability`);
    const byCode = Object.fromEntries(res.body.data.map((a: { branch: { code: string }; level: string }) => [a.branch.code, a.level]));
    expect(byCode).toEqual({ KAN01: 'in_stock', ABJ01: 'low' });
    expect(JSON.stringify(res.body)).not.toMatch(/"(quantity|available|reserved)"/);
  });

  it('reports each variant separately and treats hidden items as out of stock', async () => {
    const [m, l] = cat.kaftan.variants;
    const inv = await stockIn(app, world.sessions.kanoAdmin, world.branches.kano._id.toString(), cat.kaftan.id, 20, m.id);
    let res = await request(app).get(`/api/v1/products/${cat.kaftan.slug}/availability`);
    const kano = res.body.data.find((a: { branch: { code: string } }) => a.branch.code === 'KAN01');
    expect(kano.levels).toEqual({ [m.id]: 'in_stock', [l.id]: 'out' });
    expect(kano.level).toBe('in_stock');

    await as(app, world.sessions.kanoAdmin).patch(`/api/v1/inventory/${inv.id}`, { isAvailable: false });
    res = await request(app).get(`/api/v1/products/${cat.kaftan.slug}/availability`);
    expect(res.body.data.find((a: { branch: { code: string } }) => a.branch.code === 'KAN01').level).toBe('out');
  });

  it('lists only products in stock at a chosen branch', async () => {
    await stockIn(app, world.sessions.abujaAdmin, world.branches.abuja._id.toString(), cat.tv.id, 5);
    const res = await request(app).get(`/api/v1/products?branch=${world.branches.abuja._id}&inStock=true`);
    expect(res.body.data.map((p: { sku: string }) => p.sku)).toEqual(['SAM-TV-001']);
  });
});
