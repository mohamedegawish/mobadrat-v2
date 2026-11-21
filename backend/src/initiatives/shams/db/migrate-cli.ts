import { closeDb, dbDialect, initDb } from './sqlite.js';

// Applies pending migrations (SQLite: src/db/migrations, MySQL: src/db/migrations-mysql) and exits.
await initDb();
console.log(`[migrate] ${dbDialect()} schema is up to date`);
await closeDb();
console.log('[migrate] done');
