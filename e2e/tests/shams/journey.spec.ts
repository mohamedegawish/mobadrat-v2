// رحلة كاملة عبر الواجهة: تسجيل مصنع بكل النموذج ومستنداته → تفعيل البريد (لا دخول قبل القبول) → IMC تطلب تعديل بيانات
// (دخول مقيّد للتعديل فقط) → إعادة الإرسال (خروج) → IMC تقبل الحساب (بريد قبول) → دخول كامل → ENCPC → مقدم الخدمة
// → العرض → PMU → الكهرباء والبنك → PMU → البنك → تسجيل التعاقد = CONTRACTED.
import { test, expect } from '@playwright/test';
import { shot } from '../support/platform';
import { activate, apiFindApplication, apiToken, asRole, confirm, expectLoginRefused, expectShamsLocked, login, mailMatching, open, pdfFile, PASSWORD, registerViaPage } from './helpers';

const FACTORY_EMAIL = `e2e.factory.${Date.now()}@test.local`;
const FACTORY_PASSWORD = 'Factory2026';
const COMPANY = `مصنع اختبار الواجهة ${Date.now() % 100000}`;

test('factory and reviewers complete the full journey to CONTRACTED', async ({ page, browser, request }) => {
  // ── التسجيل: كل نموذج التسجيل ومستنداته من صفحة التسجيل ──
  await page.goto('/#i/shams/home');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('شمس الصناعة');
  await shot(page, 'shams-01-home');
  await page.getByTestId('hero-apply').click();
  await expect(page).toHaveURL(/#i\/shams\/register/);
  await registerViaPage(page, { companyName: COMPANY, contactName: 'م. اختبار الواجهة', email: FACTORY_EMAIL, mobile: '01011112222', password: FACTORY_PASSWORD });
  await shot(page, 'shams-02-registered');

  // ── قبل التفعيل ثم بعده: لا دخول قبل قبول الحساب ──
  await expectLoginRefused(page, FACTORY_EMAIL, FACTORY_PASSWORD, /تفعيل البريد/);
  await activate(page, FACTORY_EMAIL);
  await shot(page, 'shams-03-verified');
  await expectShamsLocked(page, FACTORY_EMAIL, FACTORY_PASSWORD, /قيد مراجعة/);
  await mailMatching(FACTORY_EMAIL, /طلب التسجيل قيد المراجعة/);
  await shot(page, 'shams-04-locked-under-review');
  const appId = await apiFindApplication(request, await apiToken(request, 'imc1@shams.local'), COMPANY);

  // ── IMC: طلب تعديل بيانات (يرى المستندات المرفوعة مع التسجيل) ──
  const imc = await asRole(browser, 'imc1@shams.local');
  await open(imc, `#application/${appId}`);
  await imc.getByRole('tab', { name: 'المستندات' }).click();
  await expect(imc.getByText('ownership.pdf').first()).toBeVisible();
  await imc.getByRole('tab', { name: 'البيانات' }).click();
  await imc.getByTestId('action-request_correction').click();
  await imc.getByTestId('def-field-0').selectOption('address');
  await imc.getByTestId('def-note-0').fill('اكتب العنوان بالتفصيل مع رقم القطعة');
  await imc.getByTestId('decision-submit').click();
  await confirm(imc);                                   // طلب الاستيفاء يُؤكَّد قبل أن يعود الطلب إلى المصنع
  await expect(imc.getByText('استيفاء البيانات').first()).toBeVisible();
  await shot(imc, 'shams-05-imc-correction');
  const corrMail = await mailMatching(FACTORY_EMAIL, /مطلوب تعديل بيانات التسجيل/);
  expect(corrMail).toContain('اكتب العنوان بالتفصيل');

  // ── المصنع: دخول مقيّد — تعديل البند المطلوب فقط ثم إعادة الإرسال ──
  await login(page, FACTORY_EMAIL, FACTORY_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`#i/shams/apply/${appId}`));
  await expect(page.getByTestId('restricted-banner')).toContainText('لم يُقبل بعد');
  await expect(page.locator('.nav-links').getByText('لوحتي')).toHaveCount(0);   // لا تنقل لباقي المنصة قبل القبول
  await expect(page.locator('#f-companyName')).toBeDisabled();
  await expect(page.locator('#f-address')).toBeEnabled();
  await shot(page, 'shams-06-restricted-edit');
  await page.locator('#f-address').fill('المنطقة الصناعية الثالثة — قطعة 12');
  await page.getByRole('tab').last().click();
  await page.getByTestId('wizard-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#hub/);
  await expect(page.getByTestId('submitted-for-review')).toContainText('تم إرسال التعديلات');
  await shot(page, 'shams-07-resubmitted');
  await expectShamsLocked(page, FACTORY_EMAIL, FACTORY_PASSWORD, /قيد مراجعة/);

  // ── IMC: قبول = قبول الحساب ──
  await open(imc, `#application/${appId}`);
  await imc.getByTestId('action-accept').click();
  await imc.getByTestId('decision-submit').click();
  await confirm(imc);
  await expect(imc.getByText('المراجعة الفنية — ENCPC').first()).toBeVisible();
  await shot(imc, 'shams-08-imc-accepted');
  const okMail = await mailMatching(FACTORY_EMAIL, /تم قبول حساب المصنع/);
  expect(okMail).toContain('تسجيل الدخول');

  // ── المصنع: دخول كامل ──
  await login(page, FACTORY_EMAIL, FACTORY_PASSWORD);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await expect(page.getByTestId('restricted-banner')).toHaveCount(0);
  await expect(page.getByTestId('current-task')).toContainText('ENCPC');
  await shot(page, 'shams-09-factory-dashboard');

  // ── ENCPC: مطابق ──
  const encpc = await asRole(browser, 'encpc@shams.local');
  await open(encpc, `#application/${appId}`);
  await expect(encpc.getByTestId('action-reject')).toHaveCount(0);
  await encpc.getByTestId('action-compliant').click();
  await encpc.getByTestId('decision-submit').click();
  await confirm(encpc);
  await expect(encpc.getByText('اختيار مقدم الخدمة').first()).toBeVisible();
  await shot(encpc, 'shams-10-encpc-compliant');

  // ── المصنع: مقدم الخدمة ثم العرض الفني ──
  await open(page, `#task/${appId}`);
  await page.getByTestId('provider-sp-demo-1').check();
  await shot(page, 'shams-11-provider-selection');
  await page.getByTestId('select-provider').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await open(page, `#task/${appId}`);
  await page.getByTestId('upload-technicalOfferFile').setInputFiles(pdfFile('offer.pdf'));
  await expect(page.getByText('offer.pdf')).toBeVisible();
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  // ── PMU: قبول العرض ──
  const pmu = await asRole(browser, 'pmu@shams.local');
  await open(pmu, `#application/${appId}`);
  await pmu.getByTestId('action-accept').click();
  await pmu.getByTestId('decision-submit').click();
  await confirm(pmu);
  await expect(pmu.getByText('رفع موافقة الكهرباء').first()).toBeVisible();
  await shot(pmu, 'shams-12-pmu-offer-accepted');

  // ── المصنع: موافقة الكهرباء (بلا بنك — G-01) ──
  await open(page, `#task/${appId}`);
  await expect(page.locator('#bankOrgId')).toHaveCount(0);
  await page.getByTestId('upload-electricityApprovalFile').setInputFiles(pdfFile('approval.pdf'));
  await expect(page.getByText('approval.pdf')).toBeVisible();
  await page.locator('#distributionCompany').fill('شركة توزيع (اختبار)');
  await shot(page, 'shams-13-electricity-approval');
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  // ── PMU: الموافقة مستوفاة → يختار المصنع مسار التعاقد ──
  await open(pmu, `#application/${appId}`);
  await pmu.getByTestId('action-accept').click();
  await pmu.getByTestId('decision-submit').click();
  await confirm(pmu);
  await expect(pmu.getByText('مسار التعاقد / التعاقد البنكي').first()).toBeVisible();
  await shot(pmu, 'shams-14-pmu-electricity-accepted');

  // ── المصنع: مسار البنك ثم اختيار البنك (لا حساب ولا قرار للبنك — G-02) ──
  await open(page, `#task/${appId}`);
  await page.getByTestId('path-bank').check();
  await page.getByTestId('bank-select').selectOption('org-bank-demo-a');
  await shot(page, 'shams-15-contract-path');
  await page.getByTestId('select-bank').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);

  // ── المصنع: تسجيل التعاقد مع مستند الإثبات (G-03) ──
  await open(page, `#task/${appId}`);
  await page.locator('#contractDate').fill('2026-11-01');
  await page.locator('#contractAmount').fill('25000000');
  await expect(page.getByTestId('task-submit')).toBeDisabled();
  await page.getByTestId('upload-contractFile').setInputFiles(pdfFile('contract.pdf'));
  await expect(page.getByText('contract.pdf')).toBeVisible();
  await page.getByTestId('task-submit').click();
  await confirm(page);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await open(page, `#application/${appId}`);
  await expect(page.getByText('اكتمل — تم التعاقد').first()).toBeVisible();
  await shot(page, 'shams-16-contracted');

  // مصنع آخر لا يرى الطلب
  const other = await asRole(browser, 'factory2@shams.local');
  await open(other, `#application/${appId}`);
  // M4: «غير متاح لحسابك» بدل «تعذر تحميل البيانات — إعادة المحاولة».
  await expect(other.getByTestId('not-available')).toContainText('هذا الطلب غير متاح لحسابك');
  await expect(other.getByRole('button', { name: 'إعادة المحاولة' })).toHaveCount(0);
  void PASSWORD;
});
