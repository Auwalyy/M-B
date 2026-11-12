import { expect, test } from '@playwright/test';
import { STAFF, expectAccessible, placeGuestOrder, signIn } from './support';

test.describe.configure({ mode: 'serial' });

let order: { id: string; reference: string; total: number };

test('a branch admin takes an online order from pending to completed', async ({ page, request }) => {
  order = await placeGuestOrder(request, { product: 'Binatone', branchCode: 'KAN01', phone: '08036100001', name: 'Walk Through' });

  await signIn(page, STAFF.kanoAdmin);
  await expectAccessible(page, 'branch dashboard');
  await page.goto('/admin/orders');
  // Rows open with the keyboard as well as the mouse.
  await page.getByRole('row', { name: new RegExp(order.reference) }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${order.id}`));
  await expectAccessible(page, 'order page');

  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.getByRole('button', { name: 'Start preparing' }).click();
  await page.getByRole('button', { name: 'Ready for pickup' }).click();
  // Cannot complete while money is owed.
  await expect(page.getByRole('button', { name: 'Complete order' })).toBeDisabled();

  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Amount received')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Complete order' }).click();
  await expect(page.getByText('Completed').first()).toBeVisible();
  await expect(page.getByText(/RCP-KAN01-/).first()).toBeVisible();
});

test('the branch dashboard and reports reflect the sale and export a spreadsheet', async ({ page }) => {
  await signIn(page, STAFF.kanoAdmin);
  await expect(page.getByText('Gross sales').first()).toBeVisible();
  await expect(page.getByText('Units sold')).toBeVisible();

  await page.getByRole('link', { name: 'Detailed reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(order.reference) })).toBeVisible();
  await expectAccessible(page, 'sales report');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^sales-.*\.csv$/);

  for (const tab of ['Inventory', 'Customers', 'Payments']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    await expectAccessible(page, `${tab} report`);
  }
});

test('sales staff see no reports, and other branches cannot open the order', async ({ page }) => {
  await signIn(page, STAFF.kanoSales);
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await page.goto('/admin/reports');
  await expect(page.getByText(/do not have permission/i).first()).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, STAFF.abujaAdmin);
  await page.goto(`/admin/orders/${order.id}`);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByText(order.reference)).toHaveCount(0);
});

test('the owner sees every branch compared', async ({ page }) => {
  await signIn(page, STAFF.owner);
  await expect(page.getByText('Branches compared')).toBeVisible();
  await expect(page.getByRole('link', { name: 'KAN01 · Kano – Zoo Road' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ABJ01 · Abuja – Wuse 2' })).toBeVisible();
  await expectAccessible(page, 'owner dashboard');
});
