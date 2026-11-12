import { expect, test } from '@playwright/test';
import { expectAccessible } from './support';

test('a shopper finds a product, orders it for pickup and tracks it', async ({ page }, info) => {
  const phone = info.project.name === 'mobile' ? '0803 600 0002' : '0803 600 0001';

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page, 'home');

  await page.goto('/search?q=Binatone');
  await page.getByRole('link', { name: /Binatone 18" Standing Fan/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /Binatone 18" Standing Fan/ })).toBeVisible();

  // Branch availability is shown as a level, never as an exact count.
  const branches = page.getByRole('group', { name: 'Pick up or order from' });
  await expect(branches.getByText('Kano – Zoo Road')).toBeVisible();
  await expect(branches).not.toContainText(/\b\d+ (left|in stock|units?)\b/i);
  await expectAccessible(page, 'product page');

  await branches.getByText('Kano – Zoo Road').click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();

  await page.goto('/cart');
  await expect(page.getByText('Binatone 18" Standing Fan')).toBeVisible();
  await expectAccessible(page, 'cart');
  await page.getByRole('link', { name: 'Continue to checkout' }).click();

  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel('Full name').fill('E2E Shopper');
  await page.getByLabel('Phone number').fill(phone);
  await expectAccessible(page, 'checkout');
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByRole('heading', { name: 'Thank you, your order is placed' })).toBeVisible();
  const reference = (await page.getByText(/^ORD-KAN01-\d+$/).first().textContent())!.trim();
  await expect(page.getByText('We have your order. The branch will confirm it shortly.')).toBeVisible();
  await expectAccessible(page, 'order confirmation');

  // Tracking needs the phone used at checkout.
  await page.goto('/track');
  await page.getByLabel('Order or reservation number').fill(reference);
  await page.getByLabel('Phone number used').fill('0803 999 9999');
  await page.getByRole('button', { name: 'Track' }).click();
  await expect(page.getByText(/could not find that number with that phone/)).toBeVisible();
  await page.getByLabel('Phone number used').fill(phone);
  await page.getByRole('button', { name: 'Track' }).click();
  await expect(page.getByText(reference)).toBeVisible();
});

test('shop and branch pages are accessible', async ({ page }) => {
  for (const path of ['/shop', '/branches', '/contact', '/about', '/login', '/register']) {
    await page.goto(path);
    await expectAccessible(page, path);
  }
});
