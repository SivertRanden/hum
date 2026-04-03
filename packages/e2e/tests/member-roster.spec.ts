import { test, expect, Browser } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/**
 * Creates a space as user A, copies the invite link, and returns the invite URL.
 */
async function setupSpaceWithInvite(browser: Browser) {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const usernameA = uniqueUser('rosterOwner');
  await register(pageA, usernameA);
  const spaceName = `RosterSpace_${Date.now()}`;
  await createSpace(pageA, spaceName);

  // Wait for the members section to render (owner is always a member)
  await expect(pageA.locator('.channel-add-btn[title="Copy invite link"]')).toBeVisible({ timeout: 5_000 });

  // Intercept the invite creation API response to capture the token
  // (avoids clipboard isolation issues across browser contexts)
  const inviteResponsePromise = pageA.waitForResponse(
    resp => /\/spaces\/\d+\/invites$/.test(resp.url()) && resp.request().method() === 'POST'
  );
  await pageA.locator('.channel-add-btn[title="Copy invite link"]').click();
  const inviteResponse = await inviteResponsePromise;
  const { token } = await inviteResponse.json() as { token: string; expiresAt: number };
  const inviteUrl = `http://localhost:5174?invite=${token}`;

  return { ctxA, pageA, usernameA, spaceName, inviteUrl };
}

/**
 * Registers user B and joins the space via the invite URL.
 */
async function joinAsUserB(browser: Browser, inviteUrl: string, spaceName: string) {
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const usernameB = uniqueUser('rosterGuest');
  await register(pageB, usernameB);
  await pageB.goto(inviteUrl);
  await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
  return { ctxB, pageB, usernameB };
}

test.describe('Member roster & invite links', () => {
  test('member list toggle is visible after creating a space', async ({ page }) => {
    await register(page, uniqueUser('toggleTest'));
    await createSpace(page, `ToggleSpace_${Date.now()}`);

    // The members section toggle should appear (owner is a member)
    const membersToggle = page.locator('.channel-section-toggle', { hasText: /Members \(\d+\)/ });
    await expect(membersToggle).toBeVisible({ timeout: 5_000 });
  });

  test('expanding member list shows the space creator as owner', async ({ page }) => {
    const username = uniqueUser('ownerEntry');
    await register(page, username);
    await createSpace(page, `OwnerSpace_${Date.now()}`);

    // Expand the member list
    await page.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // The creator's entry should appear
    await expect(page.locator('.member-entry')).toBeVisible({ timeout: 3_000 });

    // Owner role badge should be displayed
    await expect(page.locator('.member-role-owner')).toBeVisible();
  });

  test('invite link button shows "Invite link copied!" toast', async ({ page }) => {
    await register(page, uniqueUser('toastTest'));
    await createSpace(page, `ToastSpace_${Date.now()}`);

    await expect(page.locator('.channel-add-btn[title="Copy invite link"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('.channel-add-btn[title="Copy invite link"]').click();

    // Toast notification appears
    await expect(page.locator('.invite-copied-toast')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.invite-copied-toast')).toContainText(/invite link copied/i);

    // Toast auto-dismisses after ~2 seconds
    await expect(page.locator('.invite-copied-toast')).not.toBeVisible({ timeout: 5_000 });
  });

  test('invite link copies a valid URL to clipboard', async ({ page }) => {
    await register(page, uniqueUser('clipTest'));
    await createSpace(page, `ClipSpace_${Date.now()}`);

    await expect(page.locator('.channel-add-btn[title="Copy invite link"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('.channel-add-btn[title="Copy invite link"]').click();
    await expect(page.locator('.channel-add-btn[title="Copied!"]')).toBeVisible({ timeout: 10_000 });

    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());

    // Should be a URL containing an invite token param
    expect(clipboardText).toMatch(/\?invite=\S+/);
  });

  test('joining via invite link lands on the correct space', async ({ browser }) => {
    const { ctxA, ctxB, pageB, spaceName } = await (async () => {
      const setup = await setupSpaceWithInvite(browser);
      const joined = await joinAsUserB(browser, setup.inviteUrl, setup.spaceName);
      return { ...setup, ...joined };
    })();

    // User B should see the space name in the sidebar header
    await expect(pageB.locator('.channel-server-name')).toContainText(spaceName);

    // The general channel should exist in the sidebar
    await expect(pageB.locator('.channel-item', { hasText: 'general' })).toBeVisible();

    // Space icon should appear in the server rail
    await expect(pageB.locator(`.server-icon[title="${spaceName}"]`)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('new member appears in roster after joining via invite', async ({ browser }) => {
    const { ctxA, pageA, spaceName, inviteUrl } = await setupSpaceWithInvite(browser);
    const { ctxB, usernameB } = await joinAsUserB(browser, inviteUrl, spaceName);

    // Reload user A's page to pick up the new member (no real-time push for join events)
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });

    // Navigate back to the space to trigger a fresh member list fetch
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();
    await expect(pageA.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // Expand the member list
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // User B should now appear in the roster
    await expect(pageA.locator('.member-entry .member-name', { hasText: usernameB })).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('member count in toggle reflects all members', async ({ browser }) => {
    const { ctxA, pageA, spaceName, inviteUrl } = await setupSpaceWithInvite(browser);
    const { ctxB } = await joinAsUserB(browser, inviteUrl, spaceName);

    // Reload user A to refresh state
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();

    // Toggle should show 2 members (owner + guest)
    await expect(pageA.locator('.channel-section-toggle', { hasText: 'Members (2)' })).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('member entry shows username in the roster', async ({ browser }) => {
    const { ctxA, pageA, spaceName, inviteUrl } = await setupSpaceWithInvite(browser);
    const { ctxB, usernameB } = await joinAsUserB(browser, inviteUrl, spaceName);

    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // Both usernames should appear
    const memberNames = pageA.locator('.member-entry .member-name');
    await expect(memberNames.filter({ hasText: usernameB })).toBeVisible({ timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
