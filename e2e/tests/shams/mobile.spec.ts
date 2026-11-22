// شاشات المصنع على الموبايل: بلا تمرير أفقي، والقائمة الجانبية تعمل، والمعالج قابل للاستخدام.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('factory screens work on a phone', async ({ page }) => {
  await page.goto('/#i/shams/home');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  await login(page, 'factory2@shams.local');
  await expect(page).toHaveURL(/#i\/shams\/factory-dashboard/);
  await noHorizontalScroll(page);
  await page.getByTestId('start-application').click();
  await expect(page).toHaveURL(/#i\/shams\/apply\//);
  await expect(page.locator('#f-companyName')).toBeVisible();
  // M13: «الخطوة 1 من 5» ظاهرة على الموبايل بدل اسم التبويب المقصوص
  await expect(page.getByTestId('wizard-mobile-label')).toBeVisible();
  await expect(page.getByTestId('wizard-mobile-label')).toContainText('الخطوة ١ من ٥');
  await noHorizontalScroll(page);
  await page.locator('#f-governorate').selectOption('giza');
  await page.locator('#f-industrialZone').selectOption('6th-october');
  await page.getByTestId('wizard-next').click();
  await expect(page.locator('#f-contactTitle')).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'القائمة' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
