import { test, expect, chromium } from '@playwright/test';
import { uniqueUser, register, login, createSpace } from './helpers';

/**
 * Typing indicator tests require two browser contexts (two users) in the same
 * channel simultaneously. We launch a second context manually for this.
 */
test.describe('Typing indicators', () => {
  test('shows typing indicator when another user types', async ({ browser }) => {
    // User A
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('typA');
    await register(pageA, usernameA);
    const spaceName = `TypingSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // Get the invite link from page A so user B can join
    // Instead, we'll register user B and use the API directly.
    // Easier: user B joins by navigating to the app as well (both in same space).
    // We need user B to be a member of the same space.
    // The simplest approach: have user A create an invite and user B joins via it.
    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    // The invite link is copied to clipboard — read it via the page
    const inviteToken = await pageA.evaluate(async () => {
      return navigator.clipboard.readText();
    });

    // User B: register and join via invite URL
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('typB');
    // Register user B
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /no account\? register/i }).click();
    await pageB.getByPlaceholder('username').fill(usernameB);
    await pageB.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await pageB.getByRole('button', { name: /create account/i }).click();
    await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 10_000 });

    // Navigate to invite URL to join the space
    await pageB.goto(inviteToken);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User B starts typing — user A should see the indicator
    await pageB.locator('.compose input[type="text"]').focus();
    await pageB.locator('.compose input[type="text"]').type('Hello');

    await expect(pageA.locator('.typing-indicator')).toBeVisible({ timeout: 5_000 });
    await expect(pageA.locator('.typing-indicator')).toContainText(usernameB);

    // User B sends the message — typing indicator should disappear
    await pageB.getByRole('button', { name: /^send$/i }).click();
    await expect(pageA.locator('.typing-indicator')).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('typing indicator disappears after inactivity', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('inactA');
    await register(pageA, usernameA);
    const spaceName = `InactSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteToken = await pageA.evaluate(async () => navigator.clipboard.readText());

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('inactB');
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /no account\? register/i }).click();
    await pageB.getByPlaceholder('username').fill(usernameB);
    await pageB.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await pageB.getByRole('button', { name: /create account/i }).click();
    await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageB.goto(inviteToken);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User B types and stops
    await pageB.locator('.compose input[type="text"]').type('typing...');
    await expect(pageA.locator('.typing-indicator')).toBeVisible({ timeout: 5_000 });

    // Wait for 3s auto-stop timeout (server clears typing after 5s, client stops after 3s)
    await pageA.waitForTimeout(4_000);
    await expect(pageA.locator('.typing-indicator')).not.toBeVisible({ timeout: 3_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
