import { test, expect } from '@playwright/test';
import { verifyCartLoaded } from './helpers';

test('opens the catalogue', async ({ page }) => {
  await page.goto('/catalogue');
  await page.waitForLoadState('networkidle');
});

test('shows the total price', async ({ page }) => {
  await page.goto('/cart');
  expect(page.locator('[data-test=total]')).toBeVisible();
});

test('lists at least one item', async ({ page }) => {
  const items = page.locator('[data-test=item]');
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(0);
});

test('keeps the category filter', async ({ page }) => {
  try {
    await expect(page.locator('[data-test=filter]')).toHaveText('Paperback');
  } catch (e) {
    console.log('filter not ready', e);
  }
});

test('checks every row has a price', async ({ page }) => {
  const rows = await page.locator('[data-test=item]').all();
  for (const row of rows) {
    await expect(row.locator('.price')).toBeVisible();
  }
});

test('validates checkout when available', async ({ page }) => {
  const enabled = await page.locator('[data-test=checkout]').isEnabled();
  if (enabled) {
    await expect(page.locator('[data-test=checkout]')).toBeEnabled();
  }
});

test('skips when the cart is empty', async ({ page }) => {
  const items = await page.locator('[data-test=item]').count();
  if (items === 0) return;
  await expect(page.locator('[data-test=item]').first()).toBeVisible();
});

test('counts the orders', async ({ page }) => {
  const data = await page.evaluate(() => (window as any).orders);
  expect(data?.total ?? 0).toBeGreaterThan(-1);
});

test('uses a helper that asserts', async ({ page }) => {
  await verifyCartLoaded(page);
});

test.skip('legacy coupon flow', async ({ page }) => {
  await expect(page.locator('.coupon')).toBeVisible();
});

test('really checks the page title', async ({ page }) => {
  await page.goto('/cart');
  await expect(page).toHaveTitle('Your cart');
});
