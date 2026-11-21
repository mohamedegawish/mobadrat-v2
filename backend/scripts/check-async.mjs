#!/usr/bin/env node
// Async-safety check for the backend (npm run lint:async). The database API is Promise-based; a missing `await` usually
// still type-checks — `x as unknown as Row`, `{ items: list.map(asyncFn) }`, `if (claim(id))` — and silently ships a Promise
// (serialised as `{}`), an always-truthy condition, or an unhandled rejection. This walks src/ and tests/ with the
// TypeScript type checker and fails on every place a Promise flows where a value was meant:
//   R1 cast:        a Promise asserted to a non-Promise type (`p as T`, `p as unknown as T`)
//   R2 sink:        a Promise (or an array/object containing one) in an object/array literal, a template, a spread, or an
//                   argument whose parameter is any/unknown/generic
//   R3 callback:    an async callback given to filter/some/every/find/findIndex/sort/forEach/reduce (always wrong), or to
//                   map when the result is not passed to Promise.all
//   R4 condition:   a Promise used as a condition, negated, compared, or as an operand of && || ??
//   R5 floating:    a Promise expression statement that is neither awaited, returned, `void`-ed nor `.catch`-ed
// Usage: node scripts/check-async.mjs [--quiet]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (p) => p.replace(/\\/g, '/');
function listTs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(norm(p));
  }
  return out;
}
const files = [...listTs(path.join(root, 'src')), ...listTs(path.join(root, 'tests'))];
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, noEmit: true, types: ['node'],
});
const checker = program.getTypeChecker();
const projectFiles = new Set(files);

function isPromiseLike(t) {
  if (!t) return false;
  if (t.isUnion()) return t.types.some(isPromiseLike);
  return Boolean(t.getProperty('then')) && Boolean(checker.getSignaturesOfType(checker.getTypeOfSymbol(t.getProperty('then')), ts.SignatureKind.Call).length);
}
function containsPromise(t, depth = 0) {
  if (!t || depth > 3) return false;
  if (isPromiseLike(t)) return true;
  if (t.isUnion() || t.isIntersection()) return t.types.some((x) => containsPromise(x, depth + 1));
  if (checker.isArrayType(t) || checker.isTupleType(t)) return checker.getTypeArguments(t).some((x) => containsPromise(x, depth + 1));
  const sym = t.getSymbol();
  if (sym && (sym.flags & ts.SymbolFlags.ObjectLiteral)) {
    return checker.getPropertiesOfType(t).some((p) => containsPromise(checker.getTypeOfSymbol(p), depth + 1));
  }
  return false;
}
const isAnyish = (t) => !t || (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0;
const typeOf = (n) => checker.getTypeAtLocation(n);
function up(n) { let p = n.parent; while (p && ts.isParenthesizedExpression(p)) p = p.parent; return p; }
function enclosingFn(n) { let p = n.parent; while (p && !ts.isSourceFile(p)) { if (ts.isFunctionLike(p)) return p; p = p.parent; } return null; }
const isAsyncFn = (f) => Boolean(f && (ts.getCombinedModifierFlags(f) & ts.ModifierFlags.Async));

const problems = [];
function report(sf, node, rule, msg) {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  problems.push(`${path.relative(root, sf.fileName)}:${line + 1}:${character + 1}  ${rule}  ${msg}  «${node.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}»`);
}

const ALWAYS_WRONG_CB = new Set(['filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'sort', 'toSorted', 'forEach', 'reduce', 'reduceRight', 'flatMap']);

function callbackReturnsPromise(arg) {
  const sigs = checker.getSignaturesOfType(typeOf(arg), ts.SignatureKind.Call);
  return sigs.some((s) => isPromiseLike(checker.getReturnTypeOfSignature(s)));
}
function insidePromiseCombinator(call) {
  const p = up(call);
  if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.expression.getText() === 'Promise'
    && ['all', 'allSettled', 'race', 'any'].includes(p.expression.name.text)) return true;
  return false;
}
const TEST_FRAMEWORK = new Set(['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach']);
/** `x == null` style existence checks on an optional Promise (`Promise<T> | null`) are not missing awaits. */
function isOptionalPromise(t) {
  return t.isUnion() && t.types.some((x) => (x.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0);
}
function handledFloating(expr) {
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) return true; // assignment
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && TEST_FRAMEWORK.has(expr.expression.text)) return true;
  // x.catch(...), x.then(a, b), void x
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const n = expr.expression.name.text;
    if (n === 'catch') return true;
    if (n === 'then' && expr.arguments.length >= 2) return true;
  }
  return false;
}

