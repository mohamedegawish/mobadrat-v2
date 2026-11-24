// F8 (QA 2026-11-23, BUG-12): no console error on page load — not for a visitor (the session probe finds no session and
// says so without an error status) and not for a signed-in person reloading pages.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function load(page: Page, url: string) {
  await page.goto(url);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test('page loads log no console error — as a visitor and signed in (the session probe)', async ({ page }) => {
  const errors = watch(page);
  for (const url of ['/', '/#login', '/#i/shams/register']) await load(page, url);
  expect.soft(errors, 'visitor: public pages').toEqual([]);

  await login(page, 'factory@shams.local');
  errors.length = 0;
  for (const url of ['/#hub', '/', '/#initiatives']) await load(page, url);
  expect.soft(errors, 'signed in: factory').toEqual([]);

  await login(page, 'imc1@shams.local');
  errors.length = 0;
  for (const url of ['/#workspace/imc', '/']) await load(page, url);
  expect.soft(errors, 'signed in: IMC').toEqual([]);
});
