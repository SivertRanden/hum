import { test, expect, chromium } from '@playwright/test';
import { uniqueUser, register, login, createSpace, joinViaInvite } from './helpers';

/**
 * Typing indicator tests require two browser contexts (two users) in the same
 * channel simultaneously. We launch a second context manually for this.
 */
test.describe('Typing indicators', () => {
  test('shows typing indicator when another user types', async ({ browser }) => {
    // User A
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('typA');
    await register(pageA, usernameA);
    const spaceName = `TypingSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // User B: register and join via invite URL
    const usernameB = uniqueUser('typB');
    const { ctxGuest: ctxB, pageGuest: pageB } = await joinViaInvite(browser, pageA, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User B starts typing — user A should see the indicator
    await pageB.locator('.compose input:not([type="file"])').focus();
    await pageB.locator('.compose input:not([type="file"])').type('Hello');

    await expect(pageA.locator('.typing-indicator')).toBeVisible({ timeout: 5_000 });
    await expect(pageA.locator('.typing-indicator')).toContainText(usernameB);

    // User B sends the message — typing indicator should disappear
    await pageB.getByRole('button', { name: /^send$/i }).click();
    await expect(pageA.locator('.typing-indicator')).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('typing indicator disappears after inactivity', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('inactA');
    await register(pageA, usernameA);
    const spaceName = `InactSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    const usernameB = uniqueUser('inactB');
    const { ctxGuest: ctxB, pageGuest: pageB } = await joinViaInvite(browser, pageA, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User B types and stops
    await pageB.locator('.compose input:not([type="file"])').type('typing...');
    await expect(pageA.locator('.typing-indicator')).toBeVisible({ timeout: 5_000 });

    // Wait for 3s auto-stop timeout (server clears typing after 5s, client stops after 3s)
    await pageA.waitForTimeout(4_000);
    await expect(pageA.locator('.typing-indicator')).not.toBeVisible({ timeout: 3_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
