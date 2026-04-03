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
 * Opens a raw WebSocket connection in the page context, joins the general channel
 * of the given space (or the first space in the DB when spaceId is omitted),
 * sends `count` messages immediately, and returns the list of server responses
 * received for those messages (type: 'message' | 'error').
 *
 * NOTE: GET /api/spaces returns ALL spaces, not just those owned by the user.
 * When testing DOM-visible messages always pass the explicit spaceId so the raw
 * WS joins the same room as the page's own WebSocket.
 */
async function sendManyMessages(
  page: ReturnType<import('@playwright/test').Browser['newPage']> extends Promise<infer P> ? P : never,
  count: number,
  spaceId?: number
): Promise<Array<{ type: string; error?: string }>> {
  return page.evaluate(
    async ({ count, overrideSpaceId }: { count: number; overrideSpaceId: number | null }) => {
      const stored = localStorage.getItem('hum_auth');
      if (!stored) throw new Error('Not authenticated');
      const auth = JSON.parse(stored) as { token: string };

      let resolvedSpaceId: number;
      if (overrideSpaceId !== null) {
        resolvedSpaceId = overrideSpaceId;
      } else {
        // Fallback: use the first space in the list (fine for tests that only
        // check WS response counts, not DOM contents).
        const spacesResp = await fetch('/api/spaces', {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const spaces = (await spacesResp.json()) as Array<{ id: number }>;
        if (!spaces.length) throw new Error('No spaces found');
        resolvedSpaceId = spaces[0].id;
      }

      return new Promise<Array<{ type: string; error?: string }>>((resolve, reject) => {
        const ws = new WebSocket(`ws://${window.location.host}/ws`);
        const responses: Array<{ type: string; error?: string }> = [];

        const timeout = setTimeout(() => {
          ws.close();
          resolve(responses); // resolve with whatever we have
        }, 6_000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join', spaceId: resolvedSpaceId, channelId: 'general', token: auth.token }));
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
    { count, overrideSpaceId: spaceId ?? null }
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
    // Capture the unique space name upfront so we can locate the space by name
    // later. GET /api/spaces returns ALL spaces (no per-user filter), so we must
    // search by the unique name rather than relying on spaces[0].
    const spaceName = `RLChatSpace_${Date.now()}`;
    await register(page, uniqueUser('rlChat'));
    await createSpace(page, spaceName);

    // Resolve the space ID by name so sendManyMessages joins the SAME room as
    // the page's own WebSocket.  Without this the raw WS would join a different
    // space (spaces[0] sorted by name) and its messages would never be broadcast
    // to the page's WS, causing the DOM check to see 0 messages.
    const spaceId = await page.evaluate(async (sName) => {
      const auth = JSON.parse(localStorage.getItem('hum_auth')!) as { token: string };
      const spaces = await fetch('/api/spaces', {
        headers: { Authorization: `Bearer ${auth.token}` },
      }).then(r => r.json()) as Array<{ id: number; name: string }>;
      const found = spaces.find(s => s.name === sName);
      if (!found) throw new Error(`Space "${sName}" not found`);
      return found.id;
    }, spaceName);

    // Send a warmup message via the UI compose input to confirm the page's WS
    // has joined the room, and to consume 1 slot of the 20-message rate budget.
    const warmupText = `warmup-${Date.now()}`;
    await page.locator('input[placeholder^="Message #"]').fill(warmupText);
    await page.locator('input[placeholder^="Message #"]').press('Enter');
    await expect(page.locator('.msg-content', { hasText: warmupText })).toBeVisible({ timeout: 8_000 });

    // Blast 25 messages via raw WebSocket in the SAME space as the page WS.
    // The warmup consumed 1 rate-limit slot, so only 19 of the 25 are stored.
    // sendManyMessages resolves only after receiving all responses; each 'message'
    // response is a broadcast that happens AFTER the DB insert, so all 19
    // successful messages are committed to the DB before this returns.
    await sendManyMessages(page, WS_RATE_MAX + 5, spaceId);

    // Verify via REST that the DB holds at most WS_RATE_MAX rate-test messages.
    // Only stored messages can appear in chat (served as history on WS join), so
    // this is the ground truth for what will be visible in the chat view.
    const rateMsgCount = await page.evaluate(async ({ sid }: { sid: number }) => {
      const auth = JSON.parse(localStorage.getItem('hum_auth')!) as { token: string };
      const messages = await fetch(
        `/api/spaces/${sid}/messages?channel=general`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      ).then(r => r.json()) as Array<{ content: string }>;
      return messages.filter(m => m.content.startsWith('rate-test-')).length;
    }, { sid: spaceId });

    expect(rateMsgCount).toBeLessThanOrEqual(WS_RATE_MAX);
    expect(rateMsgCount).toBeGreaterThan(0); // At least some messages got through
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
