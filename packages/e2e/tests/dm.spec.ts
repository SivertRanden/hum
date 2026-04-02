import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace, joinViaInvite } from './helpers';

/**
 * Sets up two users in the same space:
 * - User A registers and creates the space
 * - User B registers and joins via invite link
 * Returns page/context handles and usernames for both.
 */
async function setupTwoUsersInSpace(browser: any) {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const usernameA = uniqueUser('dmA');
  await register(pageA, usernameA);
  const spaceName = `DMSpace_${Date.now()}`;
  await createSpace(pageA, spaceName);
  await pageA.locator('.channel-item', { hasText: 'general' }).click();

  const usernameB = uniqueUser('dmB');
  const { ctxGuest: ctxB, pageGuest: pageB } = await joinViaInvite(browser, pageA, usernameB);
  await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });

  // Give the server a moment to broadcast user B's presence to user A,
  // and for user A's client to re-fetch the member list.
  await pageA.waitForTimeout(1_000);

  return { ctxA, pageA, usernameA, ctxB, pageB, usernameB };
}

test.describe('Direct Messages', () => {
  test('opens a new DM conversation', async ({ browser }) => {
    const { ctxA, pageA, usernameB, ctxB } = await setupTwoUsersInSpace(browser);

    // Open the DM picker via the "+" button next to "Direct Messages"
    await pageA.locator('.channel-add-btn[title="Start new DM"]').click();

    // User B should appear in the picker
    await expect(pageA.locator('.channel-list .channel-item', { hasText: usernameB })).toBeVisible({ timeout: 5_000 });

    // Click on user B to open a DM
    await pageA.locator('.channel-list .channel-item', { hasText: usernameB }).click();

    // Header should show user B's name
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    // DM should appear in the sidebar DM list
    await expect(pageA.locator('.channel-list-item .channel-item', { hasText: usernameB })).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('sends and receives messages in a DM', async ({ browser }) => {
    const { ctxA, pageA, usernameA, ctxB, pageB, usernameB } = await setupTwoUsersInSpace(browser);

    // User A opens DM with user B
    await pageA.locator('.channel-add-btn[title="Start new DM"]').click();
    await pageA.locator('.channel-list .channel-item', { hasText: usernameB }).click();
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    // User A sends a message
    const msgFromA = 'Hello from A!';
    await pageA.locator('.compose input').fill(msgFromA);
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageA.locator('.msg-content', { hasText: msgFromA })).toBeVisible({ timeout: 5_000 });

    // User B opens DM with user A from their side (creates/finds the same DM channel)
    await pageB.locator('.channel-add-btn[title="Start new DM"]').click();
    await pageB.locator('.channel-list .channel-item', { hasText: usernameA }).click();
    await expect(pageB.locator('.main-header')).toContainText(usernameA, { timeout: 5_000 });

    // User B should see user A's message
    await expect(pageB.locator('.msg-content', { hasText: msgFromA })).toBeVisible({ timeout: 5_000 });

    // User B replies
    const msgFromB = 'Hello back from B!';
    await pageB.locator('.compose input').fill(msgFromB);
    await pageB.getByRole('button', { name: /^send$/i }).click();
    await expect(pageB.locator('.msg-content', { hasText: msgFromB })).toBeVisible({ timeout: 5_000 });

    // User A sees user B's reply in real-time
    await expect(pageA.locator('.msg-content', { hasText: msgFromB })).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('DM sidebar navigation — switch between DM and text channel', async ({ browser }) => {
    const { ctxA, pageA, usernameB, ctxB } = await setupTwoUsersInSpace(browser);

    // Open DM with user B
    await pageA.locator('.channel-add-btn[title="Start new DM"]').click();
    await pageA.locator('.channel-list .channel-item', { hasText: usernameB }).click();
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    // Navigate to the general text channel
    await pageA.locator('.channel-item', { hasText: 'general' }).click();
    await expect(pageA.locator('.main-header')).toContainText('general', { timeout: 5_000 });

    // Navigate back to the DM via the sidebar
    await pageA.locator('.channel-list-item .channel-item', { hasText: usernameB }).click();
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('DM conversation list shows opened DMs and persists after navigation', async ({ browser }) => {
    const { ctxA, pageA, usernameB, ctxB } = await setupTwoUsersInSpace(browser);

    // Before opening any DM, user B should not be in the DM list
    await expect(pageA.locator('.channel-list-item .channel-item', { hasText: usernameB })).not.toBeVisible();

    // Open a DM with user B
    await pageA.locator('.channel-add-btn[title="Start new DM"]').click();
    await pageA.locator('.channel-list .channel-item', { hasText: usernameB }).click();
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    // Navigate away to the general channel
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // DM should still appear in the sidebar DM conversation list
    await expect(pageA.locator('.channel-list-item .channel-item', { hasText: usernameB })).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
