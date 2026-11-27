// المرحلة 7: مسارات القرار عبر الواجهة التي لم تكن مغطاة — رفض IMC، عدم مطابقة ENCPC وإعادة التقديم، حلقة تعديل العرض الفني،
// الأدمن بلا أي قرار، وموافقة PMU على استرداد حساب مصنع (ثم إلغائه) مع بقاء التاريخ.
import { test, expect } from '@playwright/test';
import { login, open, pdfFile } from './helpers';
import { act, apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

const uniq = () => `${Date.now() % 1_000_000}`;

test('IMC rejects through the UI: a reason code and reason are mandatory, a confirmation is required, and the decision is final', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-REJ-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);

  await login(page, 'imc1@shams.local');
  await open(page, `#application/${id}`);
  await page.getByTestId('action-reject').click();
  const submit = page.getByTestId('decision-submit');
  await expect(submit).toBeDisabled();                                           // بلا سبب
  await page.getByTestId('reject-reason-code').selectOption('other');
  await expect(submit).toBeDisabled();                                           // الكود وحده لا يكفي
  await page.getByTestId('decision-reason').fill('مستندات الملكية غير سارية');
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.getByTestId('confirm-action').click();

  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('REJECTED');
  const app = await factory.get(`/applications/${id}`);
  expect(app.transitions.at(-1).reason).toBe('مستندات الملكية غير سارية');
  // نهائي: لا قرارات متاحة لأحد بعده، والمصنع يستطيع البدء بطلب جديد
  await expect(page.getByTestId('decision-panel')).toHaveCount(0);
  expect((await act(factory, id, 'withdraw', { reason: 'محاولة بعد الرفض' })).status).toBe(409);
  expect((await factory.get('/factory/profile')).canStartNew).toBe(true);
});

