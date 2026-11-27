// D11-D18 (owner changes 2026-11-27) as the screens show them: the application page, IMC's notes at the field,
// the ministry portal rejecting with notes, and PMU reminding the late party.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { login, open, pdfFile } from './helpers';
import { act, apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

const uniq = () => `${Date.now() % 1_000_000}`;

/** Ages the application past its deadline directly in the e2e database (no API moves the clock). */
async function makeOverdue(id: string) {
  const mysql = createRequire(path.resolve(import.meta.dirname, '..', '..', '..', 'backend', 'package.json'))('mysql2/promise');
  const url = new URL(process.env.MYSQL_E2E_URL ?? 'mysql://root:root@127.0.0.1:3306');
  const db = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: 'mobadrat_e2e' });
  await db.query("UPDATE shams_applications SET stateEnteredAt = '2020-01-01T00:00:00.000Z', slaStartedAt = '2020-01-01T00:00:00.000Z' WHERE id = ?", [id]);
  await db.end();
}

test('D11 / D16: two tabs, «action — party» stages, and the factory opens on the field IMC asked to change', async ({ page, browser, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const imc = await apiLogin(request, 'imc1@shams.local');
  const id = await seedCompleteDraft(factory, `IND-E2E-OC-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);

  const reviewer = await (await browser.newContext()).newPage();
  await login(reviewer, 'imc1@shams.local');
  await open(reviewer, `#application/${id}`);
  await expect(reviewer.getByRole('tab')).toHaveCount(2);
  await expect(reviewer.getByText('نتيجة التحقق من السجل الصناعي')).toHaveCount(0);
  await expect(reviewer.getByText('مراجعة الطلب — IMC').first()).toBeVisible();

  expect((await act(imc, id, 'request_correction', { deficiencies: [{ field: 'peakLoad', note: 'راجع أقصى حمل' }] })).status).toBe(200);
  await login(page, 'factory@shams.local');
  await open(page, '#factory-dashboard');
  await expect(page.getByTestId('returned-notice')).toContainText('١');
  await expect(page.getByTestId('current-task').getByText('راجع أقصى حمل')).toHaveCount(0);   // the note is at the field
  await page.getByTestId('task-go').click();
  await expect(page.locator('#f-peakLoad')).toBeInViewport();
  await expect(page.getByText('راجع أقصى حمل')).toBeVisible();
  await closeOpenApplication(factory);
});

test('D17 / D18: the ministry rejects with notes from its portal; PMU reminds the late party', async ({ page, browser, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const [imc, encpc, pmu] = await Promise.all(['imc1@shams.local', 'encpc@shams.local', 'pmu@shams.local'].map((e) => apiLogin(request, e)));
  const id = await seedCompleteDraft(factory, `IND-E2E-OC2-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);
  expect((await act(imc, id, 'accept')).status).toBe(200);
  expect((await act(encpc, id, 'compliant')).status).toBe(200);
  expect(await factory.upload(`/applications/${id}/documents`, 'technicalOfferFile', 'offer.pdf')).toBe(201);
  expect((await act(factory, id, 'submit_offer')).status).toBe(200);
  expect((await act(pmu, id, 'accept')).status).toBe(200);

  await login(page, 'electricity@shams.local');
  await open(page, `#application/${id}`);
  await expect(page.getByTestId('provider-info')).toContainText('offers@provider.test');
  await expect(page.getByTestId('stage-files-technicalOfferFile')).toContainText('offer.pdf');
  await page.getByTestId('action-request_correction').click();
  await expect(page.getByTestId('decision-submit')).toBeDisabled();
  await page.getByTestId('decision-reason').fill('الرسم الهندسي غير موقع');
  await page.getByTestId('decision-submit').click();
  await page.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('ELECTRICITY_UPLOAD');

  const fPage = await (await browser.newContext()).newPage();
  await login(fPage, 'factory@shams.local');
  await open(fPage, `#task/${id}`);
  await expect(fPage.getByTestId('rejection-reason')).toContainText('الرسم الهندسي غير موقع');
  await fPage.getByTestId('upload-correctionProofFile').setInputFiles(pdfFile('signed-drawing.pdf'));
  await expect(fPage.getByText('signed-drawing.pdf')).toBeVisible();
  await fPage.getByTestId('task-submit').click();
  await fPage.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('ELECTRICITY_REVIEW');

  // nothing is overdue yet, so PMU has no reminder button
  const pmuPage = await (await browser.newContext()).newPage();
  await login(pmuPage, 'pmu@shams.local');
  await open(pmuPage, `#application/${id}`);
  await expect(pmuPage.getByTestId('remind-responsible')).toHaveCount(0);
  await closeOpenApplication(factory);
});

test('D12 / D17: an overdue application is flagged and PMU reminds the late party, from the application and from its dashboard', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-OC3-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);
  await makeOverdue(id);

  await login(page, 'pmu@shams.local');
  await open(page, `#application/${id}`);
  await expect(page.locator('.page-head .overdue-flag')).toContainText('متأخر');
  await page.getByTestId('remind-responsible').click();
  await expect(page.getByText('أُرسل التنبيه للجهة المتأخرة.')).toBeVisible();
  await page.getByTestId('remind-responsible').click();                             // once a day per stage
  await expect(page.getByText('أُرسل تنبيه لهذه المرحلة اليوم بالفعل.')).toBeVisible();

  await page.goto('/#workspace/pmu?i=shams&tab=overdue');
  await page.getByTestId('remind-overdue').click();
  await expect(page.getByTestId('remind-result')).toContainText('نُبّهوا اليوم بالفعل');
  await closeOpenApplication(factory);
});
