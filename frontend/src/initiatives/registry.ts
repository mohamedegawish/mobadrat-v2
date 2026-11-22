/**
 * Initiative modules of the frontend: each is a lazily loaded chunk with its own screens, store and scoped stylesheet,
 * mounted under #i/<id>/. Keep in sync with backend/src/initiatives/registry.ts.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface ModuleEntry { id: string; titleAr: string; titleEn: string; load: LazyExoticComponent<ComponentType> }

export const MODULES: ModuleEntry[] = [
  { id: 'shams', titleAr: 'شمس الصناعة', titleEn: 'Shams El-Senaa', load: lazy(() => import('./shams')) },
  { id: 'sona3', titleAr: 'صُنّاع المستقبل', titleEn: 'Future Makers', load: lazy(() => import('./sona3')) },
];

export function moduleOf(hash: string): ModuleEntry | null {
  const m = /^#?\/?i\/([a-z0-9_-]+)(\/|$)/.exec(hash);
  return m ? MODULES.find((x) => x.id === m[1]) ?? null : null;
}
