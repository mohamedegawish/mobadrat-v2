// Historical import path kept for the stores, services, scripts and tests: the database facade now lives in ./index.ts and
// selects SQLite or MySQL (DB_CLIENT). The SQLite migration runner stays synchronous on a raw node:sqlite handle.
export * from './index.js';
export { runMigrations, migrationsDir, isSqliteBusy } from './sqliteDriver.js';
export { isMysqlBusy } from './mysqlDriver.js';
