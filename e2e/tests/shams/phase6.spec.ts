// المرحلة 6: إصلاحات التجربة — تأكيد قرارات الإعادة للمصنع، زر الصفحة الرئيسية لغير المصنع، حماية إعادة المحاولة من النقر المزدوج، وأرقام الصفحات.
import { test, expect } from '@playwright/test';
import { login, open } from './helpers';
import { apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

test('a correction request is confirmed first: the dialog says it returns to the factory, cancelling changes nothing, confirming applies it', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-CFM-${Date.now() % 100000}`);
  expect((await submitApplication(factory, id)).status).toBe(200);

  await login(page, 'imc1@shams.local');
  await open(page, `#application/${id}`);
  await page.getByTestId('action-request_correction').click();
  await page.getByTestId('def-field-0').selectOption('address');
  await page.getByTestId('def-note-0').fill('اكتب العنوان بالتفصيل');
  await page.getByTestId('decision-submit').click();
  await expect(page.getByTestId('returns-to-factory')).toBeVisible();
  // التراجع: لا تغيير
  await page.getByRole('button', { name: 'إلغاء' }).last().click();
  await expect(page.getByTestId('returns-to-factory')).toHaveCount(0);
  expect((await factory.get(`/applications/${id}`)).state).toBe('IMC_REVIEW');
  // التأكيد: الإجراء يُنفَّذ
  await page.getByTestId('decision-submit').click();
  await page.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('IMC_CORRECTION');
  await closeOpenApplication(factory);
});

test('home: a signed-in reviewer reaches the page from the header and gets a working button to the workspace, with no "start application" call to action', async ({ page }) => {
  await login(page, 'imc1@shams.local');
  await expect(page).toHaveURL(/#workspace\/imc/);
  // the initiative's own screens keep the bar; from a tool screen «عن المبادرة» opens its page on the platform
  await open(page, '#approvals');
  await page.getByTestId('initiative-bar').getByRole('link', { name: 'عن المبادرة' }).click();
  await expect(page).toHaveURL(/#initiative\/shams/);
  const hero = page.getByTestId('initiative-apply').first();
  await expect(hero).toContainText('ادخل لوحة المبادرة');
  await expect(page.getByTestId('cta-bottom')).toHaveCount(0);
  await hero.click();
  await expect(page).toHaveURL(/#workspace\/imc\?i=shams/);
});

test('outbox retry cannot be double-clicked: exactly one request leaves, and the button is disabled meanwhile', async ({ page }) => {
  await login(page, 'admin@shams.local');
  await open(page, '#admin-outbox');
  await page.getByRole('combobox').first().selectOption('skipped').catch(() => undefined);
  const button = page.locator('[data-testid^="retry-"]').first();
  if (!(await button.count())) test.skip(true, 'no failed/skipped message exists in this run to retry');
  let calls = 0;
  await page.route('**/api/v1/i/shams/admin/**/retry', async (route) => { calls += 1; await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await button.click();
  await expect(button).toBeDisabled();
  await button.click({ force: true, timeout: 500 }).catch(() => undefined);
  await expect.poll(() => calls, { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(calls).toBe(1);
});

test('pagers and charts follow the interface language: Arabic digits in Arabic, Latin in English', async ({ page }) => {
  await login(page, 'pmu@shams.local');
  await expect(page).toHaveURL(/#workspace\/pmu/);
  await page.getByTestId('tab-monitoring').click();
  const bars = page.getByTestId('block-by-state');
  await expect(bars).toContainText('الطلبات حسب الحالة');
  const text = await bars.innerText();
  expect(/[0-9]/.test(text.replace(/[A-Za-z_\-\s]/g, ''))).toBe(false);          // لا أرقام لاتينية داخل رسم المراحل بالعربية
  await page.getByRole('button', { name: 'تبديل اللغة إلى الإنجليزية' }).click();
  await expect(bars).toContainText('Applications by state');
  const en = await bars.innerText();
  expect(/[٠-٩]/.test(en)).toBe(false);
  await page.getByRole('button', { name: 'Switch language to Arabic' }).click();
});

test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});