for (const sf of program.getSourceFiles()) {
  if (!projectFiles.has(norm(sf.fileName))) continue;
  const visit = (n) => {
    // R1
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const inner = n.expression;
      if (isPromiseLike(typeOf(inner)) && !isPromiseLike(typeOf(n))) report(sf, n, 'R1', 'Promise cast to a non-Promise type (missing await?)');
    }
    // R3
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      const recvT = typeOf(n.expression.expression);
      if ((checker.isArrayType(recvT) || checker.isTupleType(recvT) || /^(Readonly)?Array<|\[\]$/.test(checker.typeToString(recvT))) && n.arguments[0]) {
        if (ALWAYS_WRONG_CB.has(m) && callbackReturnsPromise(n.arguments[0])) report(sf, n, 'R3', `async callback given to .${m}() — use a for loop / filterSeq`);
        if (m === 'map' && callbackReturnsPromise(n.arguments[0]) && !insidePromiseCombinator(n)) report(sf, n, 'R3', 'async callback given to .map() without Promise.all — use mapSeq');
      }
    }
    if (ts.isExpression(n) && !ts.isParenthesizedExpression(n)) {
      const t = typeOf(n);
      const p = up(n);
      if (p && isPromiseLike(t)) {
        // R4
        if (!isOptionalPromise(t) && ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isConditionalExpression(p)) && p.expression === n
          || (ts.isConditionalExpression(p) && p.condition === n)
          || (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken)
          || (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
            ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
            ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
            ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(p.operatorToken.kind) && (p.left === n || p.right === n)))) {
          report(sf, n, 'R4', 'Promise used as a condition / operand (missing await?)');
        }
        // R5
        if (ts.isExpressionStatement(p) && !handledFloating(n)) report(sf, n, 'R5', 'floating Promise (await it, return it, or `void … .catch()`)');
      }
      // R2
      if (p && containsPromise(t)) {
        let sink = false;
        if (ts.isPropertyAssignment(p) && p.initializer === n) sink = !containsPromise(checker.getContextualType(n) ?? t) || isAnyish(checker.getContextualType(n));
        else if (ts.isShorthandPropertyAssignment(p)) sink = isAnyish(checker.getContextualType(p.name));
        else if (ts.isArrayLiteralExpression(p)) sink = !insidePromiseCombinator(p) && isAnyish(checker.getContextualType(n));
        else if (ts.isTemplateSpan(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) sink = true;
        else if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
          const ctx = checker.getContextualType(n);
          sink = isAnyish(ctx) || (ctx && !containsPromise(ctx));
          if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.expression.getText() === 'Promise') sink = false;
          if (ts.isCallExpression(p) && /^(assert\.(rejects|doesNotReject)|mapSeq|filterSeq)$/.test(p.expression.getText())) sink = false;
        }
        if (sink) report(sf, n, 'R2', 'Promise (or a value containing one) flows into a non-Promise slot (missing await?)');
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`check-async: ${unique.length} problem(s)`);
  for (const p of unique) console.error(`  ${p}`);
  process.exit(1);
}
if (!process.argv.includes('--quiet')) console.log(`check-async OK (${files.length} files)`);
