#!/usr/bin/env node
// One-off codemod for porting a synchronous (node:sqlite) initiative application onto the platform's Promise-based MySQL
// database API. Repeats until nothing changes:
//   - every call whose type is a Promise and is not awaited (or otherwise consumed) gets `await`;
//   - the enclosing function becomes `async`, and an explicit return type T becomes Promise<T>.
// Callbacks of array methods that become async are reported (they need mapSeq/filterSeq or a for-of loop) — fix them by
// hand, then run `npm run lint:async`.
// Usage: node scripts/asyncify.mjs <dir> [--max N]
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';

const root = path.resolve(process.argv[2]);
const maxRounds = Number(process.argv[process.argv.indexOf('--max') + 1]) || 40;
const norm = (p) => p.replace(/\\/g, '/');

function listTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '_legacy'].includes(e.name)) out.push(...listTs(p)); }
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(norm(p));
  }
  return out;
}

const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, noEmit: true, types: ['node'],
};

const ARRAY_CB = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce', 'sort', 'flatMap']);

function isPromiseLike(checker, t) {
  if (!t) return false;
  if (t.isUnion()) return t.types.some((x) => isPromiseLike(checker, x));
  const then = t.getProperty('then');
  if (!then) return false;
  return checker.getSignaturesOfType(checker.getTypeOfSymbol(then), ts.SignatureKind.Call).length > 0;
}

function up(n) { let p = n.parent; while (p && ts.isParenthesizedExpression(p)) p = p.parent; return p; }
function enclosingFn(n) { let p = n.parent; while (p && !ts.isSourceFile(p)) { if (ts.isFunctionLike(p)) return p; p = p.parent; } return null; }
function isAsync(fn) { return Boolean(fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)); }

/** The Promise is consumed already: awaited, chained, voided, passed to Promise.all/race, returned from an async fn… */
function consumed(call, checker) {
  const p = up(call);
  if (!p) return true;
  if (ts.isAwaitExpression(p)) return true;
  if (ts.isVoidExpression(p)) return true;
  if (ts.isPropertyAccessExpression(p) && p.expression === call && ['then', 'catch', 'finally'].includes(p.name.text)) return true;
  // return f() / arrow body f() inside an async function: returning the promise is fine.
  const fn = enclosingFn(call);
  if (fn && isAsync(fn) && (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === call))) return true;
  // argument of Promise.all / Promise.race / mapSeq results etc.
  if (ts.isArrayLiteralExpression(p)) {
    const pp = up(p);
    if (pp && ts.isCallExpression(pp) && /^Promise\.(all|allSettled|race|any)$/.test(pp.expression.getText())) return true;
  }
  if (ts.isCallExpression(p) && p.arguments.includes(call) && /^Promise\.(all|allSettled|race|any|resolve)$/.test(p.expression.getText())) return true;
  return false;
}

function needsParens(call) {
  const p = call.parent;
  return ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) || (ts.isCallExpression(p) && p.expression === call)
    || ts.isNonNullExpression(p) || ts.isTaggedTemplateExpression(p);
}

let total = 0;
const reports = new Set();
for (let round = 1; round <= maxRounds; round++) {
  const files = listTs(root);
  const program = ts.createProgram(files, options);
  const checker = program.getTypeChecker();
  const edits = new Map(); // file → [{pos, text}] (insertions)
  const asyncFns = new Map(); // file → Set(fn)
  const fileSet = new Set(files);
  for (const sf of program.getSourceFiles()) {
    if (!fileSet.has(norm(sf.fileName))) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (ts.isCallExpression(node)) {
          const t = checker.getTypeAtLocation(node);
          if (isPromiseLike(checker, t) && !consumed(node, checker)) {
            const fn = enclosingFn(node);
            if (fn && !ts.isConstructorDeclaration(fn) && !ts.isGetAccessorDeclaration(fn) && !ts.isSetAccessorDeclaration(fn)) {
              const list = edits.get(sf.fileName) ?? []; edits.set(sf.fileName, list);
              if (needsParens(node)) {
                list.push({ pos: node.getStart(sf), text: '(await ' });
                list.push({ pos: node.getEnd(), text: ')' });
              } else {
                list.push({ pos: node.getStart(sf), text: 'await ' });
              }
              if (!isAsync(fn)) { const s = asyncFns.get(sf.fileName) ?? new Set(); asyncFns.set(sf.fileName, s); s.add(fn); }
            } else if (fn) {
              reports.add(`${norm(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} promise in constructor/accessor`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // async modifiers and return types
  for (const [file, fns] of asyncFns) {
    const sf = program.getSourceFile(file);
    const list = edits.get(file) ?? []; edits.set(file, list);
    for (const fn of fns) {
      const p = fn.parent;
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ARRAY_CB.has(p.expression.name.text) && p.arguments.includes(fn)) {
        reports.add(`${norm(file)}:${sf.getLineAndCharacterOfPosition(fn.getStart(sf)).line + 1} async callback in .${p.expression.name.text}() — use mapSeq/filterSeq or for-of`);
      }
      // insert `async` before the function keyword / parameters
      let at;
      if (ts.isArrowFunction(fn)) at = fn.getStart(sf);
      else if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
        const exportMod = fn.modifiers?.filter((m) => m.kind !== ts.SyntaxKind.AsyncKeyword) ?? [];
        at = exportMod.length ? exportMod[exportMod.length - 1].getEnd() + 1 : fn.getStart(sf);
        if (exportMod.length) { list.push({ pos: at, text: 'async ' }); at = -1; }
      } else if (ts.isMethodDeclaration(fn)) at = fn.name.getStart(sf);
      if (at !== undefined && at >= 0) list.push({ pos: at, text: 'async ' });
      if (fn.type && !/^Promise</.test(fn.type.getText(sf))) {
        list.push({ pos: fn.type.getStart(sf), text: 'Promise<' });
        list.push({ pos: fn.type.getEnd(), text: '>' });
      }
    }
  }
  let changed = 0;
  for (const [file, list] of edits) {
    if (!list.length) continue;
    let src = fs.readFileSync(file, 'utf8');
    // de-duplicate identical insertions, apply from the end
    const uniq = [...new Map(list.map((e) => [`${e.pos}:${e.text}`, e])).values()].sort((a, b) => b.pos - a.pos || (a.text === ')' ? -1 : 1));
    for (const e of uniq) src = src.slice(0, e.pos) + e.text + src.slice(e.pos);
    fs.writeFileSync(file, src);
    changed += uniq.length;
  }
  total += changed;
  console.log(`[asyncify] round ${round}: ${changed} edit(s)`);
  if (!changed) break;
}
console.log(`[asyncify] done — ${total} edit(s).`);
for (const r of [...reports].sort()) console.log(`  ! ${r}`);
