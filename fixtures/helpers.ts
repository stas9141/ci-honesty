import { expect, Page } from '@playwright/test';

export async function verifyCartLoaded(page: Page) {
  await expect(page.locator('[data-test=cart]')).toBeVisible();
}
