// Workflow audit (docs/review/workflow-audit): the confirmed business decisions as the factory sees them.
// G-01 bank chosen only after PMU accepts the electricity approval; G-02 no bank account/step; G-03 contract evidence;
// G-09 closed applications stay in history, the result card stays, a new application can start, no contradictory message.
// Earlier stages are seeded through the API (each has its own UI spec); every decision under test is made through the UI.
import { test, expect, type Page } from '@playwright/test';
import { login, open, confirm, pdfFile } from './helpers';
import { act, apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication, type ApiSession } from './seed';

const uniq = () => `${Date.now() % 1_000_000}`;
const BANK_A = 'org-bank-demo-a';
type Req = Parameters<typeof apiLogin>[0];

async function reviewers(request: Req) {
  const [imc, encpc, pmu] = await Promise.all(['imc1@shams.local', 'encpc@shams.local', 'pmu@shams.local'].map((e) => apiLogin(request, e)));
  return { imc, encpc, pmu };
}
const ok = (r: { status: number; json: unknown }, s: string) => { if (r.status !== 200) throw new Error(`${s}: ${r.status} ${JSON.stringify(r.json)}`); };

/** Seeds an application up to the electricity upload (offer accepted). */
async function toElectricityUpload(request: Req, factory: ApiSession, tag: string): Promise<string> {
  const { imc, encpc, pmu } = await reviewers(request);
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-WA-${tag}-${uniq()}`);
  ok(await submitApplication(factory, id), 'submit');
  ok(await act(imc, id, 'accept'), 'imc');
  ok(await act(encpc, id, 'compliant'), 'encpc');
  ok(await act(factory, id, 'select_provider', { providerId: 'sp-demo-1' }), 'provider');
  if ((await factory.upload(`/applications/${id}/documents`, 'technicalOfferFile', 'offer.pdf')) !== 201) throw new Error('offer');
  ok(await act(factory, id, 'submit_offer'), 'offer submit');
  ok(await act(pmu, id, 'accept'), 'pmu offer');
  return id;
}

/** Seeds up to the contract stage with the bank chosen (G-01 order: electricity → PMU acceptance → bank). */
async function toContractOutcome(request: Req, factory: ApiSession, tag: string): Promise<string> {
  const { pmu } = await reviewers(request);
  const id = await toElectricityUpload(request, factory, tag);
  if ((await factory.upload(`/applications/${id}/documents`, 'electricityApprovalFile', 'approval.pdf')) !== 201) throw new Error('approval');
  ok(await act(factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع (اختبار)' }), 'electricity');
  ok(await act(pmu, id, 'accept'), 'pmu electricity');
  ok(await act(factory, id, 'select_bank', { bankOrgId: BANK_A }), 'bank');
  return id;
}

async function expectStageIcon(page: Page, cls: 'done' | 'failed') {
  const last = page.locator('.stage-track').first().locator('.stage-chip').last();
  await expect(last).toHaveClass(new RegExp(`\\b${cls}\\b`));
  await expect(last.locator('svg')).toHaveCount(1); // ✓ or ✗ instead of the step number
}

test('G-01: the electricity form has no bank; the bank choice appears only after PMU accepts the approval, once', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const { pmu } = await reviewers(request);
  const id = await toElectricityUpload(request, factory, 'BANK');

  await login(page, 'factory@shams.local');
  await open(page, `#task/${id}`);
  await expect(page.locator('#distributionCompany')).toBeVisible();
  await expect(page.locator('#bankOrgId')).toHaveCount(0);                          // no bank in the electricity submission
  await expect(page.getByTestId('bank-step')).toHaveCount(0);
  await page.getByTestId('upload-electricityApprovalFile').setInputFiles(pdfFile('approval.pdf'));
  await expect(page.getByText('approval.pdf')).toBeVisible();
  await page.locator('#distributionCompany').fill('شركة توزيع (اختبار)');
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  // under PMU review: nothing to do, still no bank choice
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('bank-step')).toHaveCount(0);
  await expect(page.locator('#bankOrgId')).toHaveCount(0);

  ok(await act(pmu, id, 'accept'), 'pmu accepts electricity');
  await open(page, '#factory-dashboard');
  await expect(page.getByTestId('current-task')).toContainText('اختر مسار التعاقد');
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('contract-path-step')).toBeVisible();
  await expect(page.getByTestId('bank-step')).toHaveCount(0);                       // the path is chosen first
  await page.getByTestId('path-bank').check();
  await expect(page.getByTestId('bank-step')).toBeVisible();
  await expect(page.getByTestId('contract-step')).toHaveCount(0);                   // no outcome before the bank
  await expect(page.getByTestId('select-bank')).toBeDisabled();
  await page.getByTestId('bank-select').selectOption(BANK_A);
  await page.getByTestId('select-bank').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await expect(page.getByTestId('current-task')).toContainText('خارج المنصة');
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('bank-step')).toHaveCount(0);                       // chosen once
  await expect(page.getByTestId('contract-path-step')).toHaveCount(0);              // and the path is locked
  await expect(page.getByTestId('chosen-bank')).toContainText('بنك تجريبي (أ)');
  await page.screenshot({ path: 'test-results/evidence/ui-r2-contract-step.png', fullPage: true });
  await closeOpenApplication(factory);
});

