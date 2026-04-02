import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/**
 * @mention E2E tests.
 *
 * The app renders `@username` tokens as `<span class="mention">@username</span>`.
 * When the viewing user is the mentioned user, an extra `mention-me` class is
 * added and the token is highlighted in amber.
 *
 * Multi-user tests follow the two-context pattern from typing.spec.ts.
 */

test.describe('@mentions', () => {
  test('typing @username renders a mention span in the message', async ({ page }) => {
    const username = uniqueUser('mntn');
    await register(page, username);
    await createSpace(page, `MentionSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = `Hello @${username} how are you`;
    await page.locator('.compose input:not([type="file"])').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();

    // The @mention token should be wrapped in a .mention span
    const mention = page.locator('.msg-content .mention', { hasText: `@${username}` });
    await expect(mention).toBeVisible({ timeout: 5_000 });
  });

  test('self-mention gets the mention-me highlight class', async ({ page }) => {
    const username = uniqueUser('selfm');
    await register(page, username);
    await createSpace(page, `SelfMentionSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message that mentions yourself
    const msg = `@${username} reminder to self`;
    await page.locator('.compose input:not([type="file"])').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();

    // The span should have both .mention and .mention-me
    const mention = page.locator('.msg-content .mention.mention-me', { hasText: `@${username}` });
    await expect(mention).toBeVisible({ timeout: 5_000 });
  });

  test('mentioned user sees mention-me highlight when viewing the message', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('sndA');
    await register(pageA, usernameA);

    const spaceName = `MentionTwo_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    // Intercept clipboard write to capture invite URL
    await pageA.evaluate(() => {
      (window as any).__clipboardText = '';
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        (window as any).__clipboardText = text;
        try { await orig(text); } catch { /* ok */ }
      };
    });
    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    // Button title changes to "Copied!" after the async invite creation + clipboard write
    await expect(pageA.locator('.channel-add-btn[title="Copied!"]')).toBeVisible({ timeout: 5_000 });
    const inviteUrl = await pageA.evaluate(() => (window as any).__clipboardText as string);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('rcvB');
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /no account\? register/i }).click();
    await pageB.getByPlaceholder('username').fill(usernameB);
    await pageB.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await pageB.getByRole('button', { name: /create account/i }).click();
    await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageB.goto(inviteUrl);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 8_000 });
    await pageB.locator('.channel-item', { hasText: 'general' }).click();

    // User A sends a message mentioning User B
    const msg = `Hey @${usernameB} check this out`;
    await pageA.locator('.compose input:not([type="file"])').fill(msg);
    await pageA.getByRole('button', { name: /^send$/i }).click();

    // User B should see the mention highlighted with mention-me
    const mentionOnB = pageB.locator('.msg-content .mention.mention-me', { hasText: `@${usernameB}` });
    await expect(mentionOnB).toBeVisible({ timeout: 5_000 });

    // User A should see it as a plain mention (not mention-me)
    const mentionOnA = pageA.locator('.msg-content .mention', { hasText: `@${usernameB}` });
    await expect(mentionOnA).toBeVisible({ timeout: 5_000 });
    await expect(pageA.locator('.msg-content .mention.mention-me')).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('mention renders correctly amid surrounding text', async ({ page }) => {
    const username = uniqueUser('surr');
    await register(page, username);
    await createSpace(page, `SurrSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = `ping @${username} please respond`;
    await page.locator('.compose input:not([type="file"])').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();

    // The full message should appear and contain the mention span
    await expect(page.locator('.msg-content', { hasText: 'ping' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.msg-content', { hasText: 'please respond' })).toBeVisible();
    await expect(page.locator('.msg-content .mention')).toBeVisible();
  });
});
