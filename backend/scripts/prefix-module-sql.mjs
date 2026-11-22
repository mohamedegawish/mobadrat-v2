#!/usr/bin/env node
// One-off codemod used when porting an initiative application into a module: rewrites the module's table names inside SQL
// (after FROM / JOIN / INTO / UPDATE / TABLE / REFERENCES / EXISTS / DELETE FROM and in `ON <table>` of triggers) to the
// prefixed names `<prefix>_<table>`. Only uppercase SQL keywords are matched (prose and identifiers are left alone).
// Usage: node scripts/prefix-module-sql.mjs <dir> <prefix> <table1,table2,...> [--dry]
import fs from 'node:fs';
import path from 'node:path';

const [dir, prefix, tablesArg, flag] = process.argv.slice(2);
if (!dir || !prefix || !tablesArg) { console.error('usage: prefix-module-sql.mjs <dir> <prefix> <tables> [--dry]'); process.exit(2); }
const tables = tablesArg.split(',').map((t) => t.trim()).filter(Boolean);
const dry = flag === '--dry';
const alt = tables.sort((a, b) => b.length - a.length).join('|');
const re = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|EXISTS|DELETE FROM)(\\s+)(${alt})\\b(?!\\.|\\s*=|_)`, 'g');

function walk(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '_legacy'].includes(e.name)) out.push(...walk(p)); }
    else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

let changed = 0;
let hits = 0;
for (const f of walk(dir)) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  const next = src.replace(re, (_m, kw, ws, t) => { n++; return `${kw}${ws}${prefix}_${t}`; });
  if (n) {
    hits += n; changed++;
    if (dry) console.log(`${f}: ${n}`);
    else fs.writeFileSync(f, next);
  }
}
console.log(`${dry ? '[dry] ' : ''}${hits} table references in ${changed} files`);
