import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Page, expect } from '@playwright/test';

export const PASSWORD = 'Password123';
export const STAFF = {
  owner: 'owner@mb.test',
  kanoAdmin: 'admin.kan01@mb.test',
  kanoSales: 'sales.kan01@mb.test',
  abujaAdmin: 'admin.abj01@mb.test',
} as const;

export async function signIn(page: Page, email: string, landing: RegExp = /\/admin/) {
  await page.goto('/login');
  await page.getByLabel('Email or phone number').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(landing);
}

/**
 * WCAG 2.1 A and AA checks with axe. Any violation fails the test, with a readable summary.
 */
export async function expectAccessible(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = result.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label} accessibility`).toEqual([]);
}

/** Places a guest pickup order straight through the API, as the storefront would. */
export async function placeGuestOrder(request: APIRequestContext, opts: { product: string; branchCode: string; phone: string; name?: string }) {
  const products = await (await request.get('/api/v1/products', { params: { q: opts.product } })).json();
  const product = products.data[0];
  const branches = await (await request.get('/api/v1/branches', { params: { view: 'public', limit: 50 } })).json();
  const branch = branches.data.find((b: { code: string }) => b.code === opts.branchCode);
  expect((await request.put('/api/v1/cart/items', { data: { product: product.id, variantId: null, quantity: 1 } })).ok()).toBeTruthy();
  expect((await request.put('/api/v1/cart/branch', { data: { branch: branch.id } })).ok()).toBeTruthy();
  const res = await request.post('/api/v1/checkout', {
    data: { fulfilment: 'pickup', paymentMethod: 'pay_on_pickup', idempotencyKey: crypto.randomUUID(), contact: { fullName: opts.name ?? 'E2E Guest', phone: opts.phone } },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data as { id: string; reference: string; total: number };
}
