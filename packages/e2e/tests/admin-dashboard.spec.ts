import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

/** Join a space via its invite URL (handles auth screen if needed). */
async function joinViaInvite(page: import('@playwright/test').Page, inviteUrl: string, username: string) {
  await page.goto(inviteUrl);
  if (await page.locator('.auth-screen').isVisible()) {
    await page.getByRole('button', { name: /no account\? register/i }).click();
    await page.getByPlaceholder('username').fill(username);
    await page.getByPlaceholder('password', { exact: true }).fill('testpass123');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
  }
}

/** Open the members list in the sidebar. */
async function openMembersList(page: import('@playwright/test').Page) {
  const toggle = page.locator('.channel-section-toggle', { hasText: /Members/ });
  if (await toggle.isVisible()) await toggle.click();
}

test.describe('Admin dashboard', () => {
  test('admin dashboard button is only visible to the space owner', async ({ browser }) => {
    const ctxOwner = await browser.newContext();
    const pageOwner = await ctxOwner.newPage();
    const ownerUsername = uniqueUser('adminOwner');
    await register(pageOwner, ownerUsername);
    const spaceName = `AdminSpace_${Date.now()}`;
    await createSpace(pageOwner, spaceName);
    await pageOwner.locator('.channel-item', { hasText: 'general' }).click();

    // Copy invite link
    await pageOwner.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageOwner.evaluate(async () => navigator.clipboard.readText());

    // Owner sees the admin dashboard button
    await expect(pageOwner.locator('[aria-label="Admin dashboard"]')).toBeVisible({ timeout: 5_000 });

    // Member joins
    const ctxMember = await browser.newContext();
    const pageMember = await ctxMember.newPage();
    const memberUsername = uniqueUser('adminMember');
    await joinViaInvite(pageMember, inviteUrl, memberUsername);
    await expect(pageMember.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });
    await pageMember.locator('.channel-item', { hasText: 'general' }).click();

    // Non-owner member does NOT see the admin dashboard button
    await expect(pageMember.locator('[aria-label="Admin dashboard"]')).not.toBeVisible();

    await ctxOwner.close();
    await ctxMember.close();
  });

  test('owner can open admin dashboard and see audit log tab', async ({ page }) => {
    await register(page, uniqueUser('auditOwner'));
    const spaceName = `AuditSpace_${Date.now()}`;
    await createSpace(page, spaceName);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Open admin dashboard
    await page.locator('[aria-label="Admin dashboard"]').click();
    await expect(page.locator('.admin-dashboard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.admin-dashboard-title')).toContainText('Admin');

    // Audit Log tab is visible by default
    await expect(page.locator('.admin-tab', { hasText: 'Audit Log' })).toBeVisible();
    await expect(page.locator('.admin-tab.active', { hasText: 'Audit Log' })).toBeVisible();
  });

  test('audit log records message edits', async ({ page }) => {
    await register(page, uniqueUser('auditEdit'));
    const spaceName = `AuditEditSpace_${Date.now()}`;
    await createSpace(page, spaceName);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    // Send and edit a message to create an audit entry
    await page.locator('.compose input:not([type="file"])').fill('Original msg');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.locator('.msg-content', { hasText: 'Original msg' })).toBeVisible({ timeout: 5_000 });
    await page.locator('[title="Edit"]').first().click();
    await page.locator('.msg-edit-input').clear();
    await page.locator('.msg-edit-input').fill('Edited msg');
    await page.locator('.msg-edit-save').click();
    await expect(page.locator('.msg-content', { hasText: 'Edited msg' })).toBeVisible({ timeout: 5_000 });

    // Open admin dashboard
    await page.locator('[aria-label="Admin dashboard"]').click();
    await expect(page.locator('.admin-dashboard')).toBeVisible({ timeout: 5_000 });

    // Should show an audit log entry for the edit
    await expect(page.locator('.audit-log-entry')).toHaveCount({ min: 1 }, { timeout: 5_000 });
    await expect(page.locator('.audit-log-action', { hasText: /edited message/i }).first()).toBeVisible();
  });

  test('members tab shows member list with online count', async ({ page }) => {
    await register(page, uniqueUser('membersTab'));
    const spaceName = `MembersTabSpace_${Date.now()}`;
    await createSpace(page, spaceName);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('[aria-label="Admin dashboard"]').click();
    await expect(page.locator('.admin-dashboard')).toBeVisible({ timeout: 5_000 });

    await page.locator('.admin-tab', { hasText: 'Members' }).click();
    await expect(page.locator('.admin-member-list')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.admin-member-entry')).toHaveCount({ min: 1 });
    // Stats row shows total members
    await expect(page.locator('.admin-stat-label', { hasText: 'Total members' })).toBeVisible();
  });

  test('owner can change member role via sidebar', async ({ browser }) => {
    const ctxOwner = await browser.newContext();
    const pageOwner = await ctxOwner.newPage();
    const ownerUsername = uniqueUser('roleOwner');
    await register(pageOwner, ownerUsername);
    const spaceName = `RoleSpace_${Date.now()}`;
    await createSpace(pageOwner, spaceName);
    await pageOwner.locator('.channel-item', { hasText: 'general' }).click();

    // Copy invite link
    await pageOwner.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageOwner.evaluate(async () => navigator.clipboard.readText());

    // Member joins
    const ctxMember = await browser.newContext();
    const pageMember = await ctxMember.newPage();
    const memberUsername = uniqueUser('roleMember');
    await joinViaInvite(pageMember, inviteUrl, memberUsername);
    await expect(pageMember.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // Owner opens member list
    await openMembersList(pageOwner);
    await expect(pageOwner.locator('.member-entry', { hasText: memberUsername })).toBeVisible({ timeout: 5_000 });

    // Owner opens manage menu for the member and promotes to moderator
    await pageOwner.locator('.member-entry', { hasText: memberUsername }).locator('.member-manage-btn').click();
    await expect(pageOwner.locator('.member-menu')).toBeVisible({ timeout: 3_000 });
    await pageOwner.locator('.member-menu').getByRole('button', { name: /set moderator/i }).click();

    // Member role badge should now show moderator
    await expect(pageOwner.locator('.member-entry', { hasText: memberUsername }).locator('.member-role-moderator')).toBeVisible({ timeout: 5_000 });

    await ctxOwner.close();
    await ctxMember.close();
  });

  test('owner can kick a member from the space', async ({ browser }) => {
    const ctxOwner = await browser.newContext();
    const pageOwner = await ctxOwner.newPage();
    const ownerUsername = uniqueUser('kickOwner');
    await register(pageOwner, ownerUsername);
    const spaceName = `KickSpace_${Date.now()}`;
    await createSpace(pageOwner, spaceName);
    await pageOwner.locator('.channel-item', { hasText: 'general' }).click();

    // Copy invite link
    await pageOwner.locator('.channel-add-btn[title="Copy invite link"]').click();
    const inviteUrl = await pageOwner.evaluate(async () => navigator.clipboard.readText());

    // Member joins
    const ctxMember = await browser.newContext();
    const pageMember = await ctxMember.newPage();
    const memberUsername = uniqueUser('kickMember');
    await joinViaInvite(pageMember, inviteUrl, memberUsername);
    await expect(pageMember.locator('.channel-server-name', { hasText: spaceName })).toBeVisible({ timeout: 5_000 });

    // Owner opens member list and kicks the member
    await openMembersList(pageOwner);
    await expect(pageOwner.locator('.member-entry', { hasText: memberUsername })).toBeVisible({ timeout: 5_000 });

    await pageOwner.locator('.member-entry', { hasText: memberUsername }).locator('.member-manage-btn').click();
    await expect(pageOwner.locator('.member-menu')).toBeVisible({ timeout: 3_000 });
    await pageOwner.locator('.member-menu').locator('.member-menu-kick').click();

    // Member should no longer appear in the list
    await expect(pageOwner.locator('.member-entry', { hasText: memberUsername })).not.toBeVisible({ timeout: 5_000 });

    await ctxOwner.close();
    await ctxMember.close();
  });

  test('closing the admin dashboard returns to normal view', async ({ page }) => {
    await register(page, uniqueUser('adminClose'));
    const spaceName = `AdminCloseSpace_${Date.now()}`;
    await createSpace(page, spaceName);
    await page.locator('.channel-item', { hasText: 'general' }).click();

    await page.locator('[aria-label="Admin dashboard"]').click();
    await expect(page.locator('.admin-dashboard')).toBeVisible({ timeout: 5_000 });

    await page.locator('.admin-close-btn').click();
    await expect(page.locator('.admin-dashboard')).not.toBeVisible({ timeout: 3_000 });
  });
});
