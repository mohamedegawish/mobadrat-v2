// Shams El-Senaa journeys on the platform — ported from the standalone app's e2e (shams_elsena3a/e2e/tests/helpers.ts).
// What changed with the platform (intentionally): sign-in, e-mail verification and password reset are the platform's
// screens (#login, #verify-email/…); the initiative lives under #i/shams/…; its API under /api/v1/i/shams; one demo
// password for every seeded account; and a factory not approved yet can sign in to the platform (its account serves every
// initiative) while Shams itself stays locked («قيد المراجعة») — the old app refused the sign-in itself.
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { apiToken, latestMailFor, login, mailMatching, MAIL_DIR, PASSWORD, pdfFile, submitPlatformLogin } from '../support/platform';
export { apiToken, latestMailFor, login, mailMatching, MAIL_DIR, PASSWORD, pdfFile };
/** Screens that are the platform's (everything else the old specs open is a Shams screen: #apply, #notifications, #admin-…). */
const PLATFORM_ROUTES = /^#(login|hub|initiatives|initiative\/|verify-email|reset-password|forgot-password)\b/;

export async function asRole(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  return page;
}

export async function confirm(page: Page) {
  await page.getByTestId('confirm-action').click();
}

/** يفتح مسار hash لشاشة في المبادرة (#view → #i/shams/view) ويعيد التحميل (نفس الـhash لا يطلق hashchange). */
export async function open(page: Page, hash: string) {
  const target = PLATFORM_ROUTES.test(hash) || hash.startsWith('#i/') ? hash : `#i/shams/${hash.replace(/^#/, '')}`;
  await page.goto(`/${target}`);
  await page.reload();
}

export interface FactoryReg { companyName: string; contactName: string; email: string; mobile: string; password: string; registryNumber?: string }

/**
 * صفحة التسجيل في المبادرة: كل نموذج التسجيل على خطوات (البيانات العامة ← مسؤول الاتصال وبيانات الدخول ← أوراق الشركة ←
 * البيانات الهندسية) مع المستندات، ثم «إنشاء الحساب وإرسال المستندات» من خطوة المراجعة.
 */
export async function registerViaPage(page: Page, a: FactoryReg) {
  await page.goto('/#i/shams/register');
  await page.locator('#f-companyName').fill(a.companyName);
  await page.locator('#f-governorate').selectOption('sharqia');
  await page.locator('#f-industrialZone').selectOption('10th-ramadan');
  await page.locator('#f-address').fill('المنطقة الصناعية الثالثة');
  await page.locator('#f-phone1').fill('0221234567');
  await page.getByTestId('reg-step-contact').click();
  await page.locator('#f-contactName').fill(a.contactName);
  await page.locator('#f-contactTitle').fill('مدير المصنع');
  await page.locator('#f-contactMobile').fill(a.mobile);
  await page.locator('#f-contactEmail').fill(a.email);
  await page.locator('#regPassword').fill(a.password);
  await page.locator('#confirm').fill(a.password);
  await page.getByTestId('reg-step-company').click();
  await page.locator('#f-commercialRegisterNumber').fill('CR-555');
  await page.locator('#f-industrialRegistryNumber').fill(a.registryNumber ?? `IND-E2E-${Date.now() % 1000000}`);
  await page.locator('#f-taxNumber').fill('111-222-333');
  for (const key of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile']) {
    await page.getByTestId(`upload-${key}`).setInputFiles(pdfFile(`${key}.pdf`));
    await expect(page.getByTestId(`doc-${key}`)).toContainText(`${key}.pdf`);
  }
  await page.getByTestId('reg-step-engineering').click();
  await page.getByTestId('roof-add').click();
  await page.getByTestId('roof-name-0').fill('السطح الرئيسي');
  await page.getByTestId('roof-area-0').fill('1500');
  await page.locator('#f-contractedCapacity').fill('1000');
  await page.locator('#f-capacityUnit').selectOption('kVA');
  await page.locator('#f-peakLoad').fill('800');
  await page.locator('#f-loadUnit').selectOption('kW');
  await page.locator('#f-ownershipType').selectOption('owned');
  await page.locator('#f-ownershipExpiresAt').fill('2045-12-31');
  for (const i of [1, 2]) {
    await page.getByTestId('upload-electricityBills').setInputFiles(pdfFile(`bill-${i}.pdf`));
    await expect(page.getByTestId('docs-electricityBills')).toContainText(`bill-${i}.pdf`);
  }
  await page.getByTestId('upload-ownershipProofFile').setInputFiles(pdfFile('ownership.pdf'));
  await expect(page.getByTestId('doc-ownershipProofFile')).toContainText('ownership.pdf');
  await page.getByTestId('reg-step-review').click();
  await expect(page.getByTestId('review-complete')).toBeVisible();
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-done')).toBeVisible();
}

