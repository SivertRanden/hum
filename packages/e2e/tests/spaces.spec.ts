import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

test.describe('Spaces', () => {
  test('create a new space', async ({ page }) => {
    await register(page, uniqueUser('spaces'));
    const spaceName = `TestSpace_${Date.now()}`;
    await createSpace(page, spaceName);

    // Space name appears in channel sidebar header
    await expect(page.locator('.channel-server-name')).toContainText(spaceName);
    // A "general" text channel is created automatically
    await expect(page.locator('.channel-item', { hasText: 'general' })).toBeVisible();
    // Main content no longer shows the "pick a server" placeholder
    await expect(page.locator('.pick-space')).not.toBeVisible();
  });

  test('server icon appears in rail after creation', async ({ page }) => {
    await register(page, uniqueUser('rail'));
    const spaceName = `RailSpace_${Date.now()}`;
    await createSpace(page, spaceName);

    // Server rail should show a button with the space's initials / name as title
    await expect(page.locator('.server-icon[title="' + spaceName + '"]')).toBeVisible();
  });

  test('can navigate between multiple spaces', async ({ page }) => {
    await register(page, uniqueUser('nav'));

    const name1 = `NavA_${Date.now()}`;
    const name2 = `NavB_${Date.now() + 1}`;
    await createSpace(page, name1);
    await createSpace(page, name2);

    // Click the first space icon
    await page.locator(`.server-icon[title="${name1}"]`).click();
    await expect(page.locator('.channel-server-name')).toContainText(name1);

    // Switch to second
    await page.locator(`.server-icon[title="${name2}"]`).click();
    await expect(page.locator('.channel-server-name')).toContainText(name2);
  });

  test('delete a space removes it from the rail', async ({ page }) => {
    await register(page, uniqueUser('del'));
    const spaceName = `DelSpace_${Date.now()}`;
    await createSpace(page, spaceName);

    // Delete the space using the server-delete-btn
    await page.locator(`.server-icon[title="${spaceName}"]`).hover();
    await page.locator(`.server-delete-btn[title="Delete ${spaceName}"]`).click();

    await expect(page.locator(`.server-icon[title="${spaceName}"]`)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pick-space')).toBeVisible();
  });

  test('create channel within a space', async ({ page }) => {
    await register(page, uniqueUser('chan'));
    await createSpace(page, `ChanSpace_${Date.now()}`);

    // Click the "+" button next to "Text Channels"
    await page.locator('.channel-add-btn').first().click();
    await page.locator('input.channel-create-input').fill('announcements');
    await page.locator('button.channel-create-submit').click();

    await expect(page.locator('.channel-item', { hasText: 'announcements' })).toBeVisible({ timeout: 5_000 });
  });
});
