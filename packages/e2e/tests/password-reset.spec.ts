import { test, expect } from '@playwright/test';
import { uniqueUser, register } from './helpers';

const SERVER = 'http://localhost:3002';

/** Register a user with an email address via API, returns { username, email, password }. */
async function registerWithEmail(page: import('@playwright/test').Page, prefix = 'pwreset') {
  const username = uniqueUser(prefix);
  const email = `${username}@example.test`;
  const password = 'testpass123';

  const res = await page.request.post(`${SERVER}/api/auth/register`, {
    data: { username, password, email },
  });
  expect(res.status()).toBe(201);
  return { username, email, password };
}

/** Fetch the latest reset token for an email via the test-only endpoint. */
async function getResetToken(page: import('@playwright/test').Page, email: string): Promise<string> {
  const res = await page.request.get(`${SERVER}/api/auth/test/latest-reset-token?email=${encodeURIComponent(email)}`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { token: string };
  return body.token;
}

test.describe('Password reset flow', () => {
  test('navigates to forgot password screen and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.locator('.auth-screen')).toContainText('reset your password');
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page.locator('.auth-screen')).toContainText('hum');
    await expect(page.getByPlaceholder('username')).toBeVisible();
  });

  test('submits forgot-password email and shows confirmation', async ({ page }) => {
    const { email } = await registerWithEmail(page, 'fpconf');
    await page.goto('/');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.getByPlaceholder('your email address').fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.locator('.auth-screen')).toContainText(
      'If that email is registered, a reset link has been sent',
      { timeout: 5_000 }
    );
  });

  test('unknown email still shows generic confirmation (no enumeration)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.getByPlaceholder('your email address').fill('nobody_xyz@example.test');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.locator('.auth-screen')).toContainText(
      'If that email is registered, a reset link has been sent',
      { timeout: 5_000 }
    );
  });

  test('full reset flow: request token, set new password, login with new password', async ({ page }) => {
    const { username, email } = await registerWithEmail(page, 'fullreset');

    // Request reset
    const resetResp = await page.request.post(`${SERVER}/api/auth/forgot-password`, {
      data: { email },
    });
    expect(resetResp.status()).toBe(200);

    // Get the token via test endpoint
    const token = await getResetToken(page, email);

    // Navigate to reset URL
    await page.goto(`/?reset_token=${token}`);
    await expect(page.locator('.auth-screen')).toContainText('choose a new password', { timeout: 5_000 });

    // Set new password
    const newPassword = 'newpass456';
    await page.getByPlaceholder('new password', { exact: true }).fill(newPassword);
    await page.getByPlaceholder('confirm new password').fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.locator('.auth-screen')).toContainText('Password updated!', { timeout: 5_000 });

    // Sign in with new password
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByPlaceholder('username').fill(username);
    await page.getByPlaceholder('password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.user-name')).toContainText(username);
  });

  test('old password no longer works after reset', async ({ page }) => {
    const { username, email, password: oldPassword } = await registerWithEmail(page, 'oldinvalid');

    // Request + fetch token + reset password
    await page.request.post(`${SERVER}/api/auth/forgot-password`, { data: { email } });
    const token = await getResetToken(page, email);
    const resetRes = await page.request.post(`${SERVER}/api/auth/reset-password`, {
      data: { token, password: 'brandnew789' },
    });
    expect(resetRes.status()).toBe(200);

    // Try logging in with old password
    await page.goto('/');
    await page.getByPlaceholder('username').fill(username);
    await page.getByPlaceholder('password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.error')).toBeVisible({ timeout: 5_000 });
  });

  test('mismatched passwords shows error on reset screen', async ({ page }) => {
    const { email } = await registerWithEmail(page, 'mismatch');
    await page.request.post(`${SERVER}/api/auth/forgot-password`, { data: { email } });
    const token = await getResetToken(page, email);

    await page.goto(`/?reset_token=${token}`);
    await expect(page.locator('.auth-screen')).toContainText('choose a new password', { timeout: 5_000 });
    await page.getByPlaceholder('new password', { exact: true }).fill('password1');
    await page.getByPlaceholder('confirm new password').fill('password2');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.locator('.error')).toContainText(/do not match/i, { timeout: 5_000 });
  });

  test('invalid reset token shows error', async ({ page }) => {
    await page.goto('/?reset_token=invalid_token_xyz_123');
    await expect(page.locator('.auth-screen')).toContainText('choose a new password', { timeout: 5_000 });
    await page.getByPlaceholder('new password', { exact: true }).fill('somepass');
    await page.getByPlaceholder('confirm new password').fill('somepass');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.locator('.error')).toBeVisible({ timeout: 5_000 });
  });

  test('used reset token cannot be reused', async ({ page }) => {
    const { email } = await registerWithEmail(page, 'usedtoken');
    await page.request.post(`${SERVER}/api/auth/forgot-password`, { data: { email } });
    const token = await getResetToken(page, email);

    // Use the token once via API
    const res1 = await page.request.post(`${SERVER}/api/auth/reset-password`, {
      data: { token, password: 'firstnew123' },
    });
    expect(res1.status()).toBe(200);

    // Try to use it again
    const res2 = await page.request.post(`${SERVER}/api/auth/reset-password`, {
      data: { token, password: 'secondnew456' },
    });
    expect(res2.status()).toBe(400);
    const body = await res2.json() as { error: string };
    expect(body.error).toMatch(/already used/i);
  });
});