/** رابط التفعيل من البريد (صفحة المنصة): يُرسل طلب التسجيل لمراجعة IMC تلقائيًا. */
export async function activate(page: Page, email: string) {
  const token = /#verify-email\/([a-f0-9]{64})/.exec(await latestMailFor(email))?.[1];
  expect(token, 'activation link in the email').toBeTruthy();
  await page.goto(`/#verify-email/${token}`);
  await expect(page.getByTestId('verify-ok')).toHaveAttribute('data-under-review', '1');
}

/** دخول مرفوض برسالة السيرفر (البريد غير مفعّل): تبقى صفحة الدخول. */
export async function expectLoginRefused(page: Page, email: string, password: string, text: RegExp) {
  await submitPlatformLogin(page, email, password);
  await expect(page.locator('.pf-alert.err').first()).toContainText(text);
  await expect(page).toHaveURL(/#login$/);
}

/**
 * مصنع لم يُقبل بعد (قيد المراجعة / مرفوض): يدخل المنصة لكن «شمس الصناعة» مقفلة — صفحة «مبادراتي» تعرض الرسالة بدون
 * زر الدخول للوحة المبادرة، وأي شاشة أو API في المبادرة يُرفض (كان التطبيق القديم يرفض الدخول نفسه بنفس الرسالة).
 */
export async function expectShamsLocked(page: Page, email: string, password: string, text: RegExp) {
  await login(page, email, password);
  await expect(page).toHaveURL(/#hub/);
  const card = page.locator('.pf-hub-card', { hasText: 'شمس الصناعة' });
  await expect(card.locator('.pf-alert').first()).toContainText(text);
  await expect(card.getByText('ادخل لوحة المبادرة')).toHaveCount(0);
  await page.goto('/#i/shams/factory-dashboard');
  await expect(page).toHaveURL(/#hub/);
  const token = await apiToken(page.request, email, password);
  const r = await page.request.get('/api/v1/i/shams/applications', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(403);
}

// ── API مباشر (لخطوات تمهيدية لا تختبرها الرحلة نفسها) ──

export async function apiFindApplication(request: APIRequestContext, token: string, companyName: string): Promise<string> {
  const r = await request.get(`/api/v1/i/shams/applications?q=${encodeURIComponent(companyName)}`, { headers: { Authorization: `Bearer ${token}` } });
  const items = (await r.json()).data.items as Array<{ id: string }>;
  expect(items.length, `application of ${companyName}`).toBeGreaterThan(0);
  return items[0].id;
}

export async function apiAct(request: APIRequestContext, token: string, appId: string, action: string, body: Record<string, unknown> = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  const app = (await (await request.get(`/api/v1/i/shams/applications/${appId}`, { headers })).json()).data;
  const r = await request.post(`/api/v1/i/shams/applications/${appId}/actions/${action}`, { headers, data: { expectedVersion: app.version, ...body } });
  expect(r.status(), `${action}: ${await r.text()}`).toBe(200);
}

/** مصنع جديد مقبول: تسجيل كامل من الصفحة + تفعيل + قبول IMC (API) + دخول. */
export async function registerApprovedFactory(page: Page, request: APIRequestContext, a: FactoryReg): Promise<string> {
  await registerViaPage(page, a);
  await activate(page, a.email);
  const imc = await apiToken(request, 'imc1@shams.local');
  const appId = await apiFindApplication(request, imc, a.companyName);
  await apiAct(request, imc, appId, 'accept');
  await login(page, a.email, a.password);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  return appId;
}
