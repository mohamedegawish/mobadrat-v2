/**
 * The registered initiative modules, in order (migrations run in this order after the core; the hub and the admin list
 * them in this order). Adding an initiative = writing its module folder and adding it here (its catalog row is created
 * at boot from module.catalogDefaults).
 */
import type { InitiativeModule } from './contract.js';
import { shamsModule } from './shams/module.js';
import { sona3Module } from './sona3/module.js';

export const MODULES: InitiativeModule[] = [shamsModule, sona3Module];

export function getModule(id: string): InitiativeModule | undefined {
  return MODULES.find((m) => m.id === id);
}
