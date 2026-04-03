import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace, joinViaInvite } from './helpers';

/** Open user settings dialog via the gear button. */
async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('.user-settings-btn').click();
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5_000 });
}

test.describe('User settings dialog', () => {
  test('opens and closes settings dialog via gear button', async ({ page }) => {
    await register(page, uniqueUser('settingsOpen'));
    await expect(page.locator('.user-settings-btn')).toBeVisible({ timeout: 5_000 });

    await openSettings(page);
    await expect(page.locator('.settings-dialog h2')).toBeVisible();

    // Close via overlay click or escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3_000 });
  });

  test('settings dialog shows notifications, appearance and voice tabs', async ({ page }) => {
    await register(page, uniqueUser('settingsTabs'));
    await openSettings(page);

    await expect(page.locator('.settings-tab', { hasText: 'Notifications' })).toBeVisible();
    await expect(page.locator('.settings-tab', { hasText: 'Appearance' })).toBeVisible();
    await expect(page.locator('.settings-tab', { hasText: 'Voice & Audio' })).toBeVisible();
  });

  test('switching to dark mode sets data-theme on document root', async ({ page }) => {
    await register(page, uniqueUser('themeToggle'));
    await openSettings(page);

    // Navigate to Appearance tab
    await page.locator('.settings-tab', { hasText: 'Appearance' }).click();
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible({ timeout: 3_000 });

    // Default theme is dark; toggle to light
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    await page.waitForTimeout(200);
    const newTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(newTheme).not.toBe(initialTheme);

    // Toggle back to original
    await toggle.click();
    await page.waitForTimeout(200);
    const revertedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(revertedTheme).toBe(initialTheme);
  });

  test('theme preference persists after page reload', async ({ page }) => {
    await register(page, uniqueUser('themePersist'));
    await openSettings(page);

    await page.locator('.settings-tab', { hasText: 'Appearance' }).click();
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible({ timeout: 3_000 });

    // Switch to light theme
    const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    await page.waitForTimeout(200);
    const afterTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(afterTheme).not.toBe(beforeTheme);

    // Reload and verify theme persists
    await page.reload();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    const reloadTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(reloadTheme).toBe(afterTheme);
  });

  test('mention notification toggle is visible on notifications tab', async ({ page }) => {
    await register(page, uniqueUser('notifToggle'));
    await openSettings(page);

    // Notifications tab is default
    const toggle = page.locator('#notify-mention');
    await expect(toggle).toBeVisible({ timeout: 3_000 });
    const initialState = await toggle.getAttribute('aria-checked');

    // Toggle it
    await toggle.click();
    const newState = await toggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);
  });
});

test.describe('User profile: display name', () => {
  test('can set display name via profile card', async ({ page }) => {
    const username = uniqueUser('dispName');
    await register(page, username);
    await createSpace(page, `DispNameSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message so we can click our own username
    await page.locator('.compose input:not([type="file"])').fill('Profile name test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Profile name test' })).toBeVisible({ timeout: 5_000 });

    // Open own profile card
    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });

    // Edit display name
    await page.locator('.profile-card-edit-btn').click();
    const newName = 'My Display Name';
    await page.locator('.profile-card-input').fill(newName);
    await page.locator('.profile-card-save').click();

    await expect(page.locator('.profile-card-display-name')).toContainText(newName, { timeout: 5_000 });
  });

  test('display name change is visible to other users', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('dispNameA');
    await register(pageA, usernameA);
    const spaceName = `DispNameVisSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    const usernameB = uniqueUser('dispNameB');
    const { ctxGuest: ctxB, pageGuest: pageB } = await joinViaInvite(browser, pageA, usernameB);
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User A sends a message
    await pageA.locator('.compose input:not([type="file"])').fill('Hello from A');
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageB.locator('.msg-content', { hasText: 'Hello from A' })).toBeVisible({ timeout: 5_000 });

    // User A changes their display name
    await pageA.locator('.msg-username').first().click();
    await expect(pageA.locator('.profile-card')).toBeVisible({ timeout: 5_000 });
    await pageA.locator('.profile-card-edit-btn').click();
    const newName = 'Alpha User';
    await pageA.locator('.profile-card-input').fill(newName);
    await pageA.locator('.profile-card-save').click();
    await expect(pageA.locator('.profile-card-display-name')).toContainText(newName, { timeout: 5_000 });
    await pageA.locator('.profile-card-close').click();

    // User B clicks on User A's username — should see updated display name
    await pageB.locator('.msg-username', { hasText: usernameA }).first().click();
    await expect(pageB.locator('.profile-card')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.profile-card-display-name')).toContainText(newName, { timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('can upload and remove an avatar via profile card', async ({ page }) => {
    const username = uniqueUser('avatarTest');
    await register(page, username);
    await createSpace(page, `AvatarSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose input:not([type="file"])').fill('Avatar test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Avatar test' })).toBeVisible({ timeout: 5_000 });

    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });

    // Upload a small PNG (1x1 red pixel)
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: pngBuffer });

    // Avatar upload button goes to loading state then resolves
    await expect(page.locator('.profile-avatar-btn', { hasText: /change photo|…/ })).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.profile-avatar-remove')).toBeVisible({ timeout: 10_000 });

    // Remove avatar
    await page.locator('.profile-avatar-remove').click();
    await expect(page.locator('.profile-avatar-remove')).not.toBeVisible({ timeout: 10_000 });
  });
});
