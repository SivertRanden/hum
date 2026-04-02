import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/**
 * Thread replies E2E tests.
 *
 * Each message has a `↩` (.msg-action-reply) action button that opens the
 * thread panel. If a message already has replies, a `.msg-reply-count` badge
 * also appears. The thread panel renders at `.thread-panel` with a
 * `.thread-compose-input` text field, `.thread-compose-send` button, and a
 * `.thread-panel-close` button.
 */

test.describe('Thread replies', () => {
  test('opening a thread from a message shows the thread panel', async ({ page }) => {
    await register(page, uniqueUser('thr'));
    await createSpace(page, `ThreadSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message first
    const msg = 'Open my thread!';
    await page.locator('.compose').getByRole('textbox').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // Click the reply button (↩) on the message
    await page.locator('.msg-action-btn.msg-action-reply').first().click();

    // Thread panel should appear
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });
    // Parent message should be shown in the panel
    await expect(page.locator('.thread-parent .msg-content', { hasText: msg })).toBeVisible();
  });

  test('posting a reply appears in the thread panel', async ({ page }) => {
    await register(page, uniqueUser('rep'));
    await createSpace(page, `ReplySpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a parent message
    await page.locator('.compose').getByRole('textbox').fill('Parent message');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Parent message' })).toBeVisible({ timeout: 5_000 });

    // Open the thread
    await page.locator('.msg-action-btn.msg-action-reply').first().click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });

    // Post a reply
    const reply = 'This is a reply!';
    await page.locator('.thread-compose-input').fill(reply);
    await page.locator('.thread-compose-send').click();

    // Reply should appear in the thread replies list
    await expect(page.locator('.thread-replies .msg-content', { hasText: reply })).toBeVisible({ timeout: 5_000 });
  });

  test('reply count badge appears on the parent message after a reply', async ({ page }) => {
    await register(page, uniqueUser('rcnt'));
    await createSpace(page, `ReplyCntSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose').getByRole('textbox').fill('Count test message');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Count test message' })).toBeVisible({ timeout: 5_000 });

    // Open thread and post one reply
    await page.locator('.msg-action-btn.msg-action-reply').first().click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });
    await page.locator('.thread-compose-input').fill('First reply');
    await page.locator('.thread-compose-send').click();
    await expect(page.locator('.thread-replies .msg-content', { hasText: 'First reply' })).toBeVisible({ timeout: 5_000 });

    // Close thread panel and verify the reply count badge on the parent message
    await page.locator('.thread-panel-close').click();
    await expect(page.locator('.thread-panel')).not.toBeVisible({ timeout: 3_000 });

    const replyCountBadge = page.locator('.msg-reply-count');
    await expect(replyCountBadge).toBeVisible({ timeout: 5_000 });
    await expect(replyCountBadge).toContainText('1 reply');
  });

  test('thread panel closes when the close button is clicked', async ({ page }) => {
    await register(page, uniqueUser('cls'));
    await createSpace(page, `CloseThreadSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose').getByRole('textbox').fill('Close test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Close test' })).toBeVisible({ timeout: 5_000 });

    await page.locator('.msg-action-btn.msg-action-reply').first().click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });

    // Close the panel
    await page.locator('.thread-panel-close').click();
    await expect(page.locator('.thread-panel')).not.toBeVisible({ timeout: 5_000 });
  });

  test('clicking reply count badge on message re-opens the thread panel', async ({ page }) => {
    await register(page, uniqueUser('reop'));
    await createSpace(page, `ReopenSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose').getByRole('textbox').fill('Reopen thread test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Reopen thread test' })).toBeVisible({ timeout: 5_000 });

    // Open, reply, close
    await page.locator('.msg-action-btn.msg-action-reply').first().click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });
    await page.locator('.thread-compose-input').fill('A reply to keep');
    await page.locator('.thread-compose-send').click();
    await expect(page.locator('.thread-replies .msg-content', { hasText: 'A reply to keep' })).toBeVisible({ timeout: 5_000 });
    await page.locator('.thread-panel-close').click();
    await expect(page.locator('.thread-panel')).not.toBeVisible();

    // Click the reply count badge to re-open
    await page.locator('.msg-reply-count').click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.thread-replies .msg-content', { hasText: 'A reply to keep' })).toBeVisible();
  });
});
