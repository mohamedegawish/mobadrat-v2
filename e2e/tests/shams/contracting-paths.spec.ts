// Two contracting paths after PMU accepts the electricity approval — as the factory and PMU see them.
// Earlier stages are seeded through the API (each has its own UI spec); every step of the new path is done through the UI.
import { test, expect, type Page } from '@playwright/test';
import { login, open, confirm, pdfFile, asRole } from './helpers';
import { act, apiLogin, closeOpenApplication, electricityAccept, seedCompleteDraft, submitApplication, type ApiSession } from './seed';

const uniq = () => `${Date.now() % 1_000_000}`;
type Req = Parameters<typeof apiLogin>[0];
const ok = (r: { status: number; json: unknown }, s: string) => { if (r.status !== 200) throw new Error(`${s}: ${r.status} ${JSON.stringify(r.json)}`); };

/** Seeds an application up to the contracting-path choice (the ministry approved). */
async function toPathChoice(request: Req, factory: ApiSession, tag: string): Promise<string> {
  const [imc, encpc, pmu] = await Promise.all(['imc1@shams.local', 'encpc@shams.local', 'pmu@shams.local'].map((e) => apiLogin(request, e)));
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-CP-${tag}-${uniq()}`);
  ok(await submitApplication(factory, id), 'submit');
  ok(await act(imc, id, 'accept'), 'imc');
  ok(await act(encpc, id, 'compliant'), 'encpc');
  if ((await factory.upload(`/applications/${id}/documents`, 'technicalOfferFile', 'offer.pdf')) !== 201) throw new Error('offer');
  ok(await act(factory, id, 'submit_offer'), 'offer submit');
  ok(await act(pmu, id, 'accept'), 'pmu offer');
  ok(await electricityAccept(request, id), 'electricity');
  return id;
}

/** The factory chooses the distribution path and sends the approval, all through the UI. */
async function factorySendsDistributionApproval(page: Page, id: string) {
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('contract-path-step')).toBeVisible();
  await expect(page.getByTestId('path-bank')).toBeVisible();
  await expect(page.getByTestId('path-distribution')).toBeVisible();
  await page.getByTestId('path-distribution').check();
  await expect(page.getByTestId('bank-step')).toHaveCount(0);                     // only the chosen path's fields
  await page.getByTestId('select-distribution').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  await open(page, `#task/${id}`);
  await expect(page.getByTestId('distribution-step')).toBeVisible();
  await expect(page.getByTestId('contract-path-step')).toHaveCount(0);            // the path is locked
  await expect(page.locator('#bankOrgId')).toHaveCount(0);
  await expect(page.getByTestId('task-submit')).toBeDisabled();                   // the document is required
  await page.getByTestId('upload-distributionApprovalFile').setInputFiles(pdfFile('disco-v1.pdf'));
  await expect(page.getByText('disco-v1.pdf')).toBeVisible();
  await page.getByTestId('upload-distributionApprovalFile').setInputFiles(pdfFile('disco-v2.pdf'));  // re-upload keeps v1
  await expect(page.getByText('disco-v2.pdf')).toBeVisible();
  await expect(page.getByText('disco-v1.pdf')).toBeVisible();
  await page.getByTestId('distribution-note').fill('خطاب موافقة شركة التوزيع مرفق');
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
}

