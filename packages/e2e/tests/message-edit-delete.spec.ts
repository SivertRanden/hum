import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/** Join a space via an invite URL copied from the clipboard. */
async function joinViaInvite(page: import('@playwright/test').Page, inviteUrl: string, username: string) {
  await page.goto(inviteUrl);
  if (await page.locator('.auth-screen').isVisible()) {
    await page.getByRole('button', { name: /no account\? register/i }).click();
    await page.getByPlaceholder('username').fill(username);
    await page.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
  }
}

test.describe('Message editing & deletion — author-only controls', () => {
  test('only message author sees edit and delete buttons', async ({ browser }) => {
    // User A: sends a message
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('editOwner');
    await register(pageA, usernameA);
    const spaceName = `EditOwnerSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // Copy invite link
    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageA.evaluate(async () => navigator.clipboard.readText());

    // User B: joins the space
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('editViewer');
    await joinViaInvite(pageB, inviteUrl, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User A sends a message
    const msg = 'Message from A';
    await pageA.locator('.compose input:not([type="file"])').fill(msg);
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageA.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // User A can see edit/delete controls on their own message
    await expect(pageA.locator('[title="Edit"]').first()).toBeVisible();
    await expect(pageA.locator('.msg-action-delete').first()).toBeVisible();

    // User B sees the message but NOT the edit/delete controls
    await expect(pageB.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('[title="Edit"]')).not.toBeVisible();
    await expect(pageB.locator('.msg-action-delete')).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('edited message is visible in real-time to other users', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('rtEditA');
    await register(pageA, usernameA);
    const spaceName = `RTEditSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageA.evaluate(async () => navigator.clipboard.readText());

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('rtEditB');
    await joinViaInvite(pageB, inviteUrl, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // A sends original message
    const original = 'Before edit';
    await pageA.locator('.compose input:not([type="file"])').fill(original);
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageB.locator('.msg-content', { hasText: original })).toBeVisible({ timeout: 5_000 });

    // A edits the message
    const updated = 'After edit';
    await pageA.locator('[title="Edit"]').first().click();
    await pageA.locator('.msg-edit-input').clear();
    await pageA.locator('.msg-edit-input').fill(updated);
    await pageA.locator('.msg-edit-save').click();

    // B sees updated content and (edited) indicator
    await expect(pageB.locator('.msg-content', { hasText: updated })).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.msg-edited')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.msg-content', { hasText: original })).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('deleted message disappears in real-time for other users', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('rtDelA');
    await register(pageA, usernameA);
    const spaceName = `RTDelSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageA.evaluate(async () => navigator.clipboard.readText());

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('rtDelB');
    await joinViaInvite(pageB, inviteUrl, usernameB);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // A sends message
    const msg = 'Message to be deleted';
    await pageA.locator('.compose input:not([type="file"])').fill(msg);
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageB.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // A deletes the message
    await pageA.locator('.msg-action-delete').click();
    await expect(pageA.locator('.msg-content', { hasText: msg })).not.toBeVisible({ timeout: 5_000 });

    // B no longer sees the message
    await expect(pageB.locator('.msg-content', { hasText: msg })).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
