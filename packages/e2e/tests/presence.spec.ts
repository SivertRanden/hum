import { test, expect, Browser } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/**
 * Sets up User A with a space and an invite URL captured via network interception.
 */
async function setupOwner(browser: Browser) {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const usernameA = uniqueUser('presOwner');
  await register(pageA, usernameA);
  const spaceName = `PresSpace_${Date.now()}`;
  await createSpace(pageA, spaceName);

  await expect(pageA.locator('.channel-add-btn[title="Copy invite link"]')).toBeVisible({ timeout: 5_000 });

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
 * Registers User B and joins the space via invite URL.
 */
async function joinGuest(browser: Browser, inviteUrl: string, spaceName: string) {
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const usernameB = uniqueUser('presGuest');
  await register(pageB, usernameB);
  await pageB.goto(inviteUrl);
  await expect(pageB.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
  return { ctxB, pageB, usernameB };
}

test.describe('Presence (online/away status)', () => {
  test('space owner shows as online in member list', async ({ page }) => {
    const username = uniqueUser('ownerOnline');
    await register(page, username);
    await createSpace(page, `OnlineSpace_${Date.now()}`);

    // Expand the member list
    await page.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // Owner (the logged-in user) should show the online presence dot
    const ownerEntry = page.locator('.member-entry').filter({ has: page.locator('.member-role-owner') });
    await expect(ownerEntry.locator('.presence-dot.online')).toBeVisible({ timeout: 5_000 });
  });

  test('member shows as online when connected', async ({ browser }) => {
    const { ctxA, pageA, spaceName, inviteUrl } = await setupOwner(browser);
    const { ctxB, usernameB } = await joinGuest(browser, inviteUrl, spaceName);

    // User A reloads to pick up User B in the member list
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();
    await expect(pageA.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // Expand the member list
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // User B should appear as online (they are connected via WebSocket)
    const guestEntry = pageA.locator('.member-entry', { has: pageA.locator('.member-name', { hasText: usernameB }) });
    await expect(guestEntry.locator('.presence-dot.online')).toBeVisible({ timeout: 8_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('member shows as offline after disconnecting', async ({ browser }) => {
    const { ctxA, pageA, spaceName, inviteUrl } = await setupOwner(browser);
    const { ctxB, usernameB } = await joinGuest(browser, inviteUrl, spaceName);

    // User A reloads to load the member list with User B
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();
    await expect(pageA.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // Expand the member list and confirm User B is visible
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();
    const guestEntry = pageA.locator('.member-entry', { has: pageA.locator('.member-name', { hasText: usernameB }) });
    await expect(guestEntry).toBeVisible({ timeout: 5_000 });

    // Wait for User B to show online before testing offline transition
    await expect(guestEntry.locator('.presence-dot.online')).toBeVisible({ timeout: 8_000 });

    // Close User B's context (disconnects WebSocket)
    await ctxB.close();

    // User A should receive a presence_update:offline event via WebSocket
    await expect(guestEntry.locator('.presence-dot.offline')).toBeVisible({ timeout: 8_000 });
    await expect(guestEntry.locator('.presence-dot.online')).not.toBeVisible();

    await ctxA.close();
  });

  test('presence dot is visible for each member entry', async ({ page }) => {
    await register(page, uniqueUser('presEntry'));
    await createSpace(page, `EntrySpace_${Date.now()}`);

    // Expand the member list
    await page.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    // Every visible member entry should have a presence dot
    const entries = page.locator('.member-entry');
    await expect(entries).toHaveCount(1, { timeout: 3_000 });

    // The one entry (owner) should have exactly one presence dot
    const dot = entries.first().locator('.presence-dot');
    await expect(dot).toBeVisible();
    // It should be either online or offline
    const className = await dot.getAttribute('class');
    expect(className).toMatch(/presence-dot (online|offline)/);
  });

  test('presence indicator in member list updates in real time', async ({ browser }) => {
    // Set up owner and join guest — then verify WebSocket presence propagation
    const { ctxA, pageA, spaceName, inviteUrl } = await setupOwner(browser);

    // Expand member list before User B joins
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();
    await expect(pageA.locator('.member-entry')).toHaveCount(1, { timeout: 3_000 });

    // User B joins the space
    const { ctxB, usernameB } = await joinGuest(browser, inviteUrl, spaceName);

    // User A reloads to see User B in the roster
    await pageA.reload();
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await pageA.locator(`.server-icon[title="${spaceName}"]`).click();
    await pageA.locator('.channel-section-toggle', { hasText: /Members/ }).click();

    const guestEntry = pageA.locator('.member-entry', { has: pageA.locator('.member-name', { hasText: usernameB }) });
    await expect(guestEntry.locator('.presence-dot.online')).toBeVisible({ timeout: 8_000 });

    // Now close User B — real-time offline update
    await ctxB.close();
    await expect(guestEntry.locator('.presence-dot.offline')).toBeVisible({ timeout: 8_000 });

    await ctxA.close();
  });
});
