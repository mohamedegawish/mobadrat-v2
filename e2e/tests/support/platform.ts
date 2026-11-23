// What every initiative journey needs from the platform: the captured inbox (backend/scripts/e2e-server.ts writes every
// e-mail to E2E_MAIL_DIR), the platform sign-in (one account for every initiative), activation links, test PDFs, and the API.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** The demo seed password of every seeded account (platform and initiatives). */
export const PASSWORD = 'Mobadrat@2026';
export const MAIL_DIR = process.env.E2E_MAIL_DIR ?? path.join(os.tmpdir(), 'mobadrat-e2e-mail');

/** ملف PDF صغير صالح (magic bytes %PDF-) لاختبارات الرفع. */
export function pdfFile(name: string) {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${name}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`) };
}

/** آخر بريد مرسل لعنوان معين. */
export async function latestMailFor(email: string): Promise<string> {
  const safe = email.replace(/[^\w.@-]/g, '_');
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.includes(safe)).sort() : [];
    if (files.length) return fs.readFileSync(path.join(MAIL_DIR, files[files.length - 1]), 'utf8');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email for ${email} in ${MAIL_DIR}`);
}

/** عدد الرسائل المرسلة لعنوان معين حتى الآن (تُكتب في الخلفية — انتظر عددها قبل قراءة آخرها). */
export function mailCountFor(email: string): number {
  const safe = email.replace(/[^\w.@-]/g, '_');
  return fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.includes(safe)).length : 0;
}

/** آخر بريد للعنوان يطابق نصًا (إيميلات القرار). */
export async function mailMatching(email: string, re: RegExp): Promise<string> {
  const safe = email.replace(/[^\w.@-]/g, '_');
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.includes(safe)).sort().reverse() : [];
    for (const f of files) { const body = fs.readFileSync(path.join(MAIL_DIR, f), 'utf8'); if (re.test(body)) return body; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email matching ${re} for ${email}`);
}

/** Platform sign-in form (any previous session of the page is dropped first). */
export async function submitPlatformLogin(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/#login');
  await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
  await page.reload();
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button.btn-primary').click();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await submitPlatformLogin(page, email, password);
  await expect(page).not.toHaveURL(/#login$/);
}

export async function asRole(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email, password);
  return page;
}

/** The activation link of the latest e-mail, opened on the platform page; returns whether an initiative submitted something. */
export async function activateFromMail(page: Page, email: string): Promise<void> {
  const token = /#verify-email\/([a-f0-9]{64})/.exec(await latestMailFor(email))?.[1];
  expect(token, 'activation link in the email').toBeTruthy();
  await page.goto(`/#verify-email/${token}`);
  await expect(page.getByTestId('verify-ok')).toBeVisible();
}

export async function apiToken(request: APIRequestContext, email: string, password = PASSWORD): Promise<string> {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(r.status(), `api login ${email}`).toBe(200);
  return (await r.json()).data.accessToken as string;
}

/** A stage screenshot for the journey report (only when JOURNEY_SHOTS names a folder; normal runs skip it). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.JOURNEY_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}
