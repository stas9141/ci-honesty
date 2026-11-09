const fs = require('fs');
const path = require('path');
const { ts, parse, isTestCall, isSuiteCall, collectExternalImports } = require('./ast');
const { collectFunctions, resolveAsserting } = require('./graph');
const { analyzeTestBody } = require('./detectors');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', 'target', '.venv', 'venv', '__pycache__', 'playwright-report',
  'test-results', 'allure-results', 'allure-report', '.cache', '.turbo',
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const TYPE_TEST_FILE = /(\.test-d\.|\.type-test\.|[-.]types?\.test\.|(^|\/)type-tests?\/)/;
const TEST_FILE = /(\.|_)(spec|test)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$|(^|\/)(tests?|e2e|__tests__|cypress|specs)\//;

function walkDir(root, out, limit) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walkDir(full, out, limit);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
}

function collectFiles(target, limit) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  walkDir(target, out, limit);
  return out;
}

function findTests(sourceFile) {
  const tests = [];
  const visit = (node) => {
    const t = isTestCall(node);
    if (t && t.fn) {
      tests.push(t);
      ts.forEachChild(t.fn, visit);
      return;
    }
    if (isSuiteCall(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tests;
}

function scan(target, options = {}) {
  const limit = options.maxFiles || 20000;
  const root = path.resolve(target);
  const files = collectFiles(root, limit);

  const parsed = new Map();
  const fns = new Map();
  const readFailures = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      readFailures.push(file);
      continue;
    }
    if (text.length > 2_000_000) continue;
    const sf = parse(file, text);
    parsed.set(file, sf);
    collectFunctions(sf, fns);
  }

  const assertingFunctions = resolveAsserting(fns);

  const findings = [];
  let testCount = 0;
  const testFiles = [];

  for (const [file, sf] of parsed) {
    const rel = path.relative(root, file) || path.basename(file);
    const relPosix = rel.split(path.sep).join('/');
    if (TYPE_TEST_FILE.test(relPosix)) continue;
    if (!TEST_FILE.test(relPosix)) continue;
    const tests = findTests(sf);
    if (!tests.length) continue;
    testFiles.push(rel);
    const usesPlaywright = /@playwright\/test|playwright-core/.test(sf.text);
    const externalNames = collectExternalImports(sf);
    for (const test of tests) {
      testCount += 1;
      const ctx = { assertingFunctions, usesPlaywright, externalNames };
      const results = analyzeTestBody(sf, test, ctx);
      for (const r of results) {
        r.file = rel;
        findings.push(r);
      }
    }
  }

  return {
    root,
    filesParsed: parsed.size,
    testFileCount: testFiles.length,
    testCount,
    findings,
    readFailures,
  };
}

module.exports = { scan };
