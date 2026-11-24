// F7 (QA 2026-11-23, BUG-11): the sign-up page checks the registry-number format itself, before sending — the field shows a
// clear Arabic message as soon as the number is typed, nothing is sent, and a well-formed number clears the message.
import { test, expect } from '@playwright/test';

test('sign-up page: a badly formed registry number is flagged in Arabic on the page, before anything is sent', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/public\/register/.test(r.url())) sent.push(r.url()); });

  await page.goto('/#i/shams/register');
  await page.getByTestId('reg-step-company').click();
  const field = page.locator('#f-industrialRegistryNumber');
  await field.fill('IND#BAD!');
  await field.blur();

  const message = page.getByText(/صيغة غير صالحة/).first();
  await expect(message).toBeVisible();
  await expect(page.getByTestId('reg-step-company')).not.toHaveAttribute('data-complete', '1');
  expect(sent, 'nothing is sent to the server for the check').toHaveLength(0);

  await field.fill(`IND-F7-${Date.now() % 100000}`);
  await expect(page.getByText(/صيغة غير صالحة/)).toHaveCount(0);
  expect(sent).toHaveLength(0);
});
