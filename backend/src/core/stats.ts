/**
 * Unified statistics: every initiative module reports a normalized summary (InitiativeStatsProvider); the platform admin
 * shows them side by side and summed. Cached in memory for 60 s (the dashboards poll; the numbers are not transactional).
 */
import { MODULES } from '../initiatives/registry.js';
import { NORMALIZED_PHASES, type NormalizedPhase, type StatsSummary } from '../initiatives/contract.js';
import { getCatalogByModule } from './catalog/initiatives.js';
import { getDb } from './db/index.js';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearStatsCache(): void { cache.clear(); }

export interface InitiativeStats {
  initiativeId: string; titleAr: string; titleEn: string; themeColor: string; status: string; summary: StatsSummary | null; error?: string;
}

export async function initiativeStats(id: string, f: { from?: string; to?: string } = {}): Promise<InitiativeStats | null> {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) return null;
  return cached(`one:${id}:${f.from ?? ''}:${f.to ?? ''}`, async () => {
    const cat = await getCatalogByModule(id);
    try {
      return { initiativeId: id, titleAr: cat?.titleAr ?? mod.titleAr, titleEn: cat?.titleEn ?? mod.titleEn, themeColor: String(cat?.themeColor ?? '#0B2545'), status: cat?.status ?? 'active', summary: await mod.stats.summary(f) };
    } catch (e) {
      return { initiativeId: id, titleAr: cat?.titleAr ?? mod.titleAr, titleEn: cat?.titleEn ?? mod.titleEn, themeColor: String(cat?.themeColor ?? '#0B2545'), status: cat?.status ?? 'active', summary: null, error: (e as Error).message };
    }
  });
}

export async function allStats(f: { from?: string; to?: string } = {}) {
  return cached(`all:${f.from ?? ''}:${f.to ?? ''}`, async () => {
    const items: InitiativeStats[] = [];
    for (const m of MODULES) { const s = await initiativeStats(m.id, f); if (s) items.push(s); }
    const byPhase = Object.fromEntries(NORMALIZED_PHASES.map((p) => [p, 0])) as Record<NormalizedPhase, number>;
    const totals = { applicants: 0, applications: 0, drafts: 0, open: 0, positiveOutcome: 0, negativeOutcome: 0, withdrawn: 0, overdue: 0 };
    const gov = new Map<string, number>();
    const months = new Map<string, { submitted: number; closed: number }>();
    for (const it of items) {
      const s = it.summary;
      if (!s) continue;
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += s.totals[k] ?? 0;
      for (const p of NORMALIZED_PHASES) byPhase[p] += s.byPhase[p] ?? 0;
      for (const g of s.byGovernorate) gov.set(g.governorate, (gov.get(g.governorate) ?? 0) + g.count);
      for (const t of s.timeline) {
        const cur = months.get(t.month) ?? { submitted: 0, closed: 0 };
        cur.submitted += t.submitted; cur.closed += t.closed;
        months.set(t.month, cur);
      }
    }
    const users = await getDb().prepare(`SELECT COUNT(*) AS n,
      SUM(CASE WHEN platformRole IS NOT NULL THEN 1 ELSE 0 END) AS staff FROM users`).get() as { n: number; staff: number };
    const multi = await getDb().prepare(`SELECT COUNT(*) AS n FROM (SELECT userId FROM initiative_memberships WHERE status = 'active'
      GROUP BY userId HAVING COUNT(*) > 1) x`).get() as { n: number };
    return {
      generatedAt: new Date().toISOString(),
      platform: { accounts: Number(users.n ?? 0), platformStaff: Number(users.staff ?? 0), multiInitiativeAccounts: Number(multi.n ?? 0), initiatives: items.length },
      totals, byPhase,
      byGovernorate: [...gov].map(([governorate, count]) => ({ governorate, count })).sort((a, b) => b.count - a.count),
      timeline: [...months].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
      initiatives: items,
    };
  });
}

/** Public numbers for the impact page (no per-application data). */
export async function publicImpact() {
  const all = await allStats();
  return {
    generatedAt: all.generatedAt,
    totals: { applications: all.totals.applications - all.totals.drafts, positiveOutcome: all.totals.positiveOutcome, open: all.totals.open },
    byGovernorate: all.byGovernorate,
    initiatives: all.initiatives.map((i) => ({
      initiativeId: i.initiativeId, titleAr: i.titleAr, titleEn: i.titleEn, themeColor: i.themeColor,
      applications: i.summary ? i.summary.totals.applications - i.summary.totals.drafts : 0,
      positiveOutcome: i.summary?.totals.positiveOutcome ?? 0,
      kpis: i.summary?.kpis ?? [],
    })),
  };
}
