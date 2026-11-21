/**
 * Multi-process test child for scenario 8: opens its own connection to the shared database, starts a write transaction
 * exactly like `tx()` does (BEGIN IMMEDIATE), applies the writes a real transition applies (state + version + attempt,
 * a transition row, an audit row), reports "in-tx" to the parent over IPC and then waits — the parent kills it mid-transaction.
 */
const { DatabaseSync } = await import('node:sqlite');

const appId = process.env.MP_APP_ID!;
const db = new DatabaseSync(process.env.DB_PATH!);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec('BEGIN IMMEDIATE');
const now = new Date().toISOString();
db.prepare("UPDATE applications SET state = 'IMC_REVIEW', version = version + 1, attempt = attempt + 1, number = 'CRASH-0001', updatedAt = ? WHERE id = ?").run(now, appId);
db.prepare(`INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, payload, createdAt)
  VALUES ('trn-crash-child', ?, 'DRAFT', 'IMC_REVIEW', 'submit', 'factory_owner', 1, '{}', ?)`).run(appId, now);
// Enough extra rows to make the uncommitted part span many WAL frames (not just one page).
const filler = db.prepare(`INSERT INTO audit_logs (id, actorType, action, entityType, entityId, applicationId, summaryAr, details, at)
  VALUES (?, 'system', 'mp.crash_filler', 'application', ?, ?, 'crash filler', ?, ?)`);
for (let i = 0; i < 300; i++) filler.run(`aud-crash-${i}`, appId, appId, JSON.stringify({ pad: 'x'.repeat(400), i }), now);
process.send?.({ type: 'in-tx', pid: process.pid });
setInterval(() => undefined, 1000); // stay inside the open transaction until killed