test('ENCPC rejects technically (no final rejection); the factory attaches proof and the file returns directly to ENCPC', async ({ page, browser, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const imc = await apiLogin(request, 'imc1@shams.local');
  const id = await seedCompleteDraft(factory, `IND-E2E-ENC-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);
  expect((await act(imc, id, 'accept')).status).toBe(200);

  await login(page, 'encpc@shams.local');
  await open(page, `#application/${id}`);
  await expect(page.getByTestId('action-reject')).toHaveCount(0);                 // ENCPC لا ترفض نهائيًا
  await page.getByTestId('action-non_compliant').click();
  await expect(page.getByTestId('def-field-0')).toHaveCount(0);                   // D13: a reason, not a field list
  await expect(page.getByTestId('decision-submit')).toBeDisabled();
  await page.getByTestId('decision-reason').fill('قيمة أقصى حمل لا تطابق فواتير الكهرباء');
  await page.getByTestId('decision-submit').click();
  await expect(page.getByTestId('returns-to-factory')).toBeVisible();
  await page.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('ENCPC_CORRECTION');

  const fPage = await (await browser.newContext()).newPage();
  await login(fPage, 'factory@shams.local');
  await open(fPage, `#task/${id}`);
  await expect(fPage.getByTestId('rejection-reason')).toContainText('أقصى حمل');
  await expect(fPage.getByTestId('task-submit')).toBeDisabled();                  // proof required
  await fPage.getByTestId('upload-correctionProofFile').setInputFiles(pdfFile('proof.pdf'));
  await expect(fPage.getByText('proof.pdf')).toBeVisible();
  await fPage.getByTestId('proof-note').fill('أرفقنا حساب الأحمال المعدل');
  await fPage.getByTestId('task-submit').click();
  await fPage.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('ENCPC_REVIEW'); // عودة مباشرة لنفس المراجع

  await open(page, `#application/${id}`);
  await expect(page.getByTestId('stage-files-correctionProofFile')).toContainText('proof.pdf');
  await expect(page.getByTestId('stage-files-correctionProofFile')).toContainText('أرفقنا حساب الأحمال المعدل');
  await closeOpenApplication(factory);
});

test('PMU asks for a revised technical offer through the UI; the factory resubmits a new version and every offer version is kept', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const imc = await apiLogin(request, 'imc1@shams.local');
  const encpc = await apiLogin(request, 'encpc@shams.local');
  const id = await seedCompleteDraft(factory, `IND-E2E-OFR-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);
  expect((await act(imc, id, 'accept')).status).toBe(200);
  expect((await act(encpc, id, 'compliant')).status).toBe(200);
  expect(await factory.upload(`/applications/${id}/documents`, 'technicalOfferFile', 'offer-v1.pdf')).toBe(201);
  expect((await act(factory, id, 'submit_offer')).status).toBe(200);

  await login(page, 'pmu@shams.local');
  await open(page, `#application/${id}`);
  await page.getByTestId('action-request_correction').click();
  const submit = page.getByTestId('decision-submit');
  await expect(submit).toBeDisabled();                                            // السبب إجباري
  await page.getByTestId('decision-reason').fill('السعر غير مفصل بنودًا');
  await submit.click();
  await expect(page.getByTestId('returns-to-factory')).toBeVisible();
  await page.getByTestId('confirm-action').click();
  await expect.poll(async () => (await factory.get(`/applications/${id}`)).state).toBe('OFFER_CORRECTION');

  // لا إعادة إرسال بلا نسخة جديدة من العرض
  expect((await act(factory, id, 'resubmit')).status).toBe(422);
  expect(await factory.upload(`/applications/${id}/documents`, 'technicalOfferFile', 'offer-v2.pdf')).toBe(201);
  expect((await act(factory, id, 'resubmit')).status).toBe(200);
  const view = await factory.get(`/applications/${id}`);
  expect(view.state).toBe('OFFER_REVIEW');                                        // يعود إلى PMU
  const offers = view.documents.filter((d: any) => d.kind === 'technicalOfferFile');
  expect(offers.length).toBeGreaterThanOrEqual(2);                                 // النسخة الأولى لم تُستبدل بصمت
  expect(new Set(offers.map((d: any) => d.version)).size).toBe(offers.length);
  await closeOpenApplication(factory);
});

test('the system administrator sees an application as metadata only and has no decision controls; the API refuses decisions too', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory2@shams.local');
  await closeOpenApplication(factory);
  const id = await seedCompleteDraft(factory, `IND-E2E-ADM-${uniq()}`);
  expect((await submitApplication(factory, id)).status).toBe(200);

  await login(page, 'admin@shams.local');
  await open(page, `#application/${id}`);
  await expect(page.getByTestId('metadata-only')).toBeVisible();
  await expect(page.getByTestId('decision-panel')).toHaveCount(0);
  for (const a of ['accept', 'reject', 'request_correction', 'withdraw']) await expect(page.getByTestId(`action-${a}`)).toHaveCount(0);
  const admin = await apiLogin(request, 'admin@shams.local');
  const v = (await factory.get(`/applications/${id}`)).version;
  for (const action of ['accept', 'reject', 'request_correction']) {
    const r = await admin.post(`/applications/${id}/actions/${action}`, { expectedVersion: v, reason: 'محاولة', deficiencies: [{ field: 'address', note: 'x' }] });
    expect([403, 404]).toContain(r.status);
  }
  expect((await factory.get(`/applications/${id}`)).state).toBe('IMC_REVIEW');
  await closeOpenApplication(factory);
});

test('account recovery: the admin files it, only PMU approves (cooling window starts) and can cancel it; the admin screen has no approve button', async ({ browser, request }) => {
  const admin = await apiLogin(request, 'admin@shams.local');
  const owner = await apiLogin(request, 'factory2@shams.local');
  const userId = (await (await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${owner.token}` } })).json()).data.user.id as string;
  const filed = await request.post('/api/v1/i/shams/recovery-requests', {
    headers: { Authorization: `Bearer ${admin.token}` },
    multipart: { userId, newEmail: `recovered.${uniq()}@factory.test`, reason: 'فقد المالك الوصول لبريده الإلكتروني', requestReference: `خطاب ${uniq()}`, file: pdfFile('letter.pdf') },
  });
  expect(filed.status()).toBe(201);
  const rec = (await filed.json()).data as { id: string; companyName: string };

  // شاشة الأدمن: يرى الطلب معلقًا ولا يملك موافقة
  const adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, 'admin@shams.local');
  await open(adminPage, '#admin-accounts');
  await expect(adminPage.getByTestId('pending-panel')).toContainText('بانتظار موافقة وحدة إدارة المبادرة');
  await expect(adminPage.getByTestId(`approve-recovery-${rec.id}`)).toHaveCount(0);

  // PMU توافق ثم تلغي
  const pmu = await (await browser.newContext()).newPage();
  await login(pmu, 'pmu@shams.local');
  await open(pmu, '#approvals');
  await pmu.getByTestId(`approve-recovery-${rec.id}`).click();
  await pmu.getByTestId('confirm-action').click();
  await expect(pmu.getByText('في مهلة الانتظار').first()).toBeVisible();
  const pmuApi = await apiLogin(request, 'pmu@shams.local');
  const cooling = ((await pmuApi.get('/recovery-requests')).items as any[]).find((r) => r.id === rec.id);
  expect(cooling.status).toBe('cooling');
  const hours = (Date.parse(cooling.coolingEndsAt) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(47.5);
  expect(hours).toBeLessThanOrEqual(48.01);

  await pmu.getByRole('button', { name: 'إلغاء الطلب' }).first().click();
  await expect(pmu.getByTestId('reason-confirm')).toBeDisabled();                  // السبب إجباري
  await pmu.locator('#reason-text').fill('أكّد المالك أنه لم يطلب النقل');
  await pmu.getByTestId('reason-confirm').click();
  await expect.poll(async () => (((await pmuApi.get('/recovery-requests')).items as any[]).find((r) => r.id === rec.id)).status).toBe('cancelled');
  // البريد الحالي لم يتغير
  expect((await owner.get('/auth/me')).user.email).toBe('factory2@shams.local');
});

test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});

test('L5: hash values that are JavaScript prototype keys do not crash the app (they fall back to the home page)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    await page.goto(`/#i/shams/${key}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();          // صفحة المبادرة على المنصة تظهر
    await expect(page.getByTestId('initiative-apply').first()).toBeVisible();
  }
  expect(errors, errors.join(' | ')).toEqual([]);
  // نفس الشيء بعد تسجيل الدخول: مسار مجهول لا يكسر الجلسة
  await login(page, 'factory2@shams.local');
  await page.goto('/#i/shams/constructor');
  await page.reload();
  await expect(page.getByTestId('bell')).toBeVisible();
  expect(errors, errors.join(' | ')).toEqual([]);
});
