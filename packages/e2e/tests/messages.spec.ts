import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

test.describe('Messages', () => {
  test('send a message in a text channel', async ({ page }) => {
    await register(page, uniqueUser('msg'));
    await createSpace(page, `MsgSpace_${Date.now()}`);

    // Click the general channel to activate it
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = 'Hello, Hum!';
    await page.locator('.compose input').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });
  });

  test('empty input does not send a message', async ({ page }) => {
    await register(page, uniqueUser('empty'));
    await createSpace(page, `EmptySpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const sendBtn = page.getByRole('button', { name: /^send$/i });
    await expect(sendBtn).toBeDisabled();
  });

  test('edit own message', async ({ page }) => {
    await register(page, uniqueUser('edit'));
    await createSpace(page, `EditSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const original = 'Original text';
    const updated = 'Updated text';
    await page.locator('.compose input').fill(original);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: original })).toBeVisible({ timeout: 5_000 });

    // Click edit button (✎)
    await page.locator('.msg-action-btn').first().click();

    await page.locator('.msg-edit-input').clear();
    await page.locator('.msg-edit-input').fill(updated);
    await page.locator('.msg-edit-save').click();

    await expect(page.locator('.msg-content', { hasText: updated })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.msg-edited')).toBeVisible();
    await expect(page.locator('.msg-content', { hasText: original })).not.toBeVisible();
  });

  test('cancel edit restores original content', async ({ page }) => {
    await register(page, uniqueUser('cedit'));
    await createSpace(page, `CEditSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const original = 'Cancel edit test';
    await page.locator('.compose input').fill(original);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: original })).toBeVisible({ timeout: 5_000 });

    await page.locator('.msg-action-btn').first().click();
    await page.locator('.msg-edit-input').fill('Should not be saved');
    await page.locator('.msg-edit-cancel').click();

    await expect(page.locator('.msg-content', { hasText: original })).toBeVisible();
    await expect(page.locator('.msg-content', { hasText: 'Should not be saved' })).not.toBeVisible();
  });

  test('delete own message', async ({ page }) => {
    await register(page, uniqueUser('del'));
    await createSpace(page, `DelMsgSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = 'Message to delete';
    await page.locator('.compose input').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // Click delete button (✕) — it's the second action button
    await page.locator('.msg-action-delete').click();

    await expect(page.locator('.msg-content', { hasText: msg })).not.toBeVisible({ timeout: 5_000 });
  });

  test('messages persist after channel navigation', async ({ page }) => {
    await register(page, uniqueUser('persist'));
    await createSpace(page, `PersistSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const msg = 'Persistent message';
    await page.locator('.compose input').fill(msg);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });

    // Create a second channel and navigate to it
    await page.locator('.channel-add-btn').first().click();
    await page.locator('input.channel-create-input').fill('other');
    await page.locator('button.channel-create-submit').click();
    await expect(page.locator('.channel-item', { hasText: 'other' })).toBeVisible();
    await page.locator('.channel-item', { hasText: 'other' }).click();

    // Navigate back to general
    await page.locator('.channel-item', { hasText: 'general' }).click();
    await expect(page.locator('.msg-content', { hasText: msg })).toBeVisible({ timeout: 5_000 });
  });
});
