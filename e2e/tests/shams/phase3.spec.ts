// المرحلة 3: دليل مقدمي الخدمة — ENCPC تضيف مقدمًا بشعار وتفعّله، PMU تعتمده (★)، والمصنع يراه بشعاره وتفاصيله ويختاره.
import { test, expect } from '@playwright/test';
import { login, open } from './helpers';
import { act, apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

// PNG 1×1 صالح
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('ENCPC adds a provider with a logo and activates it; PMU approves; the factory sees logo + details and selects it', async ({ browser, request }) => {
  const name = `مقدم خدمة E2E ${Date.now() % 100000}`;
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const appId = await seedCompleteDraft(factory, `IND-E2E-PRV-${Date.now() % 100000}`);
  expect((await submitApplication(factory, appId)).status).toBe(200);
  const imc = await apiLogin(request, 'imc1@shams.local');
  const encpcApi = await apiLogin(request, 'encpc@shams.local');
  expect((await act(imc, appId, 'accept')).status).toBe(200);
  expect((await act(encpcApi, appId, 'compliant')).status).toBe(200);

  // ── ENCPC: إدارة مقدمي الخدمة ──
  const encpc = await (await browser.newContext()).newPage();
  await login(encpc, 'encpc@shams.local');
  await open(encpc, '#providers');
  await expect(encpc.getByRole('button', { name: 'إدارة مقدمي الخدمة' })).toBeVisible();   // عنوان القائمة الجانبية لـENCPC
  await encpc.getByTestId('add-provider').click();
  await expect(encpc.getByTestId('provider-save')).toBeDisabled();                      // الاسم إجباري
  await encpc.getByTestId('sp-nameAr').fill(name);
  await encpc.getByTestId('sp-description').fill('تركيب محطات الطاقة الشمسية للمصانع — خبرة عشر سنوات');
  await encpc.getByTestId('sp-website').fill('e2e-provider.example');
  await encpc.getByTestId('logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await encpc.getByTestId('provider-save').click();
  await expect(encpc.getByTestId('provider-save')).toHaveCount(0);
  const row = encpc.locator('[data-testid^="provider-row-"]', { hasText: name });
  await expect(row).toContainText('غير مفعّل');
  await expect(row.getByTestId('provider-logo')).toBeVisible();                           // الشعار محفوظ ويُعرض
  // المصنع لا يراه قبل التفعيل والاعتماد
  const fApi = await apiLogin(request, 'factory@shams.local');
  expect((await fApi.get('/service-providers')).items.some((p: any) => p.nameAr === name)).toBe(false);

  await row.locator('[data-testid^="activate-"]').click();
  await encpc.getByTestId('confirm-action').click();
  await expect(row).toContainText('بانتظار اعتماد PMU');
  expect((await fApi.get('/service-providers')).items.some((p: any) => p.nameAr === name)).toBe(false);

  // ── PMU تعتمد ──
  const pmu = await (await browser.newContext()).newPage();
  await login(pmu, 'pmu@shams.local');
  await open(pmu, '#providers');
  await expect(pmu.getByTestId('add-provider')).toHaveCount(0);                           // PMU لا تضيف ولا تعدّل
  const pmuRow = pmu.locator('[data-testid^="provider-row-"]', { hasText: name });
  await expect(pmuRow.locator('[data-testid^="edit-"]')).toHaveCount(0);
  await pmuRow.locator('[data-testid^="approve-"]').click();
  await pmu.getByTestId('confirm-action').click();
  await expect(pmuRow).toContainText('ظاهر للمصانع');

  // ── المصنع: صفحة الاختيار داخل الحساب (نفس وجهة رابط البريد) ──
  const fPage = await (await browser.newContext()).newPage();
  await login(fPage, 'factory@shams.local');
  await open(fPage, `#task/${appId}`);
  const card = fPage.locator('label.doc-item', { hasText: name });
  await expect(card).toContainText('تركيب محطات الطاقة الشمسية للمصانع');
  await expect(card).toContainText('e2e-provider.example');
  await expect(card.getByTestId('provider-logo')).toBeVisible();                          // الشعار يظهر للمصنع
  await expect(card).not.toContainText('@');                                              // لا بيانات اتصال
  await card.locator('input[type=radio]').check();
  await fPage.getByTestId('select-provider').click();
  await fPage.getByTestId('confirm-action').click();
  await expect.poll(async () => (await fApi.get(`/applications/${appId}`)).state).toBe('OFFER_UPLOAD');
  expect((await fApi.get(`/applications/${appId}`)).provider.nameAr).toBe(name);

  // ── ENCPC تلغي التفعيل: يختفي عن المصانع ──
  await row.locator('[data-testid^="deactivate-"]').click();
  await expect(encpc.getByText('الطلبات التي اختارته')).toBeVisible();                    // تحذير الأثر على الطلبات
  await encpc.getByTestId('confirm-action').click();
  await expect(row).toContainText('غير مفعّل');
  expect((await fApi.get('/service-providers')).items.some((p: any) => p.nameAr === name)).toBe(false);
  // الطلب بعد الاختيار (قبل إرسال العرض): لا انتقال، وتظهر للمصنع رسالة إعادة الاختيار
  await open(fPage, `#task/${appId}`);
  await expect(fPage.getByTestId('provider-suspended')).toBeVisible();
});

test('a factory and other roles cannot manage the directory: the page is restricted and the API refuses', async ({ browser, request }) => {
  const f = await (await browser.newContext()).newPage();
  await login(f, 'factory2@shams.local');
  await open(f, '#providers');
  await expect(f.getByText('غير متاحة لدورك')).toBeVisible();
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin@shams.local');
  await open(admin, '#providers');
  await expect(admin.getByText('غير متاحة لدورك')).toBeVisible();
  const s = await apiLogin(request, 'factory2@shams.local');
  expect((await s.post('/service-providers', { nameAr: 'محاولة مصنع' })).status).toBe(403);
});

test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});
