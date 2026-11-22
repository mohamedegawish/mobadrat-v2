// فورم تسجيل المصنع (Registration Form V01.xlsx) عبر الواجهة: مؤشر التقدم، التحقق الفوري بالعربية، حفظ المسودة والعودة إليها،
// رفض الملفات غير المدعومة، حذف المستند واستبداله، الملخص النهائي قبل الإرسال، ورسالة النجاح بعد الإرسال.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiAct, apiToken, open, pdfFile, registerApprovedFactory } from './helpers';

const EMAIL = `e2e.regform.${Date.now()}@test.local`;
const PASSWORD = 'Factory2026';

/** مصنع مقبول الحساب، طلبه الأول مسحوب، ليبدأ مسودة جديدة في المعالج (معالج المسودة هو موضوع هذا الاختبار). */
async function approvedFactoryWithFreshDraftButton(page: Page, request: APIRequestContext) {
  const first = await registerApprovedFactory(page, request, { companyName: 'مصنع اختبار فورم التسجيل', contactName: 'م. اختبار الفورم', email: EMAIL, mobile: '01022223333', password: PASSWORD });
  await apiAct(request, await apiToken(request, EMAIL, PASSWORD), first, 'withdraw', { reason: 'بدء طلب جديد لاختبار المعالج' });
  await open(page, '#factory-dashboard');
}

