import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

// ── Channel Topics ────────────────────────────────────────────────────────────

test.describe('Channel topics', () => {
  test('clicking the topic area enables inline editing', async ({ page }) => {
    await register(page, uniqueUser('topic'));
    await createSpace(page, `TopicSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Topic area shows "Set a topic…" placeholder
    await expect(page.locator('.main-header-topic')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.main-header-topic')).toContainText('Set a topic');

    // Click to enter edit mode
    await page.locator('.main-header-topic').click();
    await expect(page.locator('.main-header-topic-input')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.main-header-topic-input')).toBeFocused();
  });

  test('setting a topic displays it in the channel header', async ({ page }) => {
    await register(page, uniqueUser('topicset'));
    await createSpace(page, `TopicSetSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.main-header-topic').click();
    await expect(page.locator('.main-header-topic-input')).toBeVisible({ timeout: 3_000 });

    const topicText = 'Welcome to general!';
    await page.locator('.main-header-topic-input').fill(topicText);
    await page.locator('.main-header-topic-input').press('Enter');

    // Topic should appear in the header
    await expect(page.locator('.main-header-topic')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.main-header-topic')).toContainText(topicText);
  });

  test('topic persists after navigating away and back', async ({ page }) => {
    await register(page, uniqueUser('topicpersist'));
    await createSpace(page, `TopicPersistSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.main-header-topic').click();
    const topicText = 'Persistent topic';
    await page.locator('.main-header-topic-input').fill(topicText);
    await page.locator('.main-header-topic-input').press('Enter');
    await expect(page.locator('.main-header-topic')).toContainText(topicText, { timeout: 5_000 });

    // Create a second channel and navigate to it
    await page.locator('.channel-add-btn').first().click();
    await page.locator('input.channel-create-input').fill('other');
    await page.locator('button.channel-create-submit').click();
    await page.locator('.channel-item', { hasText: 'other' }).click();

    // Navigate back to general — topic should still be there
    await page.locator('.channel-item', { hasText: 'general' }).click();
    await expect(page.locator('.main-header-topic')).toContainText(topicText, { timeout: 5_000 });
  });

  test('clearing a topic resets the header to the placeholder', async ({ page }) => {
    await register(page, uniqueUser('topicclear'));
    await createSpace(page, `TopicClearSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Set a topic first
    await page.locator('.main-header-topic').click();
    await page.locator('.main-header-topic-input').fill('Temporary topic');
    await page.locator('.main-header-topic-input').press('Enter');
    await expect(page.locator('.main-header-topic')).toContainText('Temporary topic', { timeout: 5_000 });

    // Clear it
    await page.locator('.main-header-topic').click();
    await page.locator('.main-header-topic-input').clear();
    await page.locator('.main-header-topic-input').press('Enter');

    // Should revert to placeholder
    await expect(page.locator('.main-header-topic')).toContainText('Set a topic', { timeout: 5_000 });
  });

  test('pressing Escape cancels topic editing without saving', async ({ page }) => {
    await register(page, uniqueUser('topicesc'));
    await createSpace(page, `TopicEscSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.main-header-topic').click();
    await page.locator('.main-header-topic-input').fill('Should not be saved');
    await page.locator('.main-header-topic-input').press('Escape');

    // Input should disappear and the original topic (placeholder) should remain
    await expect(page.locator('.main-header-topic-input')).not.toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.main-header-topic')).not.toContainText('Should not be saved');
  });

  test('topic does not appear for DM conversations', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('topicDmA');
    await register(pageA, usernameA);
    const spaceName = `TopicDMSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteToken = await pageA.evaluate(async () => navigator.clipboard.readText());

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('topicDmB');
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /no account\? register/i }).click();
    await pageB.getByPlaceholder('username').fill(usernameB);
    await pageB.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await pageB.getByRole('button', { name: /create account/i }).click();
    await expect(pageB.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageB.goto(inviteToken);
    await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // User A opens a DM with User B
    await pageA.locator('.channel-add-btn[title="Start new DM"]').click();
    await pageA.locator('.channel-list .channel-item', { hasText: usernameB }).click();
    await expect(pageA.locator('.main-header')).toContainText(usernameB, { timeout: 5_000 });

    // Topic element should not be present in a DM
    await expect(pageA.locator('.main-header-topic')).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});

// ── User Profiles ─────────────────────────────────────────────────────────────

test.describe('User profiles', () => {
  test('profile card opens when clicking a username in the message list', async ({ page }) => {
    await register(page, uniqueUser('profview'));
    await createSpace(page, `ProfViewSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message so there is a username to click
    await page.locator('.compose input[type="text"]').fill('Profile click test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Profile click test' })).toBeVisible({ timeout: 5_000 });

    // Click the username in the message to open the profile card
    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });
  });

  test('own profile card shows the edit display name button', async ({ page }) => {
    await register(page, uniqueUser('profown'));
    await createSpace(page, `ProfOwnSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send a message so there's an own message with a clickable username
    await page.locator('.compose input[type="text"]').fill('Own profile test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Own profile test' })).toBeVisible({ timeout: 5_000 });

    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });

    // Own profile should show the edit button
    await expect(page.locator('.profile-card-edit-btn')).toBeVisible();
    await expect(page.locator('.profile-card-username')).toBeVisible();
  });

  test('editing display name updates it in the profile card', async ({ page }) => {
    const username = uniqueUser('profedit');
    await register(page, username);
    await createSpace(page, `ProfEditSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose input[type="text"]').fill('Display name edit test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Display name edit test' })).toBeVisible({ timeout: 5_000 });

    // Open own profile card
    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });

    // Click edit display name
    await page.locator('.profile-card-edit-btn').click();
    await expect(page.locator('.profile-card-input')).toBeVisible({ timeout: 3_000 });

    const newDisplayName = 'Cool Display Name';
    await page.locator('.profile-card-input').fill(newDisplayName);
    await page.locator('.profile-card-save').click();

    // Display name should be updated in the profile card
    await expect(page.locator('.profile-card-display-name')).toContainText(newDisplayName, { timeout: 5_000 });
  });

  test('closing the profile card returns to normal view', async ({ page }) => {
    await register(page, uniqueUser('profclose'));
    await createSpace(page, `ProfCloseSpace_${Date.now()}`);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('.compose input[type="text"]').fill('Close profile test');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Close profile test' })).toBeVisible({ timeout: 5_000 });

    await page.locator('.msg-username').first().click();
    await expect(page.locator('.profile-card')).toBeVisible({ timeout: 5_000 });

    await page.locator('.profile-card-close').click();
    await expect(page.locator('.profile-card')).not.toBeVisible({ timeout: 3_000 });
  });

  test("another user's profile card does not show the edit button", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const usernameA = uniqueUser('profOtherA');
    await register(pageA, usernameA);
    const spaceName = `ProfOtherSpace_${Date.now()}`;
    await createSpace(pageA, spaceName);
    await pageA.locator('.channel-item', { hasText: 'general' }).click();

    await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
    // Wait for clipboard write to complete before reading
    await expect(pageA.locator('.channel-add-btn[title="Copied!"]')).toBeVisible({ timeout: 10_000 });
    const inviteUrl = await pageA.evaluate(async () => navigator.clipboard.readText());

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const usernameB = uniqueUser('profOtherB');
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
    await pageA.locator('.compose input[type="text"]').fill('Message from A');
    await pageA.getByRole('button', { name: /^send$/i }).click();
    await expect(pageB.locator('.msg-content', { hasText: 'Message from A' })).toBeVisible({ timeout: 5_000 });

    // User B clicks on User A's username — should see A's profile but no edit button
    await pageB.locator('.msg-username', { hasText: usernameA }).first().click();
    await expect(pageB.locator('.profile-card')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator('.profile-card-username')).toContainText(usernameA);
    await expect(pageB.locator('.profile-card-edit-btn')).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
