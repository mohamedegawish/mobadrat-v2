// Sona'a El-Mostaqbal journeys on the platform. The old standalone app had no browser suite; the reference journey is its
// docs/ACCOUNTS.md «تجربة رحلة كاملة» and docs/ROLES_AND_WORKFLOW.md (the same path as the backend 01-full-journey test).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { latestMailFor, pdfFile } from '../support/platform';

export * from '../support/platform';

/** Opens a Sona3 screen (#view → #i/sona3/view) and reloads (the same hash does not fire hashchange). */
export async function open(page: Page, hash: string) {
  await page.goto(`/#i/sona3/${hash.replace(/^#/, '')}`);
  await page.reload();
}

/** A structurally valid national ID for a birth date (governorate 01 = Cairo), as the backend tests build it. */
export function nationalIdFor(birthDate: string, seq: number): string {
  const year = Number(birthDate.slice(0, 4));
  const c = year >= 2000 ? '3' : '2';
  return `${c}${birthDate.slice(2, 4)}${birthDate.slice(5, 7)}${birthDate.slice(8, 10)}01${String(seq % 10000).padStart(4, '0')}1`;
}

export async function apiState(request: APIRequestContext, token: string, appId: string): Promise<string> {
  const r = await request.get(`/api/v1/i/sona3/applications/${appId}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).data?.state as string;
}

export async function expectState(request: APIRequestContext, token: string, appId: string, state: string) {
  await expect.poll(() => apiState(request, token, appId), { timeout: 15_000, message: `application ${appId} → ${state}` }).toBe(state);
}

/**
 * Runs an action from «الإجراءات المتاحة»: its button, then the dialog's extra fields (filled by `fill`), then «تأكيد».
 * The staff page re-renders with the new state.
 */
export async function act(page: Page, label: string, fill?: (dialog: ReturnType<Page['locator']>) => Promise<void>) {
  await page.locator('.card.actions').getByRole('button', { name: label, exact: true }).click();
  const dialog = page.locator('.modal-back[role=dialog]');
  await expect(dialog).toBeVisible();
  if (fill) await fill(dialog);
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await expect(dialog).toHaveCount(0);
}

// ── the dynamic form (auto-saved per field: text on blur, selects/radios/checkboxes on change) ──

export async function tab(page: Page, name: string) {
  await page.locator('nav.dtabs button.dtab', { hasText: name }).click();
}

export async function text(page: Page, key: string, value: string | number) {
  const el = page.locator(`#fld-${key}`);
  await el.fill(String(value));
  await el.blur();
}

export async function choose(page: Page, key: string, value: string) {
  await page.locator(`#fld-${key}`).selectOption(value);
}

export async function yesNo(page: Page, key: string, yes: boolean) {
  await page.locator(`input[type=radio][name="fld-${key}"]`).nth(yes ? 0 : 1).check();
}

/** A table field: one «+ إضافة صف» per row, then each cell by its accessible name («<column> — صف <n>»). */
export async function tableRows(page: Page, fieldLabel: string, rows: Array<Record<string, string | number>>) {
  const field = page.locator('.fld', { has: page.locator('label', { hasText: fieldLabel }) }).first();
  for (let i = 0; i < rows.length; i++) {
    // Each cell is saved on blur and the saved table re-renders the field: add the next row once the last save landed.
    await page.waitForLoadState('networkidle');
    const firstCell = page.getByLabel(`${Object.keys(rows[i])[0]} — صف ${i + 1}`, { exact: true });
    await expect(async () => {
      if (!(await firstCell.count())) await field.getByRole('button', { name: /إضافة صف/ }).click();
      await expect(firstCell).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    for (const [column, value] of Object.entries(rows[i])) {
      const cell = page.getByLabel(`${column} — صف ${i + 1}`, { exact: true });
      await cell.fill(String(value));
      await cell.blur();
    }
  }
}

export async function upload(page: Page, key: string, name: string) {
  await page.locator(`#file-${key}`).setInputFiles(pdfFile(name));
  await expect(page.getByText(name).first()).toBeVisible();
}

/** Lets the last auto-saves land before the next step. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
}

// ── API preparation for branch scenarios (the branch itself is driven through the screens) ──

export interface ApiSession {
  token: string;
  get: (p: string) => Promise<any>;
  post: (p: string, body?: unknown) => Promise<{ status: number; json: any }>;
  put: (p: string, body: unknown) => Promise<{ status: number; json: any }>;
}

export async function apiSession(request: APIRequestContext, email: string, password: string): Promise<ApiSession> {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!r.ok()) throw new Error(`api login ${email}: ${r.status()}`);
  const token = (await r.json()).data.accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const base = '/api/v1/i/sona3';
  return {
    token,
    get: async (p) => (await (await request.get(`${base}${p}`, { headers })).json()).data,
    post: async (p, body = {}) => { const x = await request.post(`${base}${p}`, { headers, data: body }); return { status: x.status(), json: await x.json() }; },
    put: async (p, body) => { const x = await request.put(`${base}${p}`, { headers, data: body }); return { status: x.status(), json: await x.json() }; },
  };
}

/** A brand-new applicant: the initiative's registration + the activation link from the e-mail (via the API). */
export async function newApplicant(request: APIRequestContext, tag: string): Promise<{ email: string; password: string; s: ApiSession }> {
  const email = `e2e.${tag}.${Date.now()}@test.local`;
  const password = 'Founder2026';
  const reg = await request.post('/api/v1/i/sona3/public/register', { data: { fullName: 'متقدم سيناريو فرعي', email, mobile: '01077778888', password } });
  expect(reg.status(), await reg.text()).toBe(201);
  const token = /#verify-email\/([a-f0-9]{64})/.exec(await latestMailFor(email))?.[1];
  expect((await request.post('/api/v1/auth/verify-email', { data: { token } })).status()).toBe(200);
  return { email, password, s: await apiSession(request, email, password) };
}

/** A complete application submitted to IMC (ELIGIBILITY_REVIEW); returns its id. */
export async function submittedApplication(request: APIRequestContext, a: { email: string; s: ApiSession }, seq: number): Promise<string> {
  const created = await a.s.post('/applications', {});
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const id = created.json.data.id as string;
  const birthDate = '1997-06-15';
  const sections: Record<string, Record<string, unknown>> = {
    personal: {
      fullName: 'متقدم سيناريو فرعي', nationalId: nationalIdFor(birthDate, seq), birthDate, nationality: 'egyptian', governorate: 'giza',
      address: 'شارع الهرم، الجيزة', phone: '01077778888', email: a.email, qualification: 'دبلوم صناعي', experience: 'ثلاث سنوات في ورشة تشغيل',
    },
    team: { applicationType: 'individual' },
    project: { projectName: 'ورشة تشغيل معادن', sector: 'manufacturing', projectStage: 'new_idea', projectGovernorate: 'giza', projectLocation: 'أبو رواش' },
    idea: { ideaDescription: 'تشغيل قطع معدنية بالطلب للمصانع', problem: 'طول زمن التوريد', targetCustomers: 'مصانع المنطقة', competitiveAdvantage: 'سرعة التنفيذ' },
    readiness: { startTimeline: 'immediate', estimatedCost: 400000, requestedFunding: 250000, hasOwnFunding: false },
    declarations: { declTermsRead: true, declDataTrue: true, declConfidentiality: true, declParticipation: true },
  };
  for (const [section, data] of Object.entries(sections)) {
    const r = await a.s.put(`/applications/${id}/data/${section}`, data);
    expect(r.status, `${section}: ${JSON.stringify(r.json)}`).toBe(200);
  }
  const up = await request.post(`/api/v1/i/sona3/applications/${id}/documents`, {
    headers: { Authorization: `Bearer ${a.s.token}` }, multipart: { kind: 'nationalIdFile', file: pdfFile('nid.pdf') },
  });
  expect(up.status(), await up.text()).toBe(201);
  const app = await a.s.get(`/applications/${id}`);
  const sub = await a.s.post(`/applications/${id}/actions/submit`, { expectedVersion: app.version });
  expect(sub.status, JSON.stringify(sub.json)).toBe(200);
  return id;
}
