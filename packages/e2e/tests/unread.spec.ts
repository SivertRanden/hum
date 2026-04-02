import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/**
 * Unread indicator tests.
 *
 * The UI renders an `.unread-dot` next to any channel with unread messages.
 * The dot's `title` attribute contains the count (e.g. "3 unread").
 * Counts are persisted server-side and restored after a page reload.
 *
 * Multi-user tests follow the two-context pattern from typing.spec.ts.
 */

async function joinViaInvite(
  pageHost: import('@playwright/test').Page,
  pageGuest: import('@playwright/test').Page,
  guestUsername: string,
) {
  // Host copies the invite link
  await pageHost.locator('.channel-add-btn[title="Copy invite link"]').click();
  const inviteUrl = await pageHost.evaluate(() => navigator.clipboard.readText());

  // Guest registers and joins
  await pageGuest.goto('/');
  await pageGuest.getByRole('button', { name: /no account\? register/i }).click();
  await pageGuest.getByPlaceholder('username').fill(guestUsername);
  await pageGuest.getByPlaceholder('password', { exact: true }).fill('testpass123');
  await pageGuest.getByRole('button', { name: /create account/i }).click();
  await expect(pageGuest.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
  await pageGuest.goto(inviteUrl);
  // Wait for the invite to be processed and the app to settle
  await expect(pageGuest.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
}

test.describe('Unread indicators', () => {
  test('unread dot appears when a message arrives in another channel', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('unrdA');
    await register(pageA, usernameA);

    const spaceName = `UnreadSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);

    // Create a second text channel so user A can sit there while user B posts in general
    await pageA.locator('.channel-add-btn[title="Add text channel"]').first().click();
    await pageA.locator('input.channel-create-input').fill('other');
    await pageA.locator('button.channel-create-submit').click();
    await expect(pageA.locator('.channel-item', { hasText: 'other' })).toBeVisible({ timeout: 5_000 });

    // User B joins via invite
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('unrdB');
    await joinViaInvite(pageA, pageB, usernameB);
    const spaceNameLocator = pageB.locator('.channel-server-name', { hasText: spaceName });
    await expect(spaceNameLocator).toBeVisible({ timeout: 10_000 });

    // User A moves to the "other" channel; user B stays in general
    await pageA.locator('.channel-item', { hasText: 'other' }).click();
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // No unread dot on general for user A yet
    const generalItem = pageA.locator('.channel-item', { hasText: 'general' });
    await expect(generalItem.locator('.unread-dot')).not.toBeVisible();

    // User B sends a message in general
    await pageB.locator('.compose input:not([type="file"])').fill('Hey there!');
    await pageB.getByRole('button', { name: /^send$/i }).click();

    // User A should now see the unread dot on the general channel item
    await expect(generalItem.locator('.unread-dot')).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('unread dot count increments with each message', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('cntA');
    await register(pageA, usernameA);

    const spaceName = `CountSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);

    await pageA.locator('.channel-add-btn[title="Add text channel"]').first().click();
    await pageA.locator('input.channel-create-input').fill('other');
    await pageA.locator('button.channel-create-submit').click();
    await expect(pageA.locator('.channel-item', { hasText: 'other' })).toBeVisible({ timeout: 5_000 });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('cntB');
    await joinViaInvite(pageA, pageB, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });

    await pageA.locator('.channel-item', { hasText: 'other' }).click();
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    const generalItem = pageA.locator('.channel-item', { hasText: 'general' });

    // Send three messages from B
    for (const msg of ['msg 1', 'msg 2', 'msg 3']) {
      await pageB.locator('.compose input:not([type="file"])').fill(msg);
      await pageB.getByRole('button', { name: /^send$/i }).click();
    }

    // Dot should show "3 unread" in the title
    const dot = generalItem.locator('.unread-dot');
    await expect(dot).toBeVisible({ timeout: 5_000 });
    await expect(dot).toHaveAttribute('title', '3 unread');

    await ctxA.close();
    await ctxB.close();
  });

  test('reading a channel clears the unread dot', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('clrA');
    await register(pageA, usernameA);

    const spaceName = `ClearSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);

    await pageA.locator('.channel-add-btn[title="Add text channel"]').first().click();
    await pageA.locator('input.channel-create-input').fill('other');
    await pageA.locator('button.channel-create-submit').click();
    await expect(pageA.locator('.channel-item', { hasText: 'other' })).toBeVisible({ timeout: 5_000 });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('clrB');
    await joinViaInvite(pageA, pageB, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });

    await pageA.locator('.channel-item', { hasText: 'other' }).click();
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    await pageB.locator('.compose input:not([type="file"])').fill('Hello!');
    await pageB.getByRole('button', { name: /^send$/i }).click();

    const generalItem = pageA.locator('.channel-item', { hasText: 'general' });
    await expect(generalItem.locator('.unread-dot')).toBeVisible({ timeout: 5_000 });

    // User A clicks general — dot should disappear
    await pageA.locator('.channel-item', { hasText: 'general' }).click();
    await expect(generalItem.locator('.unread-dot')).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('unread state persists across page reload', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('relA');
    await register(pageA, usernameA);

    const spaceName = `ReloadSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);

    await pageA.locator('.channel-add-btn[title="Add text channel"]').first().click();
    await pageA.locator('input.channel-create-input').fill('other');
    await pageA.locator('button.channel-create-submit').click();
    await expect(pageA.locator('.channel-item', { hasText: 'other' })).toBeVisible({ timeout: 5_000 });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('relB');
    await joinViaInvite(pageA, pageB, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });

    // User A stays in general; user B sends a message in "other" so the
    // unread dot appears on a non-default channel. After reload the app
    // defaults to "general", so the unread on "other" should survive.
    await pageA.locator('.channel-item', { hasText: 'general' }).click();
    await pageB.locator('.channel-item', { hasText: 'other' }).click();

    await pageB.locator('.compose input:not([type="file"])').fill('Persist me!');
    await pageB.getByRole('button', { name: /^send$/i }).click();

    const otherItem = pageA.locator('.channel-item', { hasText: 'other' });
    await expect(otherItem.locator('.unread-dot')).toBeVisible({ timeout: 5_000 });

    // Reload user A's page
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    // Wait for the space to re-render after reload
    await expect(pageA.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });

    // Dot should still be present on "other" after reload (app defaults to general)
    await expect(pageA.locator('.channel-item', { hasText: 'other' }).locator('.unread-dot')).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
