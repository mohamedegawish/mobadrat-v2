// Child process for tests/35-sqlite-to-mysql: builds a realistic SQLite database through the real HTTP API (seed, a contracted
// application with documents and history, an application in review, a correction round with deficiencies, a draft, audit
// rows, notifications) and prints its location as JSON. Run with DB_CLIENT=sqlite. The parent removes the directory.
import { isolateTestEnv, startServer, clients, act, advanceTo, uploadContractFile, BANK_A } from '../helpers.js';

const env = isolateTestEnv('sqlite-fixture');
const srv = await startServer();
const c = await clients(srv.base);

const contracted = await advanceTo('CONTRACT_OUTCOME', c, 'IND-FIX-1', BANK_A);
await uploadContractFile(c.factory, contracted, 'fixture-contract');
const outcome = await act(c.factory, contracted, 'record_contract', { contractDate: '2026-10-01', contractAmount: 1250000.5, contractNotes: 'عقد تجريبي' });
if (outcome.status !== 200) throw new Error(`outcome ${outcome.status} ${JSON.stringify(outcome.json)}`);

const inReview = await advanceTo('ENCPC_REVIEW', { ...c, factory: c.factory2 }, 'IND-FIX-2');
const correction = await act(c.encpc, inReview, 'non_compliant', { deficiencies: [{ field: 'roofAreas', note: 'المساحات غير دقيقة' }] });
if (correction.status !== 200) throw new Error(`correction ${correction.status} ${JSON.stringify(correction.json)}`);

await srv.close();
const { closeDb } = await import('../../src/db/sqlite.js');
await closeDb(); // checkpoints the WAL into the main file
console.log(JSON.stringify({ dir: env.dir, dbPath: process.env.DB_PATH, uploadDir: process.env.UPLOAD_DIR, contracted, inReview }));
