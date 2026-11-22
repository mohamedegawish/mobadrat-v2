import { defineConfig, devices } from '@playwright/test';

/**
 * Platform end-to-end journeys. Starts its own API (:5200, fresh `mobadrat_e2e` database + demo seed) and frontend (:5273),
 * so it never touches the development database. Needs MySQL: docker compose -f docker-compose.dev.yml up -d mysql
 *   cd e2e && npm install && npx playwright install chromium && npm test
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5273', locale: 'ar-EG', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: 'node start-backend.mjs', url: 'http://localhost:5200/health', timeout: 120_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
    {
      command: 'npx vite --port 5273 --strictPort', cwd: '../frontend', url: 'http://localhost:5273', timeout: 120_000, reuseExistingServer: false,
      env: { VITE_PROXY_TARGET: 'http://localhost:5200' },
    },
  ],
});
