import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

test.describe('Message Reactions', () => {
  test('adds a reaction to a message', async ({ page }) => {
    await register(page, uniqueUser('rxn'));
    await createSpace(page, `RxnSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message to react to
    await page.locator('.compose input[type="text"]').fill('React to me!');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'React to me!' })).toBeVisible({ timeout: 5_000 });

    // Open the emoji picker
    await page.locator('.reaction-add-btn').first().click();
    await expect(page.locator('.reaction-picker')).toBeVisible({ timeout: 3_000 });

    // Click the first quick emoji (👍)
    await page.locator('.reaction-quick-btn').first().click();

    // The reaction pill should appear
    await expect(page.locator('.reaction-pill')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.reaction-pill.mine')).toBeVisible();
  });

  test('removes a reaction by clicking own reaction pill', async ({ page }) => {
    await register(page, uniqueUser('rmrxn'));
    await createSpace(page, `RmRxnSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose input[type="text"]').fill('Remove my reaction!');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Remove my reaction!' })).toBeVisible({ timeout: 5_000 });

    // Add a reaction
    await page.locator('.reaction-add-btn').first().click();
    await page.locator('.reaction-quick-btn').first().click();
    await expect(page.locator('.reaction-pill.mine')).toBeVisible({ timeout: 5_000 });

    // Click the reaction pill again to remove it
    await page.locator('.reaction-pill.mine').click();
    await expect(page.locator('.reaction-pill')).not.toBeVisible({ timeout: 5_000 });
  });

  test('reaction count display reflects multiple users reacting', async ({ browser }) => {
    // User A
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('rxnA');
    await register(pageA, usernameA);
    const spaceName = `RxnCountSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // Get invite link; wait for 'Copied!' to avoid stale-clipboard race
    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    await expect(pageA.locator('.channel-add-btn[title="Copied!"]')).toBeVisible({ timeout: 10_000 });
    const inviteUrl = await pageA.evaluate(async () => navigator.clipboard.readText());

    // User B joins
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('rxnB');
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /no account\? register/i }).click();
    await pageB.getByPlaceholder('username').fill(usernameB);
    await pageB.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await pageB.getByRole('button', { name: /create account/i }).click();
    await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageB.goto(inviteUrl);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 10_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User A sends a message
    await pageA.locator('.compose input[type="text"]').fill('Count my reactions!');
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageA.locator('.msg-content', { hasText: 'Count my reactions!' })).toBeVisible({ timeout: 5_000 });

    // User A adds a reaction
    await pageA.locator('.reaction-add-btn').first().click();
    await pageA.locator('.reaction-quick-btn').first().click();
    await expect(pageA.locator('.reaction-pill')).toBeVisible({ timeout: 5_000 });

    // User B sees the message with count 1, then adds the same reaction
    await expect(pageB.locator('.msg-content', { hasText: 'Count my reactions!' })).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.reaction-pill')).toBeVisible({ timeout: 5_000 });
    await pageB.locator('.reaction-pill').first().click();

    // Both users should now see count 2
    await expect(pageA.locator('.reaction-pill', { hasText: '2' })).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.reaction-pill.mine')).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('reaction picker shows all quick emojis', async ({ page }) => {
    await register(page, uniqueUser('rxnpicker'));
    await createSpace(page, `RxnPickerSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose input[type="text"]').fill('Emoji picker test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Emoji picker test' })).toBeVisible({ timeout: 5_000 });

    await page.locator('.reaction-add-btn').first().click();
    await expect(page.locator('.reaction-picker')).toBeVisible({ timeout: 3_000 });

    // Should have exactly 6 quick emoji buttons
    const quickBtns = page.locator('.reaction-quick-btn');
    await expect(quickBtns).toHaveCount(6);

    // Close picker by clicking again
    await page.locator('.reaction-add-btn').first().click();
    await expect(page.locator('.reaction-picker')).not.toBeVisible();
  });
});
