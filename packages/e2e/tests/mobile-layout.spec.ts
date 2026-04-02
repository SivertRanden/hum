import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/** Mobile viewport: 390 × 844 (iPhone 14-class) */
const MOBILE = { width: 390, height: 844 };

/** Tablet viewport: 768 × 1024 — between 641 and 900 px breakpoints */
const TABLET = { width: 768, height: 1024 };

test.describe('Mobile-responsive layout', () => {
  test('app starts in servers view on mobile viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_start'));

    // On mobile the app-shell begins in "servers" panel
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile-view', 'servers');
  });

  test('selecting a server transitions to channels view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_srv'));
    await createSpace(page, `MobSrv_${Date.now()}`);

    // handleSelectServer sets mobileView to 'channels'
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile-view', 'channels', {
      timeout: 5_000,
    });
    // Channel sidebar is visible; back-to-servers button should be displayed
    await expect(page.locator('.mobile-back-btn[aria-label="Back to servers"]')).toBeVisible();
  });

  test('selecting a channel transitions to chat view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_ch'));
    await createSpace(page, `MobCh_${Date.now()}`);

    // Tap the default "general" channel
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile-view', 'chat', {
      timeout: 5_000,
    });
  });

  test('back button in main header returns to channels view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_back_ch'));
    await createSpace(page, `MobBackCh_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    const shell = page.locator('.app-shell');
    await expect(shell).toHaveAttribute('data-mobile-view', 'chat', { timeout: 5_000 });

    // The back-to-channels button lives in the main header
    await page.locator('.mobile-back-btn[aria-label="Back to channels"]').click();
    await expect(shell).toHaveAttribute('data-mobile-view', 'channels', { timeout: 5_000 });
  });

  test('back button in sidebar returns to servers view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_back_srv'));
    await createSpace(page, `MobBackSrv_${Date.now()}`);

    const shell = page.locator('.app-shell');
    await expect(shell).toHaveAttribute('data-mobile-view', 'channels', { timeout: 5_000 });

    // The back-to-servers button lives in the channel sidebar header
    await page.locator('.mobile-back-btn[aria-label="Back to servers"]').click();
    await expect(shell).toHaveAttribute('data-mobile-view', 'servers', { timeout: 5_000 });
  });

  test('message compose input is accessible in mobile chat view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_compose'));
    await createSpace(page, `MobCompose_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile-view', 'chat', {
      timeout: 5_000,
    });

    const input = page.locator('.compose input:not([type="file"])');
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Verify the user can type and send a message on a narrow screen
    await input.fill('hello mobile');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'hello mobile' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('channel list is reachable via mobile navigation from servers view', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await register(page, uniqueUser('mob_nav'));
    await createSpace(page, `MobNav_${Date.now()}`);

    const shell = page.locator('.app-shell');

    // Go back to servers from channels
    await page.locator('.mobile-back-btn[aria-label="Back to servers"]').click();
    await expect(shell).toHaveAttribute('data-mobile-view', 'servers', { timeout: 5_000 });

    // Tap the server icon to navigate back to channels
    await page.locator('.server-icon').first().click();
    await expect(shell).toHaveAttribute('data-mobile-view', 'channels', { timeout: 5_000 });

    // Channel list items should be reachable
    await expect(page.locator('.channel-item', { hasText: 'general' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('tablet viewport shows compact 3-column layout without mobile panels', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await register(page, uniqueUser('tablet'));
    await createSpace(page, `TabletSpace_${Date.now()}`);

    const shell = page.locator('.app-shell');

    // At tablet width, data-mobile-view has no effect on layout (grid, not panels)
    // Both the server rail and channel sidebar should be in viewport simultaneously
    await expect(page.locator('.server-rail')).toBeInViewport();
    await expect(page.locator('.channel-sidebar')).toBeInViewport();

    // Mobile back buttons should NOT be visible at tablet breakpoint
    await expect(page.locator('.mobile-back-btn').first()).not.toBeVisible();

    // The shell still carries the attribute (React state) but CSS ignores it at tablet widths
    const mobileView = await shell.getAttribute('data-mobile-view');
    // The attribute may be 'channels' after server selection — that's fine; the point is CSS
    // renders all three columns at this breakpoint, not sliding panels
    expect(['servers', 'channels', 'chat']).toContain(mobileView);
  });
});
