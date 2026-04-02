import { Page, expect } from '@playwright/test';

/** Generate a unique username to avoid collisions across tests. */
export function uniqueUser(prefix = 'user') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

/** Register a new account and wait for the app shell to appear. */
export async function register(page: Page, username: string, password = 'testpass123') {
  await page.goto('/');
  await page.getByRole('button', { name: /no account\? register/i }).click();
  await page.getByPlaceholder('username').fill(username);
  await page.getByPlaceholder('password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
}

/** Login with an existing account and wait for the app shell to appear. */
export async function login(page: Page, username: string, password = 'testpass123') {
  await page.goto('/');
  await page.getByPlaceholder('username').fill(username);
  await page.getByPlaceholder('password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
}

/** Create a space and wait for it to be selected. */
export async function createSpace(page: Page, name: string) {
  await page.locator('.server-add-btn').click();
  await page.locator('input[placeholder="server name"]').fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  // Wait for the space to appear in the rail and be selected
  await expect(page.locator('.channel-server-name', { hasText: name })).toBeVisible({ timeout: 5_000 });
}