test('G-03 + G-09: «تم التعاقد» with the evidence document → green result card, no contradictory message, history, and a new application can start', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toContractOutcome(request, factory, 'OK');

  await login(page, 'factory@shams.local');
  await open(page, `#task/${id}`);
  await page.locator('#contractDate').fill('2026-10-05');
  await page.locator('#contractAmount').fill('2500000');
  await page.locator('#contractNotes').fill('عقد تمويل الطاقة الشمسية');
  await expect(page.getByTestId('evidence-required')).toBeVisible();
  await expect(page.getByTestId('task-submit')).toBeDisabled();                     // evidence is mandatory
  await page.getByTestId('upload-contractFile').setInputFiles(pdfFile('signed-contract.pdf'));
  await expect(page.getByText('signed-contract.pdf')).toBeVisible();
  await expect(page.getByTestId('task-submit')).toBeEnabled();
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  const card = page.getByTestId('final-outcome');
  await expect(card).toHaveAttribute('data-outcome', 'CONTRACTED');
  await expect(card).toHaveClass(/is-success/);
  await expect(card.locator('.final-outcome-title')).toHaveText('تم التعاقد عن طريق البنك');   // the final card names the contracting type
  expect(await card.locator('.final-outcome-icon').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(5, 150, 105)');
  await expectStageIcon(page, 'done');
  // G-09: the result card stays; no "no open application" message under it; the next step is explicit
  await expect(page.getByText('لا يوجد طلب مفتوح حاليًا')).toHaveCount(0);
  await expect(page.getByText('تعذر تحميل البيانات')).toHaveCount(0);            // no error state under the result card either
  await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toHaveCount(0);
  await expect(page.getByTestId('new-after-close')).toBeVisible();
  await expect(page.getByRole('table').getByText((await factory.get(`/applications/${id}`)).number)).toBeVisible(); // in the history table
  await page.screenshot({ path: 'test-results/evidence/ui-r2-contracted-dashboard.png', fullPage: true });

  // the detail page carries the result and the evidence; nothing can be changed
  await page.getByTestId('final-outcome-view').click();
  await expect(page.getByTestId('final-outcome')).toContainText('2026-10-05');
  await page.getByRole('tab', { name: /المراحل اللاحقة/ }).click();
  await expect(page.getByTestId('bank-outcome')).toContainText('بنك تجريبي (أ)');
  await expect(page.getByText('signed-contract.pdf').first()).toBeVisible();
  await expect(page.getByTestId('current-task')).toHaveCount(0);
  await expect(page.getByTestId('withdraw-open')).toHaveCount(0);
  expect((await act(factory, id, 'record_no_contract', { reason: 'تغيير بعد الإغلاق' })).status).toBe(409);

  // a new application starts from the result card; the closed one stays in the history
  await open(page, '#factory-dashboard');
  await page.getByTestId('start-after-close').click();
  await expect(page).toHaveURL(/#i\/shams\/apply\//);
  const profile = await factory.get('/factory/profile');
  expect(profile.openApplicationId).not.toBeNull();
  expect(profile.applications.some((a: { id: string; state: string }) => a.id === id && a.state === 'CONTRACTED')).toBe(true);
  await closeOpenApplication(factory);
});

test('«لم يتم التعاقد» with a reason (no document) → red X result card; closed; no contradictory message', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toContractOutcome(request, factory, 'NO');

  await login(page, 'factory@shams.local');
  await open(page, `#task/${id}`);
  await page.getByTestId('mode-no-contract').click();
  await expect(page.getByTestId('upload-contractFile')).toHaveCount(0);            // no evidence asked for a failure
  await page.locator('#ncReason').fill('لم تكتمل الضمانات المطلوبة من البنك');
  await page.locator('#ncNotes').fill('تواصلنا مع فرعين');
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  const card = page.getByTestId('final-outcome');
  await expect(card).toHaveAttribute('data-outcome', 'CLOSED_NOT_CONTRACTED');
  await expect(card).toHaveClass(/is-failure/);
  await expect(card.locator('.final-outcome-title')).toHaveText('لم يتم التعاقد');
  expect(await card.locator('.final-outcome-icon').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(220, 38, 38)');
  await expect(page.getByTestId('latest-outcome').locator('.badge')).toHaveClass(/badge-rejected/);
  await expectStageIcon(page, 'failed');
  await expect(page.getByText('لا يوجد طلب مفتوح حاليًا')).toHaveCount(0);
  await expect(page.getByText('تعذر تحميل البيانات')).toHaveCount(0);            // no error state under the result card either
  await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/evidence/ui-r2-not-contracted-dashboard.png', fullPage: true });

  await page.getByTestId('final-outcome-view').click();
  await expect(page.getByTestId('final-outcome')).toContainText('لم تكتمل الضمانات المطلوبة من البنك');
  expect((await act(factory, id, 'record_contract', { contractDate: '2026-10-05', contractAmount: 10 })).status).toBe(409);
});

test('unauthorized actions are not exposed: another factory cannot open it, PMU has no decision at the bank/contract stage', async ({ page, browser, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toContractOutcome(request, factory, 'AUTH');
  await login(page, 'pmu@shams.local');
  await open(page, `#application/${id}`);
  await expect(page.getByTestId('decision-panel')).toHaveCount(0);                  // PMU may watch, not decide
  await page.getByRole('tab', { name: /المراحل اللاحقة/ }).click();
  await expect(page.getByTestId('bank-outcome')).toContainText('بنك تجريبي (أ)');   // PMU sees the chosen bank
  const other = await (await browser.newContext()).newPage();
  await login(other, 'factory2@shams.local');
  await open(other, `#application/${id}`);
  await expect(other.getByTestId('not-available')).toBeVisible();
  await open(other, `#task/${id}`);
  await expect(other.getByTestId('contract-step')).toHaveCount(0);
  await expect(other.getByTestId('upload-contractFile')).toHaveCount(0);
  await closeOpenApplication(factory);
});

test('a return for correction is labelled as such on the dashboard, not as a rejection', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const { pmu } = await reviewers(request);
  const id = await toElectricityUpload(request, factory, 'RET');
  if ((await factory.upload(`/applications/${id}/documents`, 'electricityApprovalFile', 'approval.pdf')) !== 201) throw new Error('approval');
  ok(await act(factory, id, 'submit_electricity', { distributionCompany: 'شركة' }), 'electricity');
  ok(await act(pmu, id, 'request_correction', { reason: 'الموافقة غير موقعة' }), 'return');

  await login(page, 'factory@shams.local');
  await open(page, '#factory-dashboard');
  await expect(page.getByTestId('returned-notice')).toContainText('ليس رفضًا نهائيًا');
  await expect(page.getByTestId('current-task')).toContainText('الموافقة غير موقعة');
  await expect(page.getByTestId('final-outcome')).toHaveCount(0);
  await closeOpenApplication(factory);
});
