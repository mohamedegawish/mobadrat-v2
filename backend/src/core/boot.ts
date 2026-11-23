/**
 * Boot steps shared by the server, the CLIs and the tests: migrations (core + modules), reference data, the catalog rows
 * of the registered modules, module boot hooks and mail resolvers. Idempotent.
 */
import { initDb, setMigrationSets } from './db/index.js';
import { seedReferenceData } from './reference/referenceSeed.js';
import { createCatalogItem, getCatalogByModule, syncUneditedCatalogRow } from './catalog/initiatives.js';
import { MODULES } from '../initiatives/registry.js';

let mailRegistered = false;

export function registerModuleMigrations(): void {
  setMigrationSets(MODULES.map((m) => m.migrations));
}

export async function bootPlatform(): Promise<void> {
  registerModuleMigrations();
  await initDb();
  const r = await seedReferenceData();
  if (r && (r.inserted || r.updated || r.deactivated)) console.log(`[reference-seed] industrial zones: +${r.inserted} inserted, ${r.updated} updated, ${r.deactivated} deactivated`);
  for (const m of MODULES) {
    if (!(await getCatalogByModule(m.id))) {
      await createCatalogItem({ ...m.catalogDefaults, id: m.id, moduleId: m.id, titleAr: m.catalogDefaults.titleAr, slug: m.catalogDefaults.slug });
      console.log(`[catalog] created the catalog page of module ${m.id}`);
    } else if (await syncUneditedCatalogRow(m.id, m.catalogDefaults)) {
      console.log(`[catalog] updated the (never edited) catalog page of module ${m.id} to its built-in content`);
    }
    await m.onBoot?.();
  }
  if (!mailRegistered) {
    for (const m of MODULES) m.registerMail?.();
    mailRegistered = true;
  }
}
