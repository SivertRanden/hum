import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

test.describe('Full-text search', () => {
  test('opens search panel via header button', async ({ page }) => {
    await register(page, uniqueUser('srch'));
    await createSpace(page, `SrchSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.search-input')).toBeFocused();
  });

  test('finds a message by its content', async ({ page }) => {
    const user = uniqueUser('srchfind');
    await register(page, user);
    await createSpace(page, `SrchFindSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a uniquely identifiable message
    const uniquePhrase = `findme_${Date.now()}`;
    await page.locator('.compose input').fill(uniquePhrase);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: uniquePhrase })).toBeVisible({ timeout: 5_000 });

    // Open search and type the phrase
    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await page.locator('.search-input').fill(uniquePhrase);

    // Result should appear
    await expect(page.locator('.search-result-item')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.search-result-content')).toContainText(uniquePhrase);

    // The term should be highlighted
    await expect(page.locator('.search-highlight')).toBeVisible();
  });

  test('shows empty state when no results match', async ({ page }) => {
    await register(page, uniqueUser('srchempty'));
    await createSpace(page, `SrchEmptySpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await page.locator('.search-input').fill('thisphrasecannotexistinanytest_xyz987');

    await expect(page.locator('.search-status')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.search-status')).toContainText('No results');
    await expect(page.locator('.search-result-item')).not.toBeVisible();
  });

  test('navigates to correct channel when clicking a search result', async ({ page }) => {
    await register(page, uniqueUser('srchnav'));
    await createSpace(page, `SrchNavSpace_${Date.now()}`);

    // Create a second channel and post a message in it
    await page.locator('.channel-add-btn').first().click();
    await page.locator('input.channel-create-input').fill('secondary');
    await page.locator('button.channel-create-submit').click();
    await expect(page.locator('.channel-item', { hasText: 'secondary' })).toBeVisible();
    await page.locator('.channel-item', { hasText: 'secondary' }).click();

    const uniquePhrase = `navmsg_${Date.now()}`;
    await page.locator('.compose input').fill(uniquePhrase);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: uniquePhrase })).toBeVisible({ timeout: 5_000 });

    // Navigate to general, then search for the message in secondary
    await page.locator('.channel-item', { hasText: 'general' }).click();
    await expect(page.locator('.main-header')).toContainText('general');

    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await page.locator('.search-input').fill(uniquePhrase);
    await expect(page.locator('.search-result-item')).toBeVisible({ timeout: 5_000 });

    // Click the result — should navigate to the secondary channel
    await page.locator('.search-result-item').first().click();
    await expect(page.locator('.main-header')).toContainText('secondary', { timeout: 5_000 });
    await expect(page.locator('.search-panel')).not.toBeVisible();
  });

  test('searches across multiple channels', async ({ page }) => {
    await register(page, uniqueUser('srchmulti'));
    await createSpace(page, `SrchMultiSpace_${Date.now()}`);

    // Post in general
    await page.locator('.channel-item', { hasText: 'general' }).click();
    const keyword = `multiterm_${Date.now()}`;
    await page.locator('.compose input').fill(`${keyword} in general`);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: `${keyword} in general` })).toBeVisible({ timeout: 5_000 });

    // Create a second channel and post there too
    await page.locator('.channel-add-btn').first().click();
    await page.locator('input.channel-create-input').fill('other');
    await page.locator('button.channel-create-submit').click();
    await expect(page.locator('.channel-item', { hasText: 'other' })).toBeVisible();
    await page.locator('.channel-item', { hasText: 'other' }).click();
    await page.locator('.compose input').fill(`${keyword} in other`);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: `${keyword} in other` })).toBeVisible({ timeout: 5_000 });

    // Search should return results from both channels
    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await page.locator('.search-input').fill(keyword);
    await expect(page.locator('.search-result-item')).toHaveCount(2, { timeout: 5_000 });

    // Results should show channel names
    await expect(page.locator('.search-result-channel', { hasText: 'general' })).toBeVisible();
    await expect(page.locator('.search-result-channel', { hasText: 'other' })).toBeVisible();
  });

  test('closes search panel via close button', async ({ page }) => {
    await register(page, uniqueUser('srchclose'));
    await createSpace(page, `SrchCloseSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3_000 });

    await page.locator('.search-close-btn').click();
    await expect(page.locator('.search-panel')).not.toBeVisible();
  });

  test('closes search panel via Escape key', async ({ page }) => {
    await register(page, uniqueUser('srchesc'));
    await createSpace(page, `SrchEscSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.header-search-btn[title="Search (⌘K)"]').click();
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3_000 });

    await page.locator('.search-input').press('Escape');
    await expect(page.locator('.search-panel')).not.toBeVisible();
  });
});