test('distribution path, accepted: path cards → upload/re-upload → PMU reviews the document → green contracted result naming the distribution company', async ({ page, request, browser }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toPathChoice(request, factory, 'OK');
  await login(page, 'factory@shams.local');
  await open(page, '#factory-dashboard');
  await expect(page.getByTestId('current-task')).toContainText('اختر مسار التعاقد');
  await factorySendsDistributionApproval(page, id);

  const pmu = await asRole(browser, 'pmu@shams.local');
  await open(pmu, `#application/${id}`);
  const panel = pmu.getByTestId('distribution-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('distribution-status')).toContainText('قيد مراجعة');
  await expect(panel.getByText('disco-v2.pdf')).toBeVisible();
  await expect(pmu.getByTestId('action-accept')).toBeVisible();
  await expect(pmu.getByTestId('action-reject_distribution')).toBeVisible();
  await pmu.getByTestId('action-accept').click();
  await pmu.getByTestId('decision-reason').fill('الموافقة مستوفاة');
  await pmu.getByTestId('decision-submit').click();
  await expect(pmu.getByTestId('final-decision-warning')).toContainText('تم التعاقد عن طريق شركة توزيع الكهرباء');
  await confirm(pmu);
  await expect(pmu.getByTestId('final-outcome')).toHaveAttribute('data-outcome', 'CONTRACTED');

  // the contracting path stays on the data tab; reviewers see the submitted version only (M7)
  await expect(pmu.getByTestId('contract-path-chosen')).toContainText('شركة توزيع الكهرباء');
  await pmu.getByRole('tab', { name: 'المستندات' }).click();
  await expect(pmu.getByText('disco-v2.pdf').first()).toBeVisible();
  await expect(pmu.getByText('disco-v1.pdf')).toHaveCount(0);

  await open(page, `#application/${id}`);
  const card = page.getByTestId('final-outcome');
  await expect(card).toHaveAttribute('data-outcome', 'CONTRACTED');
  await expect(card).toHaveClass(/is-success/);
  await expect(card).toContainText('تم التعاقد عن طريق شركة توزيع الكهرباء');
  await expect(card.getByTestId('final-outcome-path')).toContainText('شركة توزيع الكهرباء');
  await expect(card.getByText('disco-v2.pdf')).toBeVisible();
  const last = page.locator('.stage-track').first().locator('.stage-chip').last();
  await expect(last).toHaveClass(/\bdone\b/);
  // the factory's own documents keep every upload, including the version replaced before sending
  await page.getByRole('tab', { name: 'المستندات' }).click();
  await expect(page.getByText('disco-v1.pdf').first()).toBeVisible();
});

test('distribution path, rejected: reason required → final red X result with the reason; the factory has nothing left to do', async ({ page, request, browser }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toPathChoice(request, factory, 'NO');
  await login(page, 'factory@shams.local');
  await factorySendsDistributionApproval(page, id);

  const pmu = await asRole(browser, 'pmu@shams.local');
  await open(pmu, `#application/${id}`);
  await pmu.getByTestId('action-reject_distribution').click();
  await expect(pmu.getByTestId('decision-submit')).toBeDisabled();               // a reason is mandatory
  await pmu.getByTestId('decision-reason').fill('الموافقة منتهية الصلاحية');
  await pmu.getByTestId('decision-submit').click();
  await expect(pmu.getByTestId('final-decision-warning')).toContainText('قرار نهائي');
  await confirm(pmu);
  await expect(pmu.getByTestId('final-outcome')).toHaveAttribute('data-outcome', 'CLOSED_NOT_CONTRACTED');
  await expect(pmu.getByTestId('decision-panel')).toHaveCount(0);

  await open(page, `#application/${id}`);
  const card = page.getByTestId('final-outcome');
  await expect(card).toHaveClass(/is-failure/);
  await expect(card).toContainText('رُفضت موافقة شركة التوزيع');
  await expect(card.getByTestId('final-outcome-reason')).toContainText('الموافقة منتهية الصلاحية');
  const last = page.locator('.stage-track').first().locator('.stage-chip').last();
  await expect(last).toHaveClass(/\bfailed\b/);
  await expect(page.getByTestId('current-task')).toHaveCount(0);
  await expect(page.getByTestId('decision-panel')).toHaveCount(0);                // no withdraw / no action on a closed application
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('distribution-step')).toHaveCount(0);
  await expect(page.getByTestId('contract-path-step')).toHaveCount(0);
});

test('bank path chosen through the path cards: the distribution option disappears and the bank flow is unchanged', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toPathChoice(request, factory, 'BANK');
  await login(page, 'factory@shams.local');
  await open(page, `#task/${id}`);
  await page.getByTestId('path-bank').check();
  await expect(page.getByTestId('bank-step')).toBeVisible();
  await expect(page.getByTestId('select-distribution')).toHaveCount(0);
  await page.getByTestId('bank-select').selectOption('org-bank-demo-a');
  await page.getByTestId('select-bank').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await open(page, `#task/${id}`);
  await expect(page.getByTestId('contract-step')).toBeVisible();
  await expect(page.getByTestId('contract-path-step')).toHaveCount(0);
  await expect(page.getByTestId('upload-distributionApprovalFile')).toHaveCount(0);
  await closeOpenApplication(factory);
});

test('withdrawn on the distribution path before the decision: the panel says closed without a decision, never "under review"', async ({ request, browser }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  const id = await toPathChoice(request, factory, 'WD');
  ok(await act(factory, id, 'select_distribution_path'), 'choose the distribution path');
  if ((await factory.upload(`/applications/${id}/documents`, 'distributionApprovalFile', 'disco-wd.pdf')) !== 201) throw new Error('upload');
  ok(await act(factory, id, 'submit_distribution_approval'), 'submit');
  ok(await act(factory, id, 'withdraw', { reason: 'انسحاب قبل قرار PMU' }), 'withdraw');
  const pmu = await asRole(browser, 'pmu@shams.local');
  await open(pmu, `#application/${id}`);
  await expect(pmu.getByTestId('final-outcome')).toHaveAttribute('data-outcome', 'WITHDRAWN');
  await expect(pmu.getByTestId('decision-panel')).toHaveCount(0);
  await expect(pmu.getByTestId('distribution-status')).toContainText('أُغلق الطلب دون قرار');
  await expect(pmu.getByTestId('distribution-status')).not.toContainText('قيد مراجعة');
});
