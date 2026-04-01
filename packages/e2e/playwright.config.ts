import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '../..');
const TEST_DB = path.join(os.tmpdir(), `hum-e2e-${Date.now()}.db`);
const SERVER_PORT = 3002;
const CLIENT_PORT = 5174;

export default defineConfig({
  testDir: './tests',
  // Run tests serially — SQLite and WebSocket state is shared
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `cd ${ROOT} && pnpm --filter @hum/server dev`,
      url: `http://localhost:${SERVER_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DB_PATH: TEST_DB,
        PORT: String(SERVER_PORT),
        CLIENT_ORIGIN: `http://localhost:${CLIENT_PORT}`,
        DISABLE_RATE_LIMIT: '1',
      },
    },
    {
      command: `cd ${ROOT} && pnpm --filter @hum/client dev --port ${CLIENT_PORT}`,
      url: `http://localhost:${CLIENT_PORT}`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_URL: `http://localhost:${SERVER_PORT}`,
      },
    },
  ],
});