test('registration form: progress, Arabic validation, draft resume, file checks, delete/replace, summary and success', async ({ page, request }) => {
  await approvedFactoryWithFreshDraftButton(page, request);
  await page.getByTestId('start-application').click();
  await expect(page).toHaveURL(/#i\/shams\/apply\//);
  const appHash = new URL(page.url()).hash;

  // ── مؤشر التقدم: لا قسم مكتمل في البداية ──
  await expect(page.getByTestId('wizard-progress-label')).toContainText('اكتمل ٠ من ٤ أقسام');
  await expect(page.getByTestId('wizard-left-general')).toBeVisible();

  // ── القسم الأول: البيانات العامة + تحقق فوري ──
  await page.locator('#f-governorate').selectOption('sharqia');
  await page.locator('#f-industrialZone').selectOption('10th-ramadan');
  await page.locator('#f-address').fill('المنطقة الصناعية الثالثة');
  await page.locator('#f-phone1').fill('0221234567');
  await page.locator('#f-website').fill('abc');
  await expect(page.locator('[data-field="website"] .field-error')).toContainText('رابط موقع غير صالح');
  await expect(page.getByTestId('wizard-step-general')).toHaveAttribute('data-complete', '0');
  await page.locator('#f-website').fill('www.factory-test.com');
  await expect(page.locator('[data-field="website"] .field-error')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step-general')).toHaveAttribute('data-complete', '1');
  await expect(page.getByTestId('wizard-progress-label')).toContainText('اكتمل ١ من ٤ أقسام');

  // ── حفظ كمسودة ثم العودة لاحقًا (إعادة تحميل كاملة) ──
  await page.getByTestId('wizard-save-draft').click();
  await expect(page.getByText('تم حفظ المسودة')).toBeVisible();
  await open(page, '#factory-dashboard');
  await page.getByTestId('current-task').getByTestId('task-go').click();
  await expect(page).toHaveURL(new RegExp(appHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page.locator('#f-address')).toHaveValue('المنطقة الصناعية الثالثة');
  await expect(page.locator('#f-website')).toHaveValue('https://www.factory-test.com');

  // ── القسم الثاني: مسؤول الاتصال — بريد خاطئ يُرفض بالعربية ويمنع الإرسال ──
  await page.getByTestId('wizard-next').click();
  await page.locator('#f-contactTitle').fill('مدير المصنع');
  await page.locator('#f-contactEmail').fill('not-an-email');
  await expect(page.locator('[data-field="contactEmail"] .field-error')).toContainText('بريد إلكتروني غير صالح');

  // ── القسم الثالث: أوراق الشركة — ملف غير مدعوم، ثم رفع وحذف واستبدال ──
  await page.getByTestId('wizard-next').click();
  await page.locator('#f-commercialRegisterNumber').fill('CR-777');
  await page.locator('#f-industrialRegistryNumber').fill(`IND-RF-${Date.now() % 100000}`);
  await page.locator('#f-taxNumber').fill('111-222-333');
  await page.getByTestId('upload-taxCardFile').setInputFiles({ name: 'tax.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(page.getByTestId('upload-taxCardFile-error')).toContainText('غير مدعومة');
  for (const key of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile']) {
    await page.getByTestId(`upload-${key}`).setInputFiles(pdfFile(`${key}.pdf`));
    await expect(page.getByText(`${key}.pdf`)).toBeVisible();
  }
  await page.getByTestId('remove-taxCardFile').click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('doc-empty-taxCardFile')).toBeVisible();
  await page.getByTestId('upload-taxCardFile').setInputFiles(pdfFile('tax-final.pdf'));
  await expect(page.getByText('tax-final.pdf')).toBeVisible();
  await page.getByTestId('upload-commercialRegisterFile').setInputFiles(pdfFile('cr-v2.pdf'));
  await expect(page.getByText('cr-v2.pdf')).toBeVisible();
  await expect(page.locator('[data-field="commercialRegisterFile"]')).toContainText('نسخة سابقة محفوظة');

  // ── القسم الرابع: البيانات الهندسية ──
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('roof-add').click();
  await page.getByTestId('roof-name-0').fill('السطح الرئيسي');
  await page.getByTestId('roof-area-0').fill('1500');
  await page.locator('#f-contractedCapacity').fill('1000');
  await page.locator('#f-capacityUnit').selectOption('kVA');
  await page.locator('#f-peakLoad').fill('800');
  await page.locator('#f-loadUnit').selectOption('kW');
  await page.locator('#f-ownershipType').selectOption('owned');
  await page.locator('#f-ownershipExpiresAt').fill('2045-12-31');
  await page.getByTestId('upload-electricityBills').setInputFiles(pdfFile('bill-1.pdf'));
  await expect(page.getByText('bill-1.pdf')).toBeVisible();
  await page.getByTestId('upload-ownershipProofFile').setInputFiles(pdfFile('ownership.pdf'));
  await expect(page.getByText('ownership.pdf')).toBeVisible();

  // ── الملخص: البريد الخاطئ يمنع الإرسال ويُشار إليه ──
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('missing-list')).toHaveCount(0);
  await expect(page.getByTestId('invalid-list')).toContainText('البريد الإلكتروني');
  await expect(page.getByTestId('wizard-submit')).toBeDisabled();
  await page.getByTestId('invalid-contactEmail').click();
  await expect(page.locator('#f-contactEmail')).toBeFocused();
  await page.locator('#f-contactEmail').fill('contact@factory-test.com');
  await page.getByTestId('wizard-step-review').click();

  // ── الملخص الكامل قبل الإرسال ──
  await expect(page.getByTestId('review-complete')).toBeVisible();
  await expect(page.getByTestId('wizard-progress-label')).toContainText('اكتمل ٤ من ٤ أقسام');
  await expect(page.getByTestId('review-value-address')).toHaveText('المنطقة الصناعية الثالثة');
  await expect(page.getByTestId('review-value-contactEmail')).toHaveText('contact@factory-test.com');
  await expect(page.getByTestId('review-value-taxCardFile')).toContainText('tax-final.pdf');
  await expect(page.getByTestId('review-value-commercialRegisterFile')).toContainText('cr-v2.pdf');
  await expect(page.getByTestId('review-value-commercialRegisterFile')).not.toContainText('commercialRegisterFile.pdf');
  await expect(page.getByTestId('review-value-roofAreas')).toContainText('السطح الرئيسي');
  await expect(page.getByTestId('review-value-phone2')).toContainText('لم يُدخل');

  // ── الإرسال ورسالة النجاح ──
  await page.getByTestId('wizard-submit').click();
  await page.getByTestId('confirm-action').click();
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await expect(page.getByTestId('submit-success')).toContainText('تم إرسال طلب التسجيل بنجاح');
  await expect(page.getByTestId('submit-success-number')).not.toBeEmpty();
  await expect(page.getByTestId('current-task')).toContainText('IMC');
});
