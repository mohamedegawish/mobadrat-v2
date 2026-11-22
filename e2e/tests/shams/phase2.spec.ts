// المرحلة 2: الانسحاب من لوحة المصنع بسبب وإقرار (G5)، ونزاع رقم السجل: اعتراض المصنع بمستند ثم قرار PMU (G4).
import { test, expect } from '@playwright/test';
import { login, open, pdfFile } from './helpers';
import { apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

test('G5: the factory withdraws from its dashboard — reason and explicit acknowledgement are required, the application closes', async ({ page, request }) => {
  const s = await apiLogin(request, 'factory2@shams.local');
  await closeOpenApplication(s);
  const id = await seedCompleteDraft(s, `IND-E2E-WD-${Date.now() % 100000}`);

  await login(page, 'factory2@shams.local');
  await open(page, '#factory-dashboard');
  await page.getByTestId('withdraw-open').click();
  const confirmBtn = page.getByTestId('withdraw-confirm');
  await expect(confirmBtn).toBeDisabled();
  await page.getByTestId('withdraw-reason').fill('تغيرت خطة المصنع');
  await expect(confirmBtn).toBeDisabled();            // لا يكفي السبب: يلزم الإقرار
  await page.getByTestId('withdraw-ack').check();
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  await expect(page.getByTestId('withdraw-confirm')).toHaveCount(0);
  await expect(page.getByTestId('withdraw-open')).toHaveCount(0);
  const app = await s.get(`/applications/${id}`);
  expect(app.state).toBe('WITHDRAWN');
  expect(app.transitions.at(-1).reason).toBe('تغيرت خطة المصنع');
  // صفحة التفاصيل للمصنع لا تعرض أزرار مهام ناقصة المدخلات
  await open(page, `#application/${id}`);
  await expect(page.getByTestId('action-submit')).toHaveCount(0);
});

test('G4: a blocked factory objects with a document from the wizard; PMU reviews the dispute history and accepts', async ({ page, browser, request }) => {
  const number = `IND-E2E-DSP-${Date.now() % 100000}`;
  const holder = await apiLogin(request, 'factory@shams.local');
  const other = await apiLogin(request, 'factory2@shams.local');
  await closeOpenApplication(holder);
  await closeOpenApplication(other);
  const holderApp = await seedCompleteDraft(holder, number);
  expect((await submitApplication(holder, holderApp)).status).toBe(200);
  const draft = await seedCompleteDraft(other, number);

  // المصنع الثاني يحاول الإرسال من المعالج → يُرفض ويظهر زر الاعتراض
  await login(page, 'factory2@shams.local');
  await open(page, `#apply/${draft}`);
  for (let i = 0; i < 4; i++) await page.getByTestId('wizard-next').click();   // إلى خطوة المراجعة والإرسال
  await expect(page.getByTestId('missing-list')).toHaveCount(0);
  await page.getByTestId('wizard-submit').click();
  await page.getByTestId('confirm-action').click();
  await page.getByTestId('open-objection').click();
  await expect(page.getByTestId('objection-send')).toBeDisabled();
  await page.getByTestId('objection-file').setInputFiles(pdfFile('registry-proof.pdf'));
  await expect(page.getByTestId('objection-send')).toBeEnabled();
  await page.getByTestId('objection-send').click();
  await expect(page.getByTestId('objection-send')).toHaveCount(0);
  const mine = (await other.get('/registry-objections')).items;
  expect(mine).toHaveLength(1);
  expect(mine[0].status).toBe('pending');

  // PMU: يفتح الموافقات، يرى النزاع وتاريخه، ويقبل الاعتراض بسبب ومرجع
  const pmu = await browser.newContext();
  const p = await pmu.newPage();
  await login(p, 'pmu@shams.local');
  await open(p, '#approvals');
  const panel = p.getByTestId('disputes-panel');
  await expect(panel).toContainText(number);
  await panel.getByRole('button', { name: 'التاريخ' }).first().click();
  await expect(panel.getByText('محاولة تسجيل من')).toBeVisible();
  await expect(panel.getByText('اعتراض من')).toBeVisible();
  await panel.getByTestId(`accept-obj-${mine[0].id}`).click();
  const confirmDecision = p.getByTestId('decision-confirm');
  await expect(confirmDecision).toBeDisabled();       // السبب والمرجع إجباريان
  await p.getByTestId('decision-reference').fill('PMU-E2E-1');
  await p.getByTestId('decision-reason').fill('ثبت التفويض بالمستند الرسمي المرفق');
  await confirmDecision.click();
  await expect(p.getByTestId('decision-confirm')).toHaveCount(0);

  const after = (await other.get('/registry-objections')).items[0];
  expect(after.status).toBe('accepted');
  expect(after.decisionReference).toBe('PMU-E2E-1');
  await pmu.close();
});

// الاختبارات اللاحقة (مثل mobile.spec) تفترض أن مصنعي التجربة بلا طلب مفتوح: نترك الحال كما وجدناها.
test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});
