// One dashboard per user type for every initiative (#workspace/<type>): the shared IMC account (IMC in Shams and in Sona3)
// sees both initiatives on one page, narrows to one, opens a row in its initiative; old module links land on the same filter.
import { test, expect } from '@playwright/test';
import { login } from './support/platform';

test('the shared IMC account: one IMC dashboard for both initiatives, filter by initiative, old links land on the same filter', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'imc@mobadrat.local');
  await expect(page).toHaveURL(/#workspace\/imc/);
  await expect(page.getByRole('heading', { name: 'لوحة مركز تحديث الصناعة (IMC)' })).toBeVisible();
  await expect(page.getByTestId('ini-shams')).toBeVisible();
  await expect(page.getByTestId('ini-sona3')).toBeVisible();
  await expect(page.getByTestId('scope-all')).toHaveClass(/active/);
  await expect(page.getByTestId('awaiting-me')).toContainText('شمس الصناعة');      // each initiative's share of the headline
  await expect(page.getByTestId('tab-mine')).toHaveClass(/active/);

  await page.getByTestId('scope-sona3').click();
  await expect(page).toHaveURL(/i=sona3/);
  await expect(page.getByTestId('ini-shams')).toHaveCount(0);
  await expect(page.getByTestId('filter-state')).toBeVisible();                    // a state filter belongs to one initiative
  await page.getByTestId('tab-monitoring').click();
  await expect(page.getByTestId('block-funnel')).toBeVisible();

  // the sidebar lists the tools of each initiative
  const side = page.getByTestId('workspace-sidebar');
  await expect(side.getByRole('link', { name: 'ترتيب الدورة' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'الموافقات' })).toBeVisible();

  // old links of the modules land on the same filter of this dashboard
  await page.goto('/#i/shams/work-queue/IMC_CORRECTION');
  await expect(page).toHaveURL(/#workspace\/imc\?i=shams/);
  await expect(page.getByTestId('tab-all')).toHaveClass(/active/);
  await expect(page.getByTestId('filter-state')).toHaveValue('IMC_CORRECTION');
  await page.goto('/#i/sona3/monitoring');
  await expect(page).toHaveURL(/#workspace\/imc\?i=sona3&tab=monitoring/);
  await expect(page.getByTestId('tab-monitoring')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

for (const [email, type] of [['funder@sona3.local', 'funder'], ['evaluator1@sona3.local', 'evaluator'], ['admin@sona3.local', 'system_admin'], ['encpc@shams.local', 'encpc']] as const) {
  test(`${type}: lands on its own dashboard`, async ({ page }) => {
    await login(page, email);
    await expect(page).toHaveURL(new RegExp(`#workspace/${type}`));
    await expect(page.getByTestId('role-dashboard')).toBeVisible();
    await expect(page.getByTestId('dash-kpis')).toBeVisible();
  });
}

test('a person without a work dashboard is not offered one', async ({ page }) => {
  await login(page, 'applicant@sona3.local');
  await expect(page).not.toHaveURL(/#workspace/);
  await page.goto('/#workspace/imc');
  await expect(page.getByTestId('no-workspace')).toBeVisible();
});
