import { closeDb, getDb } from './sqlite.js';

getDb();
closeDb();
console.log('[migrate] done');
