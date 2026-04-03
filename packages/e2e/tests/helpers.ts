import { Page, BrowserContext, expect } from '@playwright/test';

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

/**
 * Register a new user and join the space via the invite link copied from pageHost.
 * Waits for the invite navigation to complete before returning.
 *
 * This helper avoids the race-condition in inline invite flows where the guest
 * browser navigates to the invite URL while its previous page is still tearing
 * down, which emits EPIPE on the server and can crash the process.
 */
export async function joinViaInvite(
  browser: { newContext(): Promise<BrowserContext> },
  pageHost: Page,
  guestUsername: string,
): Promise<{ ctxGuest: BrowserContext; pageGuest: Page }> {
  await pageHost.locator('.channel-add-btn[title="Copy invite link"]').click();
  // Wait for the async HTTP request + clipboard write to complete before reading.
  await expect(pageHost.locator('.channel-add-btn[title="Copied!"]')).toBeVisible({ timeout: 10_000 });
  const inviteUrl = await pageHost.evaluate(() => navigator.clipboard.readText());

  const ctxGuest = await browser.newContext();
  const pageGuest = await ctxGuest.newPage();

  // Register first, then navigate to the invite URL.
  // Doing register → invite (two navigations) is safer than going directly to
  // the invite URL as an unauthenticated user, because the app always redirects
  // unauthenticated visitors to the login page anyway.
  await pageGuest.goto('/');
  await pageGuest.getByRole('button', { name: /no account\? register/i }).click();
  await pageGuest.getByPlaceholder('username').fill(guestUsername);
  await pageGuest.getByPlaceholder('password', { exact: true }).fill('testpass123');
  await pageGuest.getByRole('button', { name: /create account/i }).click();
  await expect(pageGuest.locator('.app-shell')).toBeVisible({ timeout: 10_000 });

  await pageGuest.goto(inviteUrl);
  await expect(pageGuest.locator('.app-shell')).toBeVisible({ timeout: 10_000 });

  return { ctxGuest, pageGuest };
}
