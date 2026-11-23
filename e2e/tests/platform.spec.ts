// Platform journeys across initiatives (demo seed, password Mobadrat@2026).
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'Mobadrat@2026';

async function signIn(page: Page, email: string) {
  await page.goto('/#login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('button.btn-primary').click();
  await expect(page).not.toHaveURL(/#login$/);
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test('guest: the catalog lists both initiatives, each with its page and its own registration', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/#initiatives');
  await expect(page.getByText('شمس الصناعة').first()).toBeVisible();
  await expect(page.getByText('صُنّاع المستقبل').first()).toBeVisible();

  // The initiative's page carries its full details; a guest applying goes to the initiative's own registration form.
  await page.goto('/#initiative/sona3');
  await expect(page.getByText('رحلة مشروعك: من الفكرة إلى التشغيل')).toBeVisible();
  await page.getByTestId('initiative-apply').last().click();
  await expect(page).toHaveURL(/#i\/sona3\/register/);
  await expect(page.locator('.theme-sona3')).toBeVisible();

  // The initiative module (lazy chunk, own theme) and its registration form, without signing in.
  await page.goto('/#i/shams/register');
  await expect(page.getByText('تسجيل مصنع في مبادرة شمس الصناعة')).toBeVisible();
  await expect(page.locator('.theme-shams')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a registered user applies to a second initiative: only the missing data is asked, then prefilled in the file', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, 'factory@shams.local');
  // One initiative → straight into its dashboard.
  await expect(page).toHaveURL(/#i\/shams\//);

  await page.goto('/#initiative/sona3');
  await page.getByTestId('initiative-apply').first().click();
  await expect(page).toHaveURL(/#apply\/sona3/);

  const fill = async (label: string, value: string) => {
    const input = page.locator('.pf-field', { hasText: label }).first().locator('input, textarea, select').first();
    if (await input.evaluate((el) => el.tagName) === 'SELECT') await input.selectOption(value);
    else await input.fill(value);
  };
  await fill('الرقم القومي', '30001010112345');
  await fill('تاريخ الميلاد', '2000-01-01');
  await fill('الجنسية', 'egyptian');
  await fill('محافظة الإقامة', 'giza');
  await fill('العنوان', 'شارع الهرم، الجيزة');
  await fill('المؤهل الدراسي', 'بكالوريوس هندسة ميكانيكية');
  await fill('الخبرات العملية', 'خمس سنوات في خطوط الإنتاج');
  await page.getByText('حفظ البيانات').click();

  const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'national-id.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  await page.locator('.pf-doc', { hasText: 'صورة الرقم القومي' }).locator('input[type=file]').setInputFiles(pdf);

  const open = page.getByText('فتح ملف التقديم والمتابعة');
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page).toHaveURL(/#i\/sona3\/apply\//);
  await expect(page.locator('.theme-sona3')).toBeVisible();
  // The shared profile prefilled the initiative's own form.
  await expect.poll(() => page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain('30001010112345');

  // Two initiatives now → the chooser lists both.
  await page.goto('/#hub');
  await expect(page.getByText('شمس الصناعة').first()).toBeVisible();
  await expect(page.getByText('صُنّاع المستقبل').first()).toBeVisible();
  await expect(page.getByText('ادخل لوحة المبادرة')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('platform administrator: unified dashboard of every initiative, and entry into each module', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, 'admin@mobadrat.local');
  await page.goto('/#admin');
  await expect(page.getByText('شمس الصناعة').first()).toBeVisible();
  await expect(page.getByText('صُنّاع المستقبل').first()).toBeVisible();

  await page.goto('/#admin-users');
  await expect(page.getByText('factory@shams.local')).toBeVisible();

  await page.goto('/#i/sona3/admin-dashboard');
  await expect(page.locator('.theme-sona3')).toBeVisible();
  await page.goto('/#i/shams/admin-dashboard');
  await expect(page.locator('.theme-shams')).toBeVisible();
  expect(errors).toEqual([]);
});
