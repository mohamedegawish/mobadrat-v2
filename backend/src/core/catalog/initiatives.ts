/**
 * The public initiatives catalog (what the public site shows). An initiative with a moduleId is run by a coded module
 * (registration, dashboards); one without is an information page only.
 */
import { getDb, nowIso, parseJson } from '../db/index.js';
import { newId } from '../http/helpers.js';

export const CATALOG_STATUSES = ['active', 'draft', 'coming_soon', 'closed', 'archived', 'completed'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

const JSON_ARRAY_FIELDS = ['targetSectors', 'targetSectorsEn', 'targetGovernorates', 'participatingOrgs', 'benefits', 'faqs', 'preEligibilityQuestions',
  'requiredDocsList', 'objectives', 'eligibilityRequirements', 'selectionCriteria', 'kpis'] as const;
const JSON_OBJECT_FIELDS = ['impactMetrics', 'financialTerms'] as const;
const TEXT_FIELDS = ['slug', 'titleAr', 'titleEn', 'taglineAr', 'taglineEn', 'descriptionAr', 'descriptionEn', 'category', 'categoryEn', 'startDate', 'endDate',
  'coverImage', 'logoImage', 'themeColor', 'accentColor', 'badgeTextAr', 'badgeTextEn', 'executionNotesAr', 'executionNotesEn'] as const;
const NUMBER_FIELDS = ['budgetTotalEGP', 'budgetAllocatedEGP', 'sortOrder'] as const;

export const EDITABLE_CATALOG_FIELDS: readonly string[] = [...TEXT_FIELDS, ...NUMBER_FIELDS, ...JSON_ARRAY_FIELDS, ...JSON_OBJECT_FIELDS, 'status', 'registrationOpen'];

export type CatalogItem = Record<string, unknown> & {
  id: string; slug: string; moduleId: string | null; titleAr: string; titleEn: string; status: CatalogStatus; registrationOpen: boolean;
};

function map(r: Record<string, unknown>, includeAdmin: boolean): CatalogItem {
  const out: Record<string, unknown> = { ...r };
  for (const f of JSON_ARRAY_FIELDS) out[f] = parseJson(r[f], []);
  for (const f of JSON_OBJECT_FIELDS) out[f] = parseJson(r[f], {});
  out.registrationOpen = Number(r.registrationOpen) === 1;
  out.budgetTotalEGP = Number(r.budgetTotalEGP ?? 0);
  out.budgetAllocatedEGP = Number(r.budgetAllocatedEGP ?? 0);
  out.sortOrder = Number(r.sortOrder ?? 0);
  if (!includeAdmin) delete out.kpis; // admin only
  return out as CatalogItem;
}

/** Public list: active / coming soon / closed / completed (never draft or archived). */
export async function listCatalog(opts: { includeHidden?: boolean; includeAdmin?: boolean } = {}): Promise<CatalogItem[]> {
  const where = opts.includeHidden ? '' : "WHERE status NOT IN ('draft','archived')";
  const rows = await getDb().prepare(`SELECT * FROM initiatives ${where} ORDER BY sortOrder, createdAt`).all();
  return rows.map((r) => map(r, Boolean(opts.includeAdmin)));
}

export async function getCatalogItem(idOrSlug: string, opts: { includeHidden?: boolean; includeAdmin?: boolean } = {}): Promise<CatalogItem | null> {
  const r = await getDb().prepare('SELECT * FROM initiatives WHERE id = ? OR slug = ? COLLATE NOCASE').get(idOrSlug, idOrSlug);
  if (!r) return null;
  if (!opts.includeHidden && ['draft', 'archived'].includes(String(r.status))) return null;
  return map(r, Boolean(opts.includeAdmin));
}

export async function getCatalogByModule(moduleId: string): Promise<CatalogItem | null> {
  const r = await getDb().prepare('SELECT * FROM initiatives WHERE moduleId = ?').get(moduleId);
  return r ? map(r, true) : null;
}

function serialise(patch: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((JSON_ARRAY_FIELDS as readonly string[]).includes(k) || (JSON_OBJECT_FIELDS as readonly string[]).includes(k)) out[k] = JSON.stringify(v ?? ((JSON_OBJECT_FIELDS as readonly string[]).includes(k) ? {} : []));
    else if (k === 'registrationOpen') out[k] = v ? 1 : 0;
    else if ((NUMBER_FIELDS as readonly string[]).includes(k)) out[k] = Number(v ?? 0);
    else if (k === 'status' || (TEXT_FIELDS as readonly string[]).includes(k)) out[k] = String(v ?? '');
  }
  return out;
}

export async function createCatalogItem(input: Record<string, unknown> & { titleAr: string; slug: string; moduleId?: string | null; id?: string }): Promise<CatalogItem> {
  const id = input.id ?? (input.moduleId ? String(input.moduleId) : newId('init'));
  const now = nowIso();
  const fields = serialise(input);
  const cols = ['id', 'moduleId', 'createdAt', 'updatedAt', ...Object.keys(fields)];
  const vals = [id, input.moduleId ?? null, now, now, ...Object.values(fields)];
  await getDb().prepare(`INSERT INTO initiatives (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  return (await getCatalogItem(id, { includeHidden: true, includeAdmin: true }))!;
}

export async function updateCatalogItem(id: string, patch: Record<string, unknown>): Promise<CatalogItem | null> {
  const fields = serialise(patch);
  if (Object.keys(fields).length) {
    await getDb().prepare(`UPDATE initiatives SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`)
      .run(...Object.values(fields), nowIso(), id);
  }
  return getCatalogItem(id, { includeHidden: true, includeAdmin: true });
}

export async function deleteCatalogItem(id: string): Promise<boolean> {
  return Number((await getDb().prepare('DELETE FROM initiatives WHERE id = ? AND moduleId IS NULL').run(id)).changes) > 0;
}
