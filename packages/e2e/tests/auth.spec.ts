import { test, expect } from '@playwright/test';
import { uniqueUser, register, login } from './helpers';

test.describe('Authentication', () => {
  test('register a new account', async ({ page }) => {
    const username = uniqueUser('reg');
    await register(page, username);
    // App shell is visible (checked in helper); auth screen is gone
    await expect(page.locator('.auth-screen')).not.toBeVisible();
    // Username appears in the user panel footer
    await expect(page.locator('.user-name')).toContainText(username);
  });

  test('sign out returns to auth screen', async ({ page }) => {
    const username = uniqueUser('signout');
    await register(page, username);
    await page.locator('.user-signout-btn').click();
    await expect(page.locator('.auth-screen')).toBeVisible();
    await expect(page.locator('h1.logo')).toHaveText('hum');
  });

  test('login with existing account', async ({ page }) => {
    const username = uniqueUser('logme');
    // Register first
    await register(page, username);
    // Sign out
    await page.locator('.user-signout-btn').click();
    // Now login
    await login(page, username);
    await expect(page.locator('.user-name')).toContainText(username);
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('username').fill('nobody_xyz_9999');
    await page.getByPlaceholder('password').fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.error')).toBeVisible({ timeout: 5_000 });
  });

  test('persists session via localStorage on reload', async ({ page }) => {
    const username = uniqueUser('persist');
    await register(page, username);
    // Reload — auth should be restored from localStorage
    await page.reload();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.user-name')).toContainText(username);
  });
});
