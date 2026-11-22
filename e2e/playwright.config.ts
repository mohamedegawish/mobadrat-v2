import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

/**
 * End-to-end journeys of the platform and of every initiative, from a brand-new user to the final outcome.
 * Starts its own API (:5200, fresh `mobadrat_e2e` database + demo seed, e-mails captured to files) and frontend (:5273),
 * so it never touches the development database. Needs MySQL: docker compose -f docker-compose.dev.yml up -d mysql
 *   cd e2e && npm install && npx playwright install chromium && npm test
 * Order: the initiative suites first (on the pristine seed), the cross-initiative platform journeys last.
 */
export const MAIL_DIR = process.env.E2E_MAIL_DIR ?? path.join(os.tmpdir(), 'mobadrat-e2e-mail');
process.env.E2E_MAIL_DIR = MAIL_DIR;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5273', locale: 'ar-EG', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'shams', testDir: './tests/shams', testIgnore: /mobile/, use: { ...devices['Desktop Chrome'] } },
    { name: 'shams-mobile', testDir: './tests/shams', testMatch: /mobile/, use: { ...devices['Pixel 7'] }, dependencies: ['shams'] },
    { name: 'sona3', testDir: './tests/sona3', use: { ...devices['Desktop Chrome'] }, dependencies: ['shams-mobile'] },
    { name: 'platform', testMatch: /(platform|bodies|account)\.spec\.ts/, use: { ...devices['Desktop Chrome'] }, dependencies: ['sona3'] },
  ],
  webServer: [
    { command: 'node start-backend.mjs', url: 'http://localhost:5200/health', timeout: 180_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
    {
      command: 'npx vite --port 5273 --strictPort', cwd: '../frontend', url: 'http://localhost:5273', timeout: 120_000, reuseExistingServer: false,
      env: { VITE_PROXY_TARGET: 'http://localhost:5200' },
    },
  ],
});
