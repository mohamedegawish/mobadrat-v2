import { closeDb } from './sqlite.js';
import { seedDevData } from './seed.js';

await seedDevData();
await closeDb();
console.log('[seed] development data loaded (idempotent)');
