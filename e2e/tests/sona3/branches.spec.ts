// فروع رحلة «صُنّاع المستقبل» (docs/ROLES_AND_WORKFLOW.md للتطبيق القديم): طلب استيفاء ← تعديل البنود المحددة فقط ← إعادة التقديم؛
// رفض ← تظلم مسبب ← قبول التظلم يعيد الطلب لمرحلة القرار؛ الانسحاب بسبب. التمهيد عبر الـ API، والفرع نفسه عبر الشاشات.
import { test, expect } from '@playwright/test';
import { act, asRole, expectState, login, mailMatching, newApplicant, open, submittedApplication } from './helpers';

let seq = Date.now() % 9000;

test('eligibility correction: only the flagged items open for editing, then the founder resubmits to IMC', async ({ page, browser, request }) => {
  const a = await newApplicant(request, 'correction');
  const id = await submittedApplication(request, a, ++seq);

  const imc = await asRole(browser, 'imc@sona3.local');
  await open(imc, `#application/${id}`);
  await act(imc, 'طلب استيفاء', async (d) => {
    await d.getByRole('button', { name: /بند/ }).click();
    await d.locator('select').first().selectOption({ label: 'عنوان الإقامة' });
    await d.getByPlaceholder('ملاحظة').fill('اكتب العنوان كاملًا مع رقم العقار');
  });
  await expectState(request, a.s.token, id, 'ELIGIBILITY_CORRECTION');
  expect(await mailMatching(a.email, /مطلوب استيفاء على الطلب/)).toContain('اكتب العنوان كاملًا');

  await login(page, a.email, a.password);
  await open(page, `#apply/${id}`);
  await expect(page.locator('.card.sec.warn').first()).toContainText('اكتب العنوان كاملًا');
  await expect(page.locator('#fld-fullName')).toBeDisabled();            // not flagged → locked
  await expect(page.locator('#fld-address')).toBeEnabled();              // flagged → editable
  await page.locator('#fld-address').fill('12 شارع الهرم، عقار 5، الجيزة');
  await page.locator('#fld-address').blur();
  await page.waitForLoadState('networkidle');
  await page.locator('.sticky-bar').getByRole('button', { name: 'إعادة التقديم' }).click();
  await expectState(request, a.s.token, id, 'ELIGIBILITY_REVIEW');
  expect((await a.s.get(`/applications/${id}`)).data.personal.address).toBe('12 شارع الهرم، عقار 5، الجيزة');
});

test('rejection → one reasoned appeal → IMC accepts it and the application goes back to the decision', async ({ page, browser, request }) => {
  const a = await newApplicant(request, 'appeal');
  const id = await submittedApplication(request, a, ++seq);

  const imc = await asRole(browser, 'imc@sona3.local');
  await open(imc, `#application/${id}`);
  await act(imc, 'غير مستوفٍ — رفض الطلب', async (d) => { await d.locator('textarea').fill('الفكرة خارج نطاق القطاعات المستهدفة'); });
  await expectState(request, a.s.token, id, 'REJECTED');
  await mailMatching(a.email, /قرار بشأن الطلب/);

  await login(page, a.email, a.password);
  await open(page, `#my-application/${id}`);
  const appeal = page.locator('.card.sec', { has: page.locator('h3', { hasText: 'التظلم' }) });
  await appeal.locator('textarea').fill('المشروع ضمن الصناعات الهندسية المغذية — التوضيح في الاستمارة');
  await appeal.getByRole('button', { name: 'تقديم التظلم' }).click();
  await expect(appeal).toContainText('حالة التظلم');

  await open(imc, `#application/${id}`);
  const decision = imc.locator('.card.sec', { has: imc.locator('h3', { hasText: 'تظلم' }) });
  imc.once('dialog', (d) => void d.accept('ثبت أن المشروع ضمن القطاعات المستهدفة'));
  await decision.getByRole('button', { name: 'قبول', exact: true }).click();
  await expectState(request, a.s.token, id, 'ELIGIBILITY_REVIEW');
});

test('withdrawal with a reason closes the application for good', async ({ page, request }) => {
  const a = await newApplicant(request, 'withdraw');
  const id = await submittedApplication(request, a, ++seq);
  await login(page, a.email, a.password);
  await open(page, `#my-application/${id}`);
  await act(page, 'الانسحاب من المبادرة', async (d) => { await d.locator('textarea').fill('ظروف شخصية تمنع الاستمرار'); });
  await expectState(request, a.s.token, id, 'WITHDRAWN');
  await open(page, `#my-application/${id}`);
  await expect(page.locator('.card.actions')).toHaveCount(0);
});
