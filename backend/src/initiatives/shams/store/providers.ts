/**
 * The retired provider directory (D14). Read only: applications from before the change still name the entry they chose.
 */
import { getDb } from '../db/database.js';

export interface ServiceProvider { id: string; nameAr: string; nameEn: string; contactPhone: string; contactEmail: string }

export async function getProvider(id: string): Promise<ServiceProvider | null> {
  return (await getDb().prepare('SELECT id, nameAr, nameEn, contactPhone, contactEmail FROM shams_service_providers WHERE id = ?').get(id) as unknown as ServiceProvider | undefined) ?? null;
}
