/**
 * E2E tests for rate limiting on message endpoints.
 *
 * HTTP rate limits are disabled in the test environment via DISABLE_RATE_LIMIT=1.
 * WebSocket message rate limiting (20 messages per 10 seconds per user) is always
 * active and is tested here using a raw WebSocket in page.evaluate.
 */
import { test, expect } from '@playwright/test';
import { uniqueUser, register, createSpace } from './helpers';

const WS_RATE_MAX = 20; // matches server constant

/**
 * Opens a raw WebSocket connection in the page context, joins the general channel,
 * sends `count` messages immediately, and returns the list of server responses
 * received for those messages (type: 'message' | 'error').
 */
async function sendManyMessages(
  page: ReturnType<import('@playwright/test').Browser['newPage']> extends Promise<infer P> ? P : never,
  count: number
): Promise<Array<{ type: string; error?: string }>> {
  return page.evaluate(
    async ({ count }: { count: number }) => {
      const stored = localStorage.getItem('hum_auth');
      if (!stored) throw new Error('Not authenticated');
      const auth = JSON.parse(stored) as { token: string };

      // Fetch space list to get the first space ID
      const spacesResp = await fetch('/api/spaces', {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const spaces = (await spacesResp.json()) as Array<{ id: number }>;
      if (!spaces.length) throw new Error('No spaces found');
      const spaceId = spaces[0].id;

      return new Promise<Array<{ type: string; error?: string }>>((resolve, reject) => {
        const ws = new WebSocket(`ws://${window.location.host}/ws`);
        const responses: Array<{ type: string; error?: string }> = [];

        const timeout = setTimeout(() => {
          ws.close();
          resolve(responses); // resolve with whatever we have
        }, 6_000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join', spaceId, channelId: 'general', token: auth.token }));
        };

        ws.onmessage = (evt) => {
          const data = JSON.parse(evt.data as string) as { type: string; error?: string };
          if (data.type === 'joined') {
            // Send all messages as fast as possible
            for (let i = 1; i <= count; i++) {
              ws.send(JSON.stringify({ type: 'message', content: `rate-test-${i}` }));
            }
          } else if (data.type === 'message' || (data.type === 'error' && data.error?.includes('rate limit'))) {
            responses.push(data);
            if (responses.length >= count) {
              clearTimeout(timeout);
              ws.close();
              resolve(responses);
            }
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
      });
    },
    { count }
  );
}

test.describe('Rate limiting on message endpoints', () => {
  test('WebSocket allows up to 20 messages in a 10-second window', async ({ page }) => {
    await register(page, uniqueUser('rlAllow'));
    await createSpace(page, `RLSpace_${Date.now()}`);

    // Send exactly 20 messages — all should succeed
    const responses = await sendManyMessages(page, WS_RATE_MAX);

    const successes = responses.filter(r => r.type === 'message');
    const rateLimited = responses.filter(r => r.type === 'error' && r.error?.includes('rate limit'));

    expect(successes.length).toBe(WS_RATE_MAX);
    expect(rateLimited.length).toBe(0);
  });

  test('WebSocket rate limits messages beyond 20 per 10-second window', async ({ page }) => {
    await register(page, uniqueUser('rlExceed'));
    await createSpace(page, `RLExSpace_${Date.now()}`);

    const over = 5;
    const responses = await sendManyMessages(page, WS_RATE_MAX + over);

    const successes = responses.filter(r => r.type === 'message');
    const rateLimited = responses.filter(r => r.type === 'error' && r.error?.includes('rate limit'));

    // At most 20 messages succeed; the rest are rate limited
    expect(successes.length).toBeLessThanOrEqual(WS_RATE_MAX);
    expect(rateLimited.length).toBeGreaterThanOrEqual(over);
  });

  test('rate limited messages do not appear in the chat', async ({ page }) => {
    await register(page, uniqueUser('rlChat'));
    await createSpace(page, `RLChatSpace_${Date.now()}`);

    // createSpace already lands on the general channel — confirm before sending
    await expect(page.locator('.main-header')).toContainText('general', { timeout: 5_000 });

    // Blast 25 messages via raw WebSocket — only 20 succeed (rate limit)
    await sendManyMessages(page, WS_RATE_MAX + 5);

    // Reload so the page fetches history from the DB; this guarantees we see
    // exactly the messages that were persisted (≤20), not a live-broadcast race.
    await page.reload();
    await expect(page.locator('.main-header')).toContainText('general', { timeout: 5_000 });

    // The chat should contain at most 20 of the rate-test messages (not 25)
    const rateMsgs = page.locator('.msg-content', { hasText: /^rate-test-/ });
    await expect(rateMsgs.first()).toBeVisible({ timeout: 5_000 });
    const count = await rateMsgs.count();
    expect(count).toBeLessThanOrEqual(WS_RATE_MAX);
    expect(count).toBeGreaterThan(0); // At least some messages got through
  });

  test('rate limit error response contains the correct message', async ({ page }) => {
    await register(page, uniqueUser('rlErr'));
    await createSpace(page, `RLErrSpace_${Date.now()}`);

    // Send enough to trigger a rate limit error
    const responses = await sendManyMessages(page, WS_RATE_MAX + 1);

    const rateLimited = responses.find(r => r.type === 'error' && r.error?.includes('rate limit'));
    expect(rateLimited).toBeDefined();
    expect(rateLimited?.error).toContain('rate limit exceeded');
  });

  test('rate limit window resets after 10 seconds', async ({ page }) => {
    await register(page, uniqueUser('rlReset'));
    await createSpace(page, `RLResetSpace_${Date.now()}`);

    // Exhaust the rate limit
    const firstBatch = await sendManyMessages(page, WS_RATE_MAX + 2);
    const firstRateLimited = firstBatch.filter(r => r.type === 'error' && r.error?.includes('rate limit'));
    expect(firstRateLimited.length).toBeGreaterThan(0);

    // Wait for the rate limit window to reset (10 seconds + buffer)
    await page.waitForTimeout(11_000);

    // After reset, a new batch of messages should succeed
    const secondBatch = await sendManyMessages(page, 5);
    const secondSuccesses = secondBatch.filter(r => r.type === 'message');
    const secondRateLimited = secondBatch.filter(r => r.type === 'error' && r.error?.includes('rate limit'));

    expect(secondSuccesses.length).toBe(5);
    expect(secondRateLimited.length).toBe(0);
  });
});
