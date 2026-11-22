// المرحلة 4: لوحات الأدوار — IMC وENCPC والبنك يهبطون على لوحتهم، وPMU ترى اللوحة في المتابعة؛ الأرقام حقيقية وتطابق القائمة.
import { test, expect } from '@playwright/test';
import { login, open } from './helpers';
import { act, apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

test('IMC lands on its dashboard; the awaiting number equals the queue it opens; correction card opens the matching filter', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const imcApi = await apiLogin(request, 'imc1@shams.local');
  const id = await seedCompleteDraft(factory, `IND-E2E-DSH-${Date.now() % 100000}`);
  expect((await submitApplication(factory, id)).status).toBe(200);

  await login(page, 'imc1@shams.local');
  await expect(page).toHaveURL(/#i\/shams\/dashboard/);
  const server = (await imcApi.get('/dashboard'));
  const headline = page.getByTestId('dash-awaiting-me');
  await expect(headline).toContainText(`(${new Intl.NumberFormat('ar-EG').format(server.awaitingMe.count)})`);
  // لا بطاقات من مراحل ليست لـIMC، ولا دليل مقدمي خدمة
  await expect(page.getByTestId('card-offer')).toHaveCount(0);
  await expect(page.getByTestId('dash-providers')).toHaveCount(0);
  // «لا شيء مختلق»: لا بند متأخر بلا مهل
  await expect(page.getByTestId('attention-overdue')).toHaveCount(0);

  // الرأس يفتح قائمة «بانتظار قراري» والصف الجديد فيها
  await headline.click();
  await expect(page).toHaveURL(/#i\/shams\/work-queue\/mine/);
  await expect(page.getByTestId('tab-mine')).toHaveClass(/active/);
  const rows = await page.getByTestId('queue-table').locator('tbody tr').count();
  expect(rows).toBe(Math.min(20, server.awaitingMe.count));

  // استيفاء ← بطاقة الاستيفاء تفتح قائمة بحالة IMC_CORRECTION
  expect((await act(imcApi, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل العنوان' }] })).status).toBe(200);
  await open(page, '#dashboard');
  const card = page.getByTestId('card-correction');
  await expect(card.getByTestId('card-count-correction')).not.toHaveText('٠');
  await card.click();
  await expect(page).toHaveURL(/#i\/shams\/work-queue\/IMC_CORRECTION/);
  await expect(page.getByTestId('tab-all')).toHaveClass(/active/);
  await expect(page.getByTestId('filter-state')).toHaveValue('IMC_CORRECTION');
  await expect(page.getByTestId('queue-table').locator('tbody tr', { hasText: 'IMC_CORRECTION' })).toHaveCount(0);   // لا تسريب لأكواد برمجية
  await expect(page.getByRole('row').filter({ hasText: 'استيفاء البيانات' }).first()).toBeVisible();

  // بطاقة بلا فلتر صادق ليست زرًا (لا زر ميت)
  await open(page, '#dashboard');
  await expect(page.getByTestId('card-accepted').locator('xpath=self::button')).toHaveCount(0);
  await expect(page.getByTestId('card-correction').locator('xpath=self::button')).toHaveCount(1);
  // الرجوع من تفاصيل الطلب يُبقي الشريط الجانبي لدور المراجع
  await open(page, `#application/${id}`);
  await expect(page.locator('.admin-sidebar')).toBeVisible();
});

test('work queue: extra filters (date range, sort, clear) and an unknown preset is ignored', async ({ page }) => {
  await login(page, 'pmu@shams.local');
  await open(page, '#work-queue/NOT_A_STATE');
  await expect(page.getByTestId('filter-state')).toHaveValue('');          // لا فلتر مختلق
  await page.getByTestId('tab-all').click();
  await expect(page.getByTestId('filter-bank')).toBeVisible();             // PMU ترى فلتر البنك
  await page.getByTestId('filter-from').fill('2999-01-01');
  await expect(page.getByTestId('queue-table')).toHaveCount(0);            // لا نتائج في المستقبل
  await page.getByTestId('filters-clear').click();
  await expect(page.getByTestId('queue-table')).toBeVisible();
  await page.getByTestId('filter-sort').selectOption('oldest');
  await expect(page.getByTestId('queue-table')).toBeVisible();
});

test('PMU sees the dashboard panels inside monitoring: stage cards, attention items and recent activity; preset links open the matching queue', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory2@shams.local');
  await closeOpenApplication(factory);
  await login(page, 'pmu@shams.local');
  await expect(page).toHaveURL(/#i\/shams\/pmu-monitor/);
  await expect(page.getByTestId('awaiting-me')).toContainText('بانتظار قرارك');    // محفوظ كما كان
  await expect(page.getByTestId('role-dashboard')).toBeVisible();
  await expect(page.getByTestId('dash-awaiting-me')).toHaveCount(0);               // بلا تكرار للرأس
  for (const key of ['offer', 'electricity', 'bank-choice', 'outcome', 'completed', 'rejected', 'closed']) await expect(page.getByTestId(`card-${key}`)).toBeVisible();
  await expect(page.getByTestId('card-bank')).toHaveCount(0);                      // G-02: لا «إحالة للبنوك» ولا دراسة بنكية
  await expect(page.getByTestId('dash-recent')).toBeVisible();
  await page.getByTestId('card-offer').click();
  await expect(page).toHaveURL(/#i\/shams\/work-queue\/OFFER_REVIEW/);
  await expect(page.getByTestId('filter-state')).toHaveValue('OFFER_REVIEW');
  await open(page, '#pmu-monitor');
  await page.getByTestId('card-closed').click();                                    // مجموعة حالات
  await expect(page).toHaveURL(/#i\/shams\/work-queue\/CLOSED_NOT_CONTRACTED-WITHDRAWN/);
  await expect(page.getByTestId('filter-state')).toHaveValue('CLOSED_NOT_CONTRACTED,WITHDRAWN');
});

test('ENCPC dashboard shows real directory counters and links to provider management; there is no bank account or bank dashboard (G-02)', async ({ page, request }) => {
  await login(page, 'encpc@shams.local');
  await expect(page).toHaveURL(/#i\/shams\/dashboard/);
  await expect(page.getByTestId('dash-providers')).toBeVisible();
  const encpcApi = await apiLogin(request, 'encpc@shams.local');
  const d = await encpcApi.get('/dashboard');
  await expect(page.getByTestId('dash-providers')).toContainText(new Intl.NumberFormat('ar-EG').format(d.providers.total));
  await page.getByTestId('open-providers').click();
  await expect(page).toHaveURL(/#i\/shams\/providers/);

  // the former demo bank accounts no longer exist and cannot sign in
  const r = await request.post('/api/v1/auth/login', { data: { email: 'bank.b@shams.local', password: 'Mobadrat@2026' } });
  expect([401, 403]).toContain(r.status());
});

test('factory and admin have no role dashboard: the page is restricted and the API refuses', async ({ browser, request }) => {
  const f = await (await browser.newContext()).newPage();
  await login(f, 'factory2@shams.local');
  await open(f, '#dashboard');
  await expect(f.getByText('غير متاحة لدورك')).toBeVisible();
  expect((await (await request.get('/api/v1/i/shams/dashboard')).status())).toBe(401);
  const adminApi = await apiLogin(request, 'admin@shams.local');
  expect((await adminApi.post('/dashboard', {})).status).toBe(404);
});

test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});
