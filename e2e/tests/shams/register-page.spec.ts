// صفحة التسجيل الواحدة: كل بيانات نموذج التسجيل ومستنداته على خطوات، وما يُدخل يبقى بعد تحديث الصفحة (النصوص والخطوة والملفات)،
// وكلمة المرور لا تُحفظ. «إنشاء الحساب» يرفع البيانات والمستندات معًا ويمسحها من المتصفح؛ بعد التفعيل يذهب الطلب لـIMC،
// ولا دخول حتى قبول الحساب.
import { test, expect } from '@playwright/test';
import { activate, apiAct, apiFindApplication, apiToken, expectShamsLocked, login, mailMatching, pdfFile } from './helpers';

const EMAIL = `e2e.regpage.${Date.now()}@test.local`;
const PASSWORD = 'Factory2026';

test('register page: whole form + documents in steps, survives refresh, sent with the account; no sign-in until IMC accepts', async ({ page, request }) => {
  await page.goto('/#i/shams/register');

  // ── الخطوة 1: البيانات العامة ──
  await page.locator('#f-companyName').fill('مصنع الصفحة الواحدة');
  await page.locator('#f-governorate').selectOption('sharqia');
  await page.locator('#f-industrialZone').selectOption('10th-ramadan');
  await page.locator('#f-address').fill('المنطقة الصناعية الثالثة');
  await page.locator('#f-phone1').fill('0221234567');
  await page.locator('#f-website').fill('www.one-page.test');
  await expect(page.getByTestId('reg-step-general')).toHaveAttribute('data-complete', '1');

  // ── الخطوة 2: مسؤول الاتصال وبيانات الدخول ──
  await page.getByTestId('reg-next').click();
  await page.locator('#f-contactName').fill('م. منى');
  await page.locator('#f-contactTitle').fill('مديرة المصنع');
  await page.locator('#f-contactMobile').fill('01044445555');
  await page.locator('#f-contactEmail').fill(EMAIL);
  await page.locator('#regPassword').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);

  // ── الخطوة 3: أوراق الشركة (أرقام + ملفات) ──
  await page.getByTestId('reg-next').click();
  await page.locator('#f-commercialRegisterNumber').fill('CR-900');
  await page.locator('#f-industrialRegistryNumber').fill(`IND-ONE-${Date.now() % 100000}`);
  await page.locator('#f-taxNumber').fill('900-800-700');
  for (const key of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile']) {
    await page.getByTestId(`upload-${key}`).setInputFiles(pdfFile(`${key}.pdf`));
    await expect(page.getByTestId(`doc-${key}`)).toContainText(`${key}.pdf`);
  }

  // ── تحديث الصفحة في المنتصف: كل شيء باقٍ عدا كلمة المرور ──
  await page.waitForTimeout(500); // مهلة الحفظ في المتصفح (300ms)
  await page.reload();
  await expect(page.getByTestId('register-start-over')).toBeVisible();
  await expect(page.getByTestId('reg-step-company')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#f-commercialRegisterNumber')).toHaveValue('CR-900');
  for (const key of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile']) await expect(page.getByTestId(`doc-${key}`)).toContainText(`${key}.pdf`);
  await page.getByTestId('reg-step-general').click();
  await expect(page.locator('#f-companyName')).toHaveValue('مصنع الصفحة الواحدة');
  await expect(page.locator('#f-industrialZone')).toHaveValue('10th-ramadan');
  await page.getByTestId('reg-step-contact').click();
  await expect(page.locator('#f-contactEmail')).toHaveValue(EMAIL);
  await expect(page.locator('#f-contactTitle')).toHaveValue('مديرة المصنع');
  await expect(page.locator('#regPassword')).toHaveValue('', { timeout: 1000 });

  // ── الخطوة 4: البيانات الهندسية ──
  await page.getByTestId('reg-step-engineering').click();
  await page.getByTestId('roof-add').click();
  await page.getByTestId('roof-name-0').fill('السطح الرئيسي');
  await page.getByTestId('roof-area-0').fill('2000');
  await page.locator('#f-contractedCapacity').fill('900');
  await page.locator('#f-capacityUnit').selectOption('kVA');
  await page.locator('#f-peakLoad').fill('700');
  await page.locator('#f-loadUnit').selectOption('kW');
  await page.locator('#f-ownershipType').selectOption('leased');
  await page.locator('#f-ownershipExpiresAt').fill('2046-06-30');
  for (const i of [1, 2]) {
    await page.getByTestId('upload-electricityBills').setInputFiles(pdfFile(`bill-${i}.pdf`));
    await expect(page.getByTestId('docs-electricityBills')).toContainText(`bill-${i}.pdf`);
  }
  await page.getByTestId('upload-ownershipProofFile').setInputFiles(pdfFile('lease.pdf'));
  await expect(page.getByTestId('doc-ownershipProofFile')).toContainText('lease.pdf');

  // ── المراجعة: كلمة المرور لم تُحفظ بعد التحديث → مطلوبة لإنشاء الحساب ──
  await page.getByTestId('reg-next').click();
  await expect(page.getByTestId('account-issues')).toBeVisible();
  await expect(page.getByTestId('register-submit')).toBeDisabled();
  await page.getByTestId('account-issue-regPassword').click();
  await expect(page.locator('#regPassword')).toBeFocused();
  await page.locator('#regPassword').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
  await page.getByTestId('reg-step-review').click();
  await expect(page.getByTestId('review-complete')).toBeVisible();
  await expect(page.getByTestId('reg-progress-label')).toContainText('اكتمل ٤ من ٤ أقسام');
  await expect(page.getByTestId('review-value-companyName')).toHaveText('مصنع الصفحة الواحدة');
  await expect(page.getByTestId('review-value-electricityBills')).toContainText('bill-2.pdf');
  await expect(page.getByTestId('review-value-ownershipProofFile')).toContainText('lease.pdf');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-done')).toContainText(EMAIL);
  await expect(page.getByTestId('register-next-steps')).toContainText('IMC');

  // شاشة «راجع بريدك» تبقى بعد التحديث، ولم يعد في المتصفح أي بيانات أو ملفات (صارت على السيرفر).
  await page.reload();
  await expect(page.getByTestId('register-done')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('shams.registerDraft.v1'))).toBeNull();
  expect(await page.evaluate(() => new Promise<number>((resolve) => {
    const req = indexedDB.open('shams-register', 1);
    req.onsuccess = () => { const c = req.result.transaction('files', 'readonly').objectStore('files').count(); c.onsuccess = () => { resolve(c.result); req.result.close(); }; };
    req.onerror = () => resolve(-1);
  }))).toBe(0);

  // ── التفعيل: يُرسل الطلب لـIMC، ولا دخول قبل القبول ──
  await activate(page, EMAIL);
  await expectShamsLocked(page, EMAIL, PASSWORD, /قيد مراجعة/);

  // IMC ترى البيانات والمستندات المرفوعة مع التسجيل، وتقبل الحساب.
  const imc = await apiToken(request, 'imc1@shams.local');
  const appId = await apiFindApplication(request, imc, 'مصنع الصفحة الواحدة');
  const detail = (await (await request.get(`/api/v1/i/shams/applications/${appId}`, { headers: { Authorization: `Bearer ${imc}` } })).json()).data;
  expect(detail.state).toBe('IMC_REVIEW');
  expect(detail.data.contact.contactTitle).toBe('مديرة المصنع');
  expect(detail.documents.map((d: { originalName: string }) => d.originalName).sort()).toEqual(
    ['bill-1.pdf', 'bill-2.pdf', 'commercialRegisterFile.pdf', 'industrialRegisterFile.pdf', 'lease.pdf', 'taxCardFile.pdf']);
  await apiAct(request, imc, appId, 'accept');
  await mailMatching(EMAIL, /تم قبول حساب المصنع/);

  // ── بعد القبول: دخول كامل ──
  await login(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await expect(page.getByTestId('current-task')).toContainText('ENCPC');
});
