import { closeDb } from './sqlite.js';
import { seedDevData } from './seed.js';

seedDevData();
closeDb();
console.log('[seed] development data loaded (idempotent)');
