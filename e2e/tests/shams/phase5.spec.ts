// المرحلة 5: صندوق الإشعارات داخل المنصة — الجرس وعدّاد غير المقروء، صفحة الإشعارات، النقر يفتح الطلب ويوسمه مقروءًا، والعزل بين المستخدمين.
import { test, expect } from '@playwright/test';
import { login, open } from './helpers';
import { apiLogin, closeOpenApplication, seedCompleteDraft, submitApplication } from './seed';

const badgeText = (n: number) => (n > 99 ? '99+' : new Intl.NumberFormat('ar-EG').format(n));

test('the bell counts unread notifications; the page lists the event; clicking it opens the application and marks it read', async ({ page, request }) => {
  const factory = await apiLogin(request, 'factory@shams.local');
  await closeOpenApplication(factory);
  const imcApi = await apiLogin(request, 'imc1@shams.local');
  const other = await apiLogin(request, 'factory2@shams.local');
  const before = (await imcApi.get('/notifications/unread-count')).unread as number;

  const id = await seedCompleteDraft(factory, `IND-E2E-INB-${Date.now() % 100000}`);
  expect((await submitApplication(factory, id)).status).toBe(200);
  const number = (await factory.get(`/applications/${id}`)).number as string;
  const unread = (await imcApi.get('/notifications/unread-count')).unread as number;
  expect(unread).toBe(before + 1);

  await login(page, 'imc1@shams.local');
  await expect(page.getByTestId('bell-badge')).toHaveText(badgeText(unread));
  await page.getByTestId('bell').click();
  await expect(page).toHaveURL(/#i\/shams\/notifications/);
  const item = page.getByTestId('inbox-list').getByRole('button', { name: new RegExp(number) }).first();
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-read', '0');
  await expect(page.getByTestId('unread-only')).not.toBeChecked();

  // النقر يفتح الطلب نفسه، والعدّاد ينقص بعد وسمه مقروءًا
  await item.click();
  await expect(page).toHaveURL(new RegExp(`#i/shams/application/${id}$`));
  // عند الصفر يختفي الجرس الأحمر (لا يُعرض «٠»)
  if (unread - 1 === 0) await expect(page.getByTestId('bell-badge')).toHaveCount(0);
  else await expect(page.getByTestId('bell-badge')).toHaveText(badgeText(unread - 1));
  expect((await imcApi.get('/notifications/unread-count')).unread).toBe(unread - 1);

  // المصنع الآخر لا يرى شيئًا من هذا في صندوقه
  const otherItems = (await other.get('/notifications?pageSize=100')).items as Array<{ applicationId: string | null }>;
  expect(otherItems.some((i) => i.applicationId === id)).toBe(false);
});

test('unread-only filter, mark all read hides the badge, and the empty state is honest', async ({ page, request }) => {
  const imcApi = await apiLogin(request, 'imc2@shams.local');
  await login(page, 'imc2@shams.local');
  await open(page, '#notifications');
  await page.getByTestId('read-all').click();
  await expect(page.getByTestId('bell-badge')).toHaveCount(0);
  expect((await imcApi.get('/notifications/unread-count')).unread).toBe(0);
  await expect(page.getByTestId('read-all')).toBeDisabled();
  await page.getByTestId('unread-only').check();
  await expect(page.getByText('لا توجد إشعارات غير مقروءة')).toBeVisible();
  await page.getByTestId('unread-only').uncheck();
  await expect(page.getByTestId('inbox-list')).toBeVisible();           // المقروء ما زال محفوظًا
});

test('every role has a bell, and a signed-out visitor is sent to sign in', async ({ browser }) => {
  for (const email of ['factory2@shams.local', 'pmu@shams.local', 'admin@shams.local']) {
    const p = await (await browser.newContext()).newPage();
    await login(p, email);
    await expect(p.getByTestId('bell')).toBeVisible();
    await p.getByTestId('bell').click();
    await expect(p).toHaveURL(/#i\/shams\/notifications/);
    await expect(p.getByRole('heading', { level: 1 })).toContainText('الإشعارات');
  }
  const guest = await (await browser.newContext()).newPage();
  await guest.goto('/#i/shams/notifications');
  await expect(guest.getByText('يجب تسجيل الدخول')).toBeVisible();
  await expect(guest.getByTestId('bell')).toHaveCount(0);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test('the bell is reachable on a phone (in the initiative bar) and the page has no horizontal scroll', async ({ page }) => {
    await login(page, 'factory2@shams.local');
    await page.getByTestId('initiative-bar').getByTestId('bell').click();
    await expect(page).toHaveURL(/#i\/shams\/notifications/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.afterAll(async ({ request }) => {
  for (const email of ['factory@shams.local', 'factory2@shams.local']) await closeOpenApplication(await apiLogin(request, email));
});
