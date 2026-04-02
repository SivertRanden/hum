import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';
import path from 'path';

/**
 * File & image sharing E2E tests.
 *
 * The compose bar has a hidden <input type="file"> triggered by the 📎 button
 * (title="Attach file"). After selecting a file, a `.pending-attachment`
 * preview appears above the compose bar. On send, attachments are rendered in
 * `.msg-attachments > .msg-attachment`. Images use `.msg-attachment-image`;
 * other files render as a `.msg-attachment-file` download link.
 */

test.describe('File & image sharing', () => {
  test('selecting a file shows a pending attachment preview', async ({ page }) => {
    await register(page, uniqueUser('fup'));
    await createSpace(page, `FileSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Set the file directly on the hidden input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    });

    // Pending attachment area should appear
    await expect(page.locator('.pending-attachment')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pending-attachment-name')).toContainText('hello.txt');
  });

  test('sending a message with a non-image file shows a download link', async ({ page }) => {
    await register(page, uniqueUser('ffile'));
    await createSpace(page, `FileMsgSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'document.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('file contents here'),
    });

    await expect(page.locator('.pending-attachment')).toBeVisible({ timeout: 5_000 });

    // Send without additional text
    await page.getByRole('button', { name: /^send$/i }).click();

    // The message should show a file attachment link
    const attachment = page.locator('.msg-attachment .msg-attachment-file');
    await expect(attachment).toBeVisible({ timeout: 8_000 });
    await expect(attachment).toContainText('document.txt');
    // It should be a download link
    await expect(attachment).toHaveAttribute('download', 'document.txt');
  });

  test('sending a message with an image shows an image thumbnail', async ({ page }) => {
    await register(page, uniqueUser('fimg'));
    await createSpace(page, `ImgMsgSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Minimal 1x1 PNG
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: png1x1,
    });

    await expect(page.locator('.pending-attachment')).toBeVisible({ timeout: 5_000 });
    // Image preview in pending area
    await expect(page.locator('.pending-attachment-preview')).toBeVisible();

    await page.getByRole('button', { name: /^send$/i }).click();

    // Message should contain an image attachment
    const img = page.locator('.msg-attachment .msg-attachment-image');
    await expect(img).toBeVisible({ timeout: 8_000 });
    await expect(img).toHaveAttribute('alt', 'photo.png');
  });

  test('pending attachment can be removed before sending', async ({ page }) => {
    await register(page, uniqueUser('frem'));
    await createSpace(page, `RemoveAttachSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'remove-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('to be removed'),
    });

    await expect(page.locator('.pending-attachment')).toBeVisible({ timeout: 5_000 });

    // Click the remove button
    await page.locator('.pending-attachment-remove').click();
    await expect(page.locator('.pending-attachment')).not.toBeVisible({ timeout: 3_000 });
  });

  test('file attachment is clickable as a download link', async ({ page }) => {
    await register(page, uniqueUser('fdl'));
    await createSpace(page, `DlSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 minimal'),
    });

    await expect(page.locator('.pending-attachment')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^send$/i }).click();

    const dlLink = page.locator('.msg-attachment .msg-attachment-file');
    await expect(dlLink).toBeVisible({ timeout: 8_000 });

    // The link should have the filename as the download attribute
    const download = dlLink.getAttribute('download');
    await expect(dlLink).toHaveAttribute('download', 'report.pdf');
  });
});
