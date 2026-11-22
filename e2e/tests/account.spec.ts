// Platform account journeys through the screens, from a brand-new person (captured e-mails, demo seed for staff):
// sign-up → activation → the empty chooser → «بياناتي»; the forgotten password; a platform account applying to Shams
// El-Senaa (facility data once, company documents reused, the wizard, IMC review, acceptance); the administration
// suspending a membership / disabling an account with immediate effect; the unified notifications; the platform on a phone.
import { test, expect, devices, type Page, type APIRequestContext } from '@playwright/test';
import { PASSWORD, apiToken, latestMailFor, login, mailMatching, pdfFile, submitPlatformLogin } from './support/platform';
import { apiAct, apiFindApplication, expectShamsLocked } from './shams/helpers';
import { apiSession, newApplicant, submittedApplication } from './sona3/helpers';

const NEW_PW = 'Platform2026x';
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The field of a form by its exact label («الاسم الكامل» / «الاسم الكامل *»), not a longer label that contains it. */
function field(page: Page, label: string) {
  return page.locator('.pf-field').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*\\*?\\s*$`) }) }).first();
}

/** Server errors and page crashes seen by the browser during a test (must stay empty). */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  return errors;
}

/** A verified platform account created through the API (for journeys that do not test the sign-up itself). */
async function apiAccount(request: APIRequestContext, tag: string, name = 'مستخدم المنصة'): Promise<string> {
  const email = `e2e.${tag}.${stamp()}@test.local`;
  const r = await request.post('/api/v1/auth/register', { data: { fullName: name, email, mobile: '01055556666', password: NEW_PW } });
  expect(r.status(), await r.text()).toBe(201);
  const token = /#verify-email\/([a-f0-9]{64})/.exec(await latestMailFor(email))?.[1];
  expect((await request.post('/api/v1/auth/verify-email', { data: { token } })).status()).toBe(200);
  return email;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page wider than the screen by ${overflow}px`).toBeLessThanOrEqual(1);
}

test('a new person: platform sign-up, unverified sign-in refused with a resend, activation, the empty chooser and «بياناتي» kept', async ({ page }) => {
  const errors = trackErrors(page);
  const email = `e2e.signup.${stamp()}@test.local`;
  await page.goto('/#register');
  await field(page, 'الاسم الكامل').locator('input').fill('سارة محمود عبد الله');
  await field(page, 'البريد الإلكتروني').locator('input').fill(email);
  await field(page, 'رقم الموبايل').locator('input').fill('01012341234');
  await field(page, 'كلمة المرور').locator('input').fill(NEW_PW);
  await field(page, 'تأكيد كلمة المرور').locator('input').fill('Different2026x');
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page.locator('.pf-field .err').first()).toBeVisible(); // passwords do not match: nothing is sent
  await field(page, 'تأكيد كلمة المرور').locator('input').fill(NEW_PW);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page.locator('.pf-alert.ok')).toContainText(email);

  // Not activated yet: a clear refusal and a new link on request.
  await submitPlatformLogin(page, email, NEW_PW);
  await expect(page.locator('.pf-alert.err').first()).toBeVisible();
  await expect(page).toHaveURL(/#login$/);
  await page.getByRole('button', { name: 'إعادة إرسال رابط التفعيل' }).click();
  await expect(page.getByText('أُرسل رابط تفعيل جديد إلى بريدك.')).toBeVisible();

  const token = /#verify-email\/([a-f0-9]{64})/.exec(await latestMailFor(email))?.[1];
  expect(token).toBeTruthy();
  await page.goto(`/#verify-email/${token}`);
  await expect(page.getByTestId('verify-ok')).toBeVisible();

  // A wrong password keeps the person on the sign-in page.
  await submitPlatformLogin(page, email, 'Wrong2026xx');
  await expect(page.locator('.pf-alert.err').first()).toBeVisible();
  await expect(page).toHaveURL(/#login$/);

  // No initiative yet → the catalog to choose one; the chooser itself shows the empty state.
  await login(page, email, NEW_PW);
  await expect(page).toHaveURL(/#initiatives$/);
  await page.goto('/#hub');
  await expect(page.getByText('لم تقدّم على أي مبادرة بعد.')).toBeVisible();

  // «بياناتي»: saved once, still there after a reload; the name came from the sign-up.
  await page.goto('/#profile');
  await expect(field(page, 'الاسم الرباعي').locator('input')).toHaveValue('سارة محمود عبد الله');
  await field(page, 'العنوان').locator('input, textarea').first().fill('12 شارع النصر، مدينة نصر');
  await page.locator('.pf-box', { hasText: 'البيانات الشخصية' }).getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByText('تم حفظ بياناتك.')).toBeVisible();
  await page.reload();
  await expect(field(page, 'العنوان').locator('input, textarea').first()).toHaveValue('12 شارع النصر، مدينة نصر');
  expect(errors).toEqual([]);
});

