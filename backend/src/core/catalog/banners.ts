/** Home-page announcement banners (public site). Ported from the platform's original store, now on MySQL. */
import { getDb, nowIso, tx } from '../db/index.js';
import { newId } from '../http/helpers.js';

export const BANNER_PLACEMENTS = ['before_about', 'before_steps', 'before_cta'] as const;
export const BANNER_LINK_TYPES = ['none', 'initiative', 'url'] as const;
export const MAX_BANNERS = 12;

export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];
export type BannerLinkType = (typeof BANNER_LINK_TYPES)[number];

export interface HomeBanner {
  id: string;
  /** Uploaded image → /api/v1/highlights/:id/image?v=… (never inside JSON); otherwise as stored. */
  imageUrl: string;
  titleAr: string; titleEn: string; subtitleAr: string; subtitleEn: string; ctaLabelAr: string; ctaLabelEn: string;
  linkType: BannerLinkType; linkTarget: string; placement: BannerPlacement; sortOrder: number; active: boolean;
  startsAt: string; endsAt: string; createdAt: string; updatedAt: string;
}

export type BannerPatch = Partial<Omit<HomeBanner, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'>>;

const WRITABLE = ['imageUrl', 'titleAr', 'titleEn', 'subtitleAr', 'subtitleEn', 'ctaLabelAr', 'ctaLabelEn', 'linkType', 'linkTarget', 'placement', 'active', 'startsAt', 'endsAt'] as const;

export function bannerImagePath(id: string, updatedAt: string): string {
  return `/api/v1/highlights/${encodeURIComponent(id)}/image?v=${encodeURIComponent(updatedAt)}`;
}

function toBanner(r: Record<string, unknown>): HomeBanner {
  const raw = String(r.imageUrl ?? '');
  return {
    id: String(r.id), imageUrl: raw.startsWith('data:') ? bannerImagePath(String(r.id), String(r.updatedAt)) : raw,
    titleAr: String(r.titleAr ?? ''), titleEn: String(r.titleEn ?? ''), subtitleAr: String(r.subtitleAr ?? ''), subtitleEn: String(r.subtitleEn ?? ''),
    ctaLabelAr: String(r.ctaLabelAr ?? ''), ctaLabelEn: String(r.ctaLabelEn ?? ''), linkType: (r.linkType as BannerLinkType) ?? 'none',
    linkTarget: String(r.linkTarget ?? ''), placement: (r.placement as BannerPlacement) ?? 'before_about', sortOrder: Number(r.sortOrder ?? 0),
    active: Number(r.active) === 1, startsAt: String(r.startsAt ?? ''), endsAt: String(r.endsAt ?? ''), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

export async function listBanners(): Promise<HomeBanner[]> {
  return (await getDb().prepare('SELECT * FROM home_banners ORDER BY sortOrder ASC, createdAt ASC').all()).map(toBanner);
}

/** Live now = active + inside the time window (ISO dates compare as text). */
export function isBannerLive(b: HomeBanner, now = nowIso()): boolean {
  return b.active && (!b.startsAt || b.startsAt <= now) && (!b.endsAt || now < b.endsAt);
}

export async function listLiveBanners(now = nowIso()): Promise<HomeBanner[]> {
  return (await listBanners()).filter((b) => isBannerLive(b, now));
}

export async function getBannerById(id: string): Promise<HomeBanner | undefined> {
  const r = await getDb().prepare('SELECT * FROM home_banners WHERE id = ?').get(id);
  return r ? toBanner(r) : undefined;
}

export async function getBannerRawImage(id: string): Promise<string | undefined> {
  const r = await getDb().prepare('SELECT imageUrl FROM home_banners WHERE id = ?').get(id) as { imageUrl: string } | undefined;
  return r?.imageUrl;
}

export async function countBanners(): Promise<number> {
  return Number((await getDb().prepare('SELECT COUNT(*) AS c FROM home_banners').get() as { c: number }).c);
}

function toColumn(field: (typeof WRITABLE)[number], v: unknown): string | number {
  return field === 'active' ? (v ? 1 : 0) : String(v ?? '');
}

export async function createBanner(patch: BannerPatch & { imageUrl: string }, id = newId('hl')): Promise<HomeBanner> {
  const db = getDb();
  const now = nowIso();
  const maxOrder = Number((await db.prepare('SELECT COALESCE(MAX(sortOrder), 0) AS m FROM home_banners').get() as { m: number }).m);
  const values = { active: true, ...patch } as Record<string, unknown>;
  const cols = WRITABLE.filter((f) => values[f] !== undefined);
  await db.prepare(`INSERT INTO home_banners (id, ${cols.join(', ')}, sortOrder, createdAt, updatedAt) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`)
    .run(id, ...cols.map((f) => toColumn(f, values[f])), maxOrder + 1, now, now);
  return (await getBannerById(id))!;
}

export async function updateBanner(id: string, patch: BannerPatch): Promise<HomeBanner | undefined> {
  const values = patch as Record<string, unknown>;
  const cols = WRITABLE.filter((f) => values[f] !== undefined);
  await getDb().prepare(`UPDATE home_banners SET ${[...cols.map((f) => `${f} = ?`), 'updatedAt = ?'].join(', ')} WHERE id = ?`)
    .run(...cols.map((f) => toColumn(f, values[f])), nowIso(), id);
  return getBannerById(id);
}

export async function deleteBanner(id: string): Promise<boolean> {
  return Number((await getDb().prepare('DELETE FROM home_banners WHERE id = ?').run(id)).changes) > 0;
}

export async function reorderBanners(ids: string[]): Promise<void> {
  await tx(async () => {
    for (let i = 0; i < ids.length; i++) await getDb().prepare('UPDATE home_banners SET sortOrder = ? WHERE id = ?').run(i + 1, ids[i]);
  });
}
