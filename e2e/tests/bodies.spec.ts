// دليل الجهات في لوحة الإدارة الموحدة، عبر الشاشات: الربط من الاقتراح، تفاصيل الجهة وعاملوها، الفصل والتعديل والإيقاف والحذف،
// إضافة جهة جديدة بربطها، وصلاحيات القراءة فقط لمتابع الوزارة، ولا شيء لمدير المحتوى.
import { test, expect, type Page } from '@playwright/test';
import { apiToken, login, shot } from './support/platform';

const bodyRow = (page: Page, text: string) => page.getByTestId('bodies-table').locator('tbody tr', { hasText: text });

test('platform admin: the directory, a suggested body linked in one click, its page, unlink / edit / deactivate / delete', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'admin@mobadrat.local');
  await page.goto('/#admin-bodies');
  await expect(page.getByRole('heading', { name: /دليل الجهات/ })).toBeVisible();

  // IMC: one body, its organization in both initiatives, with its activity.
  const imc = bodyRow(page, 'مركز تحديث الصناعة');
  await expect(imc).toContainText('شمس الصناعة');
  await expect(imc).toContainText('صُنّاع المستقبل');
  await expect(bodyRow(page, 'ENCPC')).not.toContainText('صُنّاع المستقبل');
  await shot(page, 'bodies-01-directory');

  // The two «إدارة النظام» organizations are suggested as one body → add it and link both in one click.
  const suggestion = page.getByTestId('body-suggestion').filter({ hasText: 'إدارة النظام' });
  await expect(suggestion).toContainText('شمس الصناعة + صُنّاع المستقبل');
  await suggestion.getByRole('button', { name: 'إضافة جهة واحدة وربطها' }).click();
  await expect(page.getByText('أُضيفت الجهة ورُبطت بالمبادرتين.')).toBeVisible();
  await expect(page.getByTestId('body-suggestion').filter({ hasText: 'إدارة النظام' })).toHaveCount(0);
  const sys = bodyRow(page, 'إدارة النظام');
  await expect(sys).toContainText('شمس الصناعة');
  await expect(sys).toContainText('صُنّاع المستقبل');

  // Its page: both links, its people, unlink one, edit, deactivate, then delete once unlinked.
  await sys.getByRole('link').first().click();
  await expect(page).toHaveURL(/#admin-body\//);
  const links = page.getByTestId('body-links');
  await expect(links.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('body-people')).toContainText('admin@shams.local');
  await expect(page.getByTestId('body-people')).toContainText('admin@sona3.local');
  await shot(page, 'bodies-02-body-page');
  page.once('dialog', (d) => void d.accept());
  await links.locator('tr[data-initiative="sona3"]').getByRole('button', { name: 'فصل' }).click();
  await expect(page.getByText('فُصل الربط.')).toBeVisible();
  await expect(links.locator('tbody tr')).toHaveCount(1);

  const edit = page.getByTestId('edit-body');
  await edit.locator('#edit-body-nameEn').fill('Systems administration');
  await edit.locator('#edit-body-kind').selectOption('government');
  await edit.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('حُفظت بيانات الجهة.')).toBeVisible();
  await expect(page.getByTestId('body-detail')).toContainText('جهة حكومية');

  await edit.getByRole('button', { name: 'إيقاف الجهة' }).click();
  await expect(page.getByTestId('body-detail')).toContainText('موقوفة');
  await expect(page.getByTestId('link-form')).toHaveCount(0);           // an inactive body takes no new link
  await edit.getByRole('button', { name: 'تفعيل الجهة' }).click();
  await expect(page.getByTestId('link-form')).toBeVisible();

  await expect(edit.getByRole('button', { name: 'حذف من الدليل' })).toBeDisabled();   // still linked to Shams
  page.once('dialog', (d) => void d.accept());
  await links.locator('tr[data-initiative="shams"]').getByRole('button', { name: 'فصل' }).click();
  await expect(page.getByText('غير مربوطة بأي مبادرة بعد.')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await edit.getByRole('button', { name: 'حذف من الدليل' }).click();
  await expect(page).toHaveURL(/#admin-bodies$/);
  await expect(bodyRow(page, 'إدارة النظام')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('platform admin: a new body with its organization in one initiative; linking an unlinked organization from the list', async ({ page, request }) => {
  // A new bank created by the Shams administrator (Shams-only body).
  const shamsAdmin = await apiToken(request, 'admin@shams.local');
  const name = `بنك القاهرة للتجربة ${Date.now() % 100000}`;
  const bank = await request.post('/api/v1/i/shams/admin/organizations', { headers: { Authorization: `Bearer ${shamsAdmin}` }, data: { type: 'bank', nameAr: name, nameEn: 'Test bank' } });
  expect(bank.status()).toBe(201);
  const bankId = (await bank.json()).data.id as string;

  await login(page, 'admin@mobadrat.local');
  await page.goto('/#admin-bodies');
  // The bank is listed as an initiative organization not in the directory yet.
  const row = page.getByTestId('unlinked-box').locator(`tr[data-org="shams:${bankId}"]`);
  await expect(row).toContainText(name);
  const form = page.getByTestId('new-body');
  await form.locator('#new-body-nameAr').fill(name);
  await form.locator('#new-body-kind').selectOption('financial');
  await form.locator('#new-body-website').fill('www.cairo-bank.example.org');
  await form.locator('#new-body-link-shams').selectOption(bankId);
  await form.getByRole('button', { name: 'إضافة إلى الدليل' }).click();
  await expect(page.getByText('أُضيفت الجهة إلى الدليل.')).toBeVisible();
  const created = bodyRow(page, name);
  await expect(created).toContainText('شمس الصناعة');
  await expect(created).not.toContainText('صُنّاع المستقبل');
  await expect(page.getByTestId('unlinked-box').locator(`tr[data-org="shams:${bankId}"]`)).toHaveCount(0);

  // Same name again → the directory refuses it (one record per real body).
  await form.locator('#new-body-nameAr').fill(name);
  await form.getByRole('button', { name: 'إضافة إلى الدليل' }).click();
  await expect(page.locator('.pf-alert.err')).toContainText('توجد جهة بنفس الاسم');
});

test('ministry viewer reads the directory and the body pages without any management control; the content manager has no access', async ({ browser }) => {
  const viewer = await (await browser.newContext()).newPage();
  await login(viewer, 'ministry@mobadrat.local');
  await viewer.goto('/#admin-bodies');
  await expect(bodyRow(viewer, 'مركز تحديث الصناعة')).toBeVisible();
  await expect(viewer.getByTestId('new-body')).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /ربط|جهة جديدة منها|إضافة جهة واحدة/ })).toHaveCount(0);
  await bodyRow(viewer, 'مركز تحديث الصناعة').getByRole('link').first().click();
  await expect(viewer.getByTestId('body-links').locator('tbody tr')).toHaveCount(2);
  await expect(viewer.getByTestId('body-people')).toContainText('imc1@shams.local');
  await shot(viewer, 'bodies-03-imc-as-viewer');
  await expect(viewer.getByTestId('edit-body')).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'فصل' })).toHaveCount(0);

  const content = await (await browser.newContext()).newPage();
  await login(content, 'content@mobadrat.local');
  await content.goto('/#admin');
  await expect(content.locator('.admin-sidebar')).toBeVisible();
  await expect(content.locator('.admin-sidebar').getByText('الجهات المسؤولة')).toHaveCount(0);
  await content.goto('/#admin-bodies');
  await expect(content.locator('.pf-alert.err')).toBeVisible();
});