test('forgotten password: the link from the e-mail sets a new password once; the old one stops working; unknown addresses get the same answer', async ({ page, request }) => {
  const errors = trackErrors(page);
  const email = await apiAccount(request, 'reset');
  const answer = 'إذا كان البريد مسجلًا فستصلك رسالة لاستعادة كلمة المرور.';

  await page.goto('/#forgot-password');
  await page.locator('input[type=email]').fill(`nobody.${stamp()}@test.local`);
  await page.getByRole('button', { name: 'إرسال الرابط' }).click();
  await expect(page.getByText(answer)).toBeVisible();

  await page.reload();
  await page.locator('input[type=email]').fill(email);
  await page.getByRole('button', { name: 'إرسال الرابط' }).click();
  await expect(page.getByText(answer)).toBeVisible();
  const token = /#reset-password\/([a-f0-9]{64})/.exec(await mailMatching(email, /#reset-password\//))?.[1];
  expect(token, 'reset link in the e-mail').toBeTruthy();

  const fresh = 'Renewed2026x';
  await page.goto(`/#reset-password/${token}`);
  await field(page, 'كلمة المرور الجديدة').locator('input').fill(fresh);
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم تعيين كلمة المرور — سجّل الدخول بها الآن.')).toBeVisible();

  await submitPlatformLogin(page, email, NEW_PW);
  await expect(page.locator('.pf-alert.err').first()).toBeVisible();
  await login(page, email, fresh);
  await expect(page).toHaveURL(/#initiatives$/);

  // The same link a second time is refused.
  await page.context().clearCookies();
  await page.goto(`/#reset-password/${token}`);
  await page.reload();
  await field(page, 'كلمة المرور الجديدة').locator('input').fill('Another2026x');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.locator('.pf-alert.err').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a platform account applies to Shams El-Senaa: facility data once, documents reused, the wizard prefilled, locked under IMC review, opened on acceptance', async ({ page, request }) => {
  const errors = trackErrors(page);
  const email = await apiAccount(request, 'shams', 'م. خالد إبراهيم');
  const company = `مصنع المنصة للأجهزة ${stamp()}`;
  await login(page, email, NEW_PW);
  await page.goto('/#initiative/shams');
  await page.getByText('قدّم على المبادرة').first().click();
  await expect(page).toHaveURL(/#apply\/shams/);
  await expect(page.getByText('لا توجد منشأة في ملفك بعد')).toBeVisible();

  // The facility form is the platform's field catalog: fill every required field by its label.
  const token = await apiToken(request, email, NEW_PW);
  const req = (await (await request.get('/api/v1/me/initiatives/shams/requirements', { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  const values: Record<string, unknown> = {
    'factory.companyName': company, 'factory.governorate': 'sharqia', 'factory.industrialZone': '10th-ramadan', 'factory.address': 'المنطقة الصناعية الأولى — قطعة 7',
    'factory.phone1': '0551234567', 'factory.contactName': 'م. خالد إبراهيم', 'factory.contactTitle': 'مدير المصنع', 'factory.contactMobile': '01098765432',
    'factory.contactEmail': 'contact@platform-factory.test', 'factory.commercialRegisterNumber': 'CR-7788', 'factory.industrialRegistryNumber': `IND-PLAT-${stamp()}`,
    'factory.taxNumber': '222-333-444', 'factory.roofAreas': [{ name: 'السطح الرئيسي', area: 1200 }], 'factory.contractedCapacity': 600, 'factory.capacityUnit': 'kW',
    'factory.peakLoad': 450, 'factory.loadUnit': 'kW', 'factory.ownershipType': 'owned', 'factory.ownershipExpiresAt': '2045-06-30',
  };
  for (const f of req.fields as Array<{ key: string; scope: string; type: string; labelAr: string; required: boolean }>) {
    if (f.scope !== 'factory' || !f.required) continue;
    const v = values[f.key];
    expect(v, `a value for the required field ${f.key}`).toBeDefined();
    const box = field(page, f.labelAr);
    if (f.type === 'roofTable') {
      await box.getByRole('button', { name: /إضافة سطح/ }).click();
      await box.getByPlaceholder('اسم السطح').fill((v as Array<{ name: string }>)[0].name);
      await box.getByPlaceholder('المساحة م²').fill(String((v as Array<{ area: number }>)[0].area));
    } else if (f.type === 'select') await box.locator('select').selectOption(String(v));
    else await box.locator('input, textarea').first().fill(String(v));
  }
  await page.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(page.getByText('تم حفظ البيانات في ملفك')).toBeVisible();

  for (const d of req.documents as Array<{ kind: string; labelAr: string; required: boolean }>) {
    if (!d.required) continue;
    const row = page.locator('.pf-doc', { hasText: d.labelAr }).first();
    await row.locator('input[type=file]').setInputFiles(pdfFile(`${d.kind}.pdf`));
    await expect(row).toContainText(`${d.kind}.pdf`);
  }
  const openFile = page.getByRole('button', { name: 'فتح ملف التقديم والمتابعة' });
  await expect(openFile).toBeEnabled();
  await openFile.click();

  // The Shams wizard, prefilled from the profile, the company documents already attached; only the bills remain.
  await expect(page).toHaveURL(/#i\/shams\/apply\//);
  await expect(page.locator('#f-companyName')).toHaveValue(company);
  await expect(page.getByTestId('restricted-banner')).toBeVisible();
  for (let i = 0; i < 4 && !(await page.getByTestId('upload-electricityBills').count()); i++) await page.getByTestId('wizard-next').click();
  for (const i of [1, 2]) {
    await page.getByTestId('upload-electricityBills').setInputFiles(pdfFile(`bill-${i}.pdf`));
    await expect(page.getByTestId('docs-electricityBills')).toContainText(`bill-${i}.pdf`);
  }
  await page.getByTestId('wizard-step-review').click();
  await expect(page.getByTestId('missing-list')).toHaveCount(0);
  await page.getByTestId('wizard-submit').click();
  await page.getByTestId('confirm-action').click();
  await expect(page).toHaveURL(/#hub/);
  await expectShamsLocked(page, email, NEW_PW, /قيد مراجعة|قيد المراجعة/);

  // IMC accepts the registration → the factory is in.
  const imc = await apiToken(request, 'imc1@shams.local');
  const appId = await apiFindApplication(request, imc, company);
  await apiAct(request, imc, appId, 'accept');
  await login(page, email, NEW_PW);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await expect(page.getByTestId('current-task')).toContainText('ENCPC');

  // The facility stays in «بياناتي» for the next initiative.
  await page.goto('/#profile?tab=factories');
  await expect(page.getByRole('heading', { name: company })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the administration suspends a membership and disables an account: the open session follows at once, and both come back', async ({ page, browser, request }) => {
  const errors = trackErrors(page);
  const a = await newApplicant(request, 'suspend');
  await login(page, a.email, a.password);
  await page.goto('/#hub');
  const card = page.locator('.pf-hub-card', { hasText: 'صُنّاع المستقبل' });
  await expect(card.getByText('ادخل لوحة المبادرة')).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  const adminErrors = trackErrors(admin);
  await login(admin, 'admin@mobadrat.local', PASSWORD);
  await admin.goto('/#admin-users');
  await admin.getByPlaceholder('بحث بالاسم أو البريد').fill(a.email);
  const row = admin.locator('tr', { hasText: a.email });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'إيقاف', exact: true }).click();
  await expect(row.getByRole('button', { name: 'تفعيل', exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText('عضويتك في هذه المبادرة موقوفة.')).toBeVisible();
  await expect(card.getByText('ادخل لوحة المبادرة')).toHaveCount(0);
  const tok = await apiToken(request, a.email, a.password);
  expect((await request.get('/api/v1/i/sona3/applications', { headers: { Authorization: `Bearer ${tok}` } })).status()).toBe(403);

  await row.getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect(row.getByRole('button', { name: 'إيقاف', exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText('ادخل لوحة المبادرة')).toBeVisible();

  // Disabling the account ends the open session; signing in is refused until it is enabled again.
  await row.getByRole('button', { name: 'إيقاف الحساب' }).click();
  await expect(row.getByText('موقوف')).toBeVisible();
  await page.reload();
  await expect(page.getByText('لم تقدّم على أي مبادرة بعد.')).toHaveCount(0);
  await expect(page.locator('.pf-hub-card')).toHaveCount(0);
  await submitPlatformLogin(page, a.email, a.password);
  await expect(page.locator('.pf-alert.err').first()).toBeVisible();
  await expect(page).toHaveURL(/#login$/);

  await row.getByRole('button', { name: 'تفعيل الحساب' }).click();
  await expect(row.getByText('نشط')).toBeVisible();
  await login(page, a.email, a.password);
  expect(errors).toEqual([]);
  expect(adminErrors).toEqual([]);
});

test('unified notifications: a decision in an initiative reaches the platform bell and page, opens its screen, and is read once opened', async ({ page, request }) => {
  const errors = trackErrors(page);
  const a = await newApplicant(request, 'notify');
  const appId = await submittedApplication(request, a, Number(stamp().slice(-4)));
  const imc = await apiSession(request, 'imc@sona3.local', PASSWORD);
  const app = await imc.get(`/applications/${appId}`);
  const r = await imc.post(`/applications/${appId}/actions/request_correction`, { expectedVersion: app.version, deficiencies: [{ field: 'address', note: 'العنوان غير مكتمل' }] });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  // two notices: the submission receipt and the correction request (delivered by the background worker)
  await expect.poll(async () => (await (await request.get('/api/v1/me/notifications/unread-count', { headers: { Authorization: `Bearer ${a.s.token}` } })).json()).data?.count, { timeout: 15_000 }).toBe(2);

  await login(page, a.email, a.password);
  await page.goto('/#hub');
  const bell = page.locator('.pf-bell .pf-count');
  await expect(bell).toBeVisible();
  await expect(bell).toHaveText('2');
  const before = 2;

  await page.locator('.pf-bell').click();
  await expect(page).toHaveURL(/#notifications/);
  const item = page.locator('button.pf-box', { hasText: 'صُنّاع المستقبل' }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/#i\/sona3\//);

  // Back to the platform from the initiative's bar: the opened notification is read (one fewer), the rest on request.
  await page.getByRole('link', { name: 'مبادراتي' }).click();
  await expect(page).toHaveURL(/#hub/);
  if (before > 1) await expect(bell).toHaveText(String(before - 1));
  else await expect(bell).toHaveCount(0);
  await page.locator('.pf-bell').click();
  await expect(page).toHaveURL(/#notifications/);
  await expect(page.locator('button.pf-box').first()).toBeVisible();
  if (before > 1) await page.getByRole('button', { name: 'تعليم الكل كمقروء' }).click();
  await expect(page.getByRole('button', { name: 'تعليم الكل كمقروء' })).toHaveCount(0);
  await expect(page.locator('.pf-bell .pf-count')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('button.pf-box').first()).toBeVisible();
  await expect(page.locator('.pf-bell .pf-count')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The phone's screen, touch and user agent (the browser stays the project's Chromium).
const { defaultBrowserType: _browser, ...PHONE } = devices['Pixel 7'];
void _browser;

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the public pages, sign-in, the chooser and «بياناتي» fit the screen and work by touch', async ({ page, request }) => {
    const errors = trackErrors(page);
    for (const hash of ['#home', '#initiatives', '#initiative/shams', '#initiative/sona3', '#login', '#register']) {
      await page.goto(`/${hash}`);
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page);
    }
    const email = await apiAccount(request, 'mobile', 'مستخدم الموبايل');
    await login(page, email, NEW_PW);
    await expect(page).toHaveURL(/#initiatives$/);
    await noHorizontalScroll(page);
    await page.goto('/#hub');
    await expect(page.getByText('لم تقدّم على أي مبادرة بعد.')).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto('/#profile');
    await expect(field(page, 'الاسم الرباعي').locator('input')).toHaveValue('مستخدم الموبايل');
    await noHorizontalScroll(page);
    await page.goto('/#notifications');
    await expect(page.getByText('لا توجد إشعارات.')).toBeVisible();
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
