/**
 * The registered initiative modules, in order (migrations run in this order after the core; the hub and the admin list
 * them in this order). Adding an initiative = writing its module folder and adding it here + a catalog row (moduleId).
 */
import type { InitiativeModule } from './contract.js';

export const MODULES: InitiativeModule[] = [];

export function getModule(id: string): InitiativeModule | undefined {
  return MODULES.find((m) => m.id === id);
}
