/**
 * PR-P1: bcrypt comparisons off the main thread. bcryptjs is pure JavaScript (~120 ms per comparison at 10 rounds on the
 * test machine). On the event loop — sync, or async with concurrent logins (each turn runs every pending 100 ms chunk) —
 * a burst of logins froze every other request of the server. A small fixed pool of worker threads runs the same
 * comparison (same library, same hashes) in parallel on other cores; the event loop only waits for the answer.
 * If a worker cannot be used the comparison falls back to the main thread (correctness first).
 */
import os from 'node:os';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

const bcryptPath = createRequire(import.meta.url).resolve('bcryptjs');
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const bcrypt = require(workerData.bcryptPath);
parentPort.on('message', (m) => {
  if (m.op === 'hash') {
    let hash = null;
    try { hash = bcrypt.hashSync(m.plain, m.rounds); } catch { hash = null; }
    parentPort.postMessage({ id: m.id, hash });
    return;
  }
  let ok = false;
  try { ok = bcrypt.compareSync(m.plain, m.hash); } catch { ok = false; }
  parentPort.postMessage({ id: m.id, ok });
});`;

interface Slot { worker: Worker; busy: number }
/**
 * Password workers. Default: one per core minus one, at most 4 (≈ 40 sign-ins/s at 10 bcrypt rounds on an 8-core class
 * machine — the load test's limit for a burst of sign-ins). PASSWORD_POOL_SIZE (1–32) sets it for a server with more cores.
 */
export function passwordPoolSizeFor(raw: string | undefined, cores: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 32) return n;
  return Math.max(1, Math.min(4, cores - 1));
}
const POOL_SIZE = passwordPoolSizeFor(process.env.PASSWORD_POOL_SIZE, os.availableParallelism?.() ?? os.cpus().length);
const slots: Slot[] = [];
/** A job in a worker: `settle` takes the worker's reply; `fallback` recomputes it on the main thread if the worker dies. */
interface Pending { slot: Slot; settle: (m: { ok?: boolean; hash?: string | null }) => void; fallback: () => void }
const pending = new Map<number, Pending>();
const compareHere = (plain: string, hash: string): boolean => { try { return bcrypt.compareSync(plain, hash); } catch { return false; } };
let nextId = 1;

function spawnSlot(): Slot {
  const worker = new Worker(WORKER_SRC, { eval: true, workerData: { bcryptPath }, execArgv: [] });
  const slot: Slot = { worker, busy: 0 };
  worker.on('message', (m: { id: number; ok?: boolean; hash?: string | null }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); slot.busy--; p.settle(m);
  });
  const fail = () => {
    // A dead worker: finish its in-flight comparisons on the main thread and replace it on next use.
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    for (const [id, p] of pending) if (p.slot === slot) { pending.delete(id); p.fallback(); }
  };
  worker.on('error', fail);
  worker.on('exit', fail);
  worker.unref(); // after the listeners: attaching 'message' re-refs the port, which kept test processes and CLIs alive
  return slot;
}

function pick(): Slot {
  while (slots.length < POOL_SIZE) slots.push(spawnSlot());
  return slots.reduce((a, b) => (b.busy < a.busy ? b : a));
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  let slot: Slot;
  try { slot = pick(); } catch { return Promise.resolve(compareHere(plain, hash)); }
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { slot, settle: (m) => resolve(Boolean(m.ok)), fallback: () => resolve(compareHere(plain, hash)) });
    slot.busy++;
    slot.worker.postMessage({ id, plain, hash });
  });
}

/**
 * PA-03 (2026-11-06 audit): bcrypt HASHING off the main thread too. register, reset-password and change-password called
 * bcrypt.hashSync (~120 ms at 10 rounds) on the event loop and inside the global write transaction, so each one froze every
 * other request and held every other write for that long. Same library, same rounds, same output format; if a worker
 * cannot be used (or fails) the hash is computed on the main thread (correctness first).
 */
export function hashPasswordInPool(plain: string, rounds: number): Promise<string> {
  const hashHere = () => bcrypt.hashSync(plain, rounds);
  let slot: Slot;
  try { slot = pick(); } catch { return Promise.resolve(hashHere()); }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const fallback = () => { try { resolve(hashHere()); } catch (e) { reject(e); } };
    pending.set(id, { slot, settle: (m) => (typeof m.hash === 'string' ? resolve(m.hash) : fallback()), fallback });
    slot.busy++;
    slot.worker.postMessage({ id, op: 'hash', plain, rounds });
  });
}

export const passwordPoolSize = POOL_SIZE;
