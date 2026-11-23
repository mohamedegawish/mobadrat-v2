// إصلاحات مراجعة القبول في الواجهة (docs/FIX_REPORT.md): العودة للوجهة بعد الدخول (I1)، المعالج (I12/M3)،
// الأرقام العربية ورسائل التحقق (I2)، لوحة PMU (I5/I6)، لوحة الأدمن (18)، النص العام (B3).
import { test, expect } from '@playwright/test';
import { login, open } from './helpers';

test('I1: a notification link opened while signed out lands on that application after sign-in', async ({ page, browser }) => {
  await login(page, 'factory@shams.local');
  await page.getByTestId('start-application').click();
  await expect(page).toHaveURL(/#i\/shams\/apply\//);
  const appId = decodeURIComponent(page.url().split('apply/')[1]);

  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(`/#i/shams/application/${appId}`);
  await expect(guest.getByText('يجب تسجيل الدخول')).toBeVisible();
  await guest.locator('.state-box').getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(guest).toHaveURL(/#login$/);
  await guest.locator('input[type=email]').fill('pmu@shams.local');
  await guest.locator('input[type=password]').fill('Mobadrat@2026');
  await guest.locator('button.btn-primary').click();
  await expect(guest).toHaveURL(new RegExp(`#i/shams/application/${appId}$`));
  await expect(guest.getByRole('heading', { level: 1 })).toContainText('مسودة');
  await ctx.close();

  // وجهة غير مسموحة للدور (أو غير داخلية) تُتجاهل → الصفحة الافتراضية للدور
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('/#i/shams/admin-accounts');
  await expect(p2.getByText('يجب تسجيل الدخول')).toBeVisible();
  await login(p2, 'factory2@shams.local');
  await expect(p2).toHaveURL(/#i\/shams\/factory-dashboard/);
  await ctx2.close();
});

test('I12/I2/M3: wizard ticks only complete sections, blocks an incomplete submit, links each missing item, speaks Arabic', async ({ page }) => {
  await login(page, 'factory@shams.local');
  await open(page, '#factory-dashboard');
  await page.getByTestId('current-task').getByTestId('task-go').click();
  await expect(page).toHaveURL(/#i\/shams\/apply\//);

  await expect(page.getByTestId('wizard-step-general')).toHaveAttribute('data-complete', '0');
  await expect(page.getByTestId('wizard-step-engineering')).toHaveAttribute('data-complete', '0');
  // I2: أرقام لوحة المفاتيح العربية تُحوَّل
  await page.locator('#f-phone1').fill('٠٢٢١٢٣٤٥٦٧');
  await expect(page.locator('#f-phone1')).toHaveValue('0221234567');
  await page.locator('#f-governorate').selectOption('sharqia');
  await page.locator('#f-industrialZone').selectOption('10th-ramadan');
  await page.locator('#f-address').fill('المنطقة الصناعية');
  await expect(page.getByTestId('wizard-step-general')).toHaveAttribute('data-complete', '1');
  // I2: رسالة التحقق عربية من القاموس، والموقع بلا http يُقبل
  await page.locator('#f-website').fill('www.factory.com');
  await page.locator('#f-phone2').fill('abc');
  await expect(page.locator('.field-error').first()).toContainText('رقم هاتف غير صالح');
  await expect(page.getByText('invalid phone number')).toHaveCount(0);
  await expect(page.getByText('invalid URL')).toHaveCount(0);
  await page.locator('#f-phone2').fill('');

  await page.getByTestId('wizard-step-engineering').click();
  await expect(page.getByTestId('help-contractedCapacity')).toContainText('القدرة الكهربائية المتفق عليها');
  await expect(page.getByTestId('help-peakLoad')).toBeVisible();
  await expect(page.getByTestId('help-capacityUnit')).toContainText('kVA');
  await expect(page.getByText('يُعاد حسابه في السيرفر')).toHaveCount(0);
  await expect(page.getByTestId('pdf-hint').first()).toContainText('حفظ بصيغة PDF');
  await page.locator('#f-ownershipExpiresAt').fill('2040-12-31');
  await expect(page.getByTestId('date-readable-ownershipExpiresAt')).toContainText('ديسمبر');

  await page.getByTestId('wizard-step-review').click();
  await expect(page.getByTestId('wizard-submit')).toBeDisabled();
  await expect(page.getByTestId('submit-blocked')).toBeVisible();
  await page.getByTestId('missing-taxNumber').click();
  await expect(page.locator('#f-taxNumber')).toBeFocused();
});

test('I5/I6: PMU lands on what awaits its decision; no fake "overdue 0"; days-waiting column', async ({ page }) => {
  await login(page, 'pmu@shams.local');
  await expect(page).toHaveURL(/#workspace\/pmu/);
  await expect(page.getByTestId('awaiting-me')).toContainText('بانتظار قراري');
  await expect(page.getByTestId('sla-not-set')).toContainText('لم تُحدد مهل');
  await page.getByTestId('awaiting-me').click();
  await expect(page.getByTestId('tab-mine')).toHaveClass(/active/);
  await expect(page.getByTestId('tab-overdue')).toBeDisabled();
  await page.getByTestId('tab-all').click();
  await expect(page.getByTestId('drafts-count')).toBeVisible();
});

test('18/B2/M6: admin lands on readiness & operations — unmet conditions listed, no PMU dashboard or provider approval', async ({ page }) => {
  await login(page, 'admin@shams.local');
  await expect(page).toHaveURL(/#workspace\/system_admin/);
  await expect(page.getByTestId('tab-readiness')).toHaveClass(/active/);
  await expect(page.getByTestId('check-support_contact')).toHaveAttribute('data-ok', '0');
  await expect(page.getByTestId('check-banks_available')).toHaveAttribute('data-ok', '1');
  await expect(page.getByTestId('failed-messages')).toBeVisible();
  await open(page, '#providers');
  await expect(page.getByText('هذه الصفحة غير متاحة لدورك')).toBeVisible();
  // M6: رسالة حقيقية في السجل بتسمية عربية بدل المفتاح البرمجي
  // Account mails (password reset…) are the platform's: they are in the platform's unified outbox, labelled in Arabic.
  await page.request.post('/api/v1/auth/forgot-password', { data: { email: 'factory2@shams.local' } });
  await login(page, 'admin@mobadrat.local');
  await page.goto('/#admin-outbox');
  await expect(page.getByText('استعادة كلمة المرور').first()).toBeVisible();
  await expect(page.getByText('auth.reset_password')).toHaveCount(0);
});

test('B3: the public page does not present the proposed electricity reviewer as fact', async ({ page }) => {
  await page.goto('/#i/shams/home');
  await expect(page.getByText('تصدرها شركة التوزيع التابعة.')).toBeVisible();
  await expect(page.getByText('وتراجعها وحدة إدارة المبادرة')).toHaveCount(0);
});

test('id-less links (#apply, #application) never crash: the wizard returns to the dashboard, the detail page says not available', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await login(page, 'factory@shams.local');
  await open(page, '#apply');
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard$/);
  await open(page, '#application');
  await expect(page.getByTestId('not-available')).toBeVisible();
  expect(crashes).toEqual([]);
});
