import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

test.describe('Pinned messages', () => {
  test('pin a message and see it in the pinned panel', async ({ page }) => {
    await register(page, uniqueUser('pin'));
    await createSpace(page, `PinSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = 'Message to pin';
    await page.locator('.compose input:not([type="file"])').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // Pin the message
    await page.locator('[title="Pin"]').first().click();
    // Pin indicator should appear on the message
    await expect(page.locator('.msg-pin-indicator').first()).toBeVisible({ timeout: 3_000 });

    // Open the pinned panel via header button
    await page.locator('.header-pin-btn').click();
    await expect(page.locator('.pinned-panel')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.pinned-msg-content', { hasText: msg })).toBeVisible({ timeout: 3_000 });
  });

  test('pinned panel shows empty state when no messages are pinned', async ({ page }) => {
    await register(page, uniqueUser('pinEmpty'));
    await createSpace(page, `PinEmptySpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-pin-btn').click();
    await expect(page.locator('.pinned-panel')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.pinned-panel-empty')).toBeVisible({ timeout: 3_000 });
  });

  test('unpin a message removes it from the pinned panel', async ({ page }) => {
    await register(page, uniqueUser('unpin'));
    await createSpace(page, `UnpinSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = 'Message to unpin';
    await page.locator('.compose input:not([type="file"])').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // Pin the message
    await page.locator('[title="Pin"]').first().click();
    await expect(page.locator('.msg-pin-indicator').first()).toBeVisible({ timeout: 3_000 });

    // Unpin it
    await page.locator('[title="Unpin"]').first().click();
    await expect(page.locator('.msg-pin-indicator')).not.toBeVisible({ timeout: 3_000 });

    // Open the pinned panel — should be empty
    await page.locator('.header-pin-btn').click();
    await expect(page.locator('.pinned-panel-empty')).toBeVisible({ timeout: 3_000 });
  });

  test('pinned panel can be closed', async ({ page }) => {
    await register(page, uniqueUser('pinClose'));
    await createSpace(page, `PinCloseSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-pin-btn').click();
    await expect(page.locator('.pinned-panel')).toBeVisible({ timeout: 3_000 });

    await page.locator('.pinned-panel-close').click();
    await expect(page.locator('.pinned-panel')).not.toBeVisible({ timeout: 3_000 });
  });
});
