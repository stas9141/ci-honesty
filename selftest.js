#!/usr/bin/env node
const { scan } = require('./src/scan');
const path = require('path');

// Each fixture test is written to trip exactly one rule, so these numbers are the
// specification. A detector change that moves any of them has to be deliberate.
const EXPECTED_TESTS = 11;
const EXPECTED = {
  'no-assertion': 1,
  'floating-assertion': 1,
  'swallowed-assertion': 1,
  'guarded-assertion': 2,
  'silent-early-return': 1,
  'tautological-matcher': 2,
  'silent-fallback': 2,
  'disabled-test': 1,
};

const result = scan(path.join(__dirname, 'fixtures'));

const actual = {};
for (const f of result.findings) actual[f.rule] = (actual[f.rule] ?? 0) + 1;

const problems = [];
if (result.testCount !== EXPECTED_TESTS) {
  problems.push(`found ${result.testCount} tests in the fixtures, expected ${EXPECTED_TESTS}`);
}
for (const rule of new Set([...Object.keys(EXPECTED), ...Object.keys(actual)])) {
  const want = EXPECTED[rule] ?? 0;
  const got = actual[rule] ?? 0;
  if (want !== got) problems.push(`${rule}: got ${got}, expected ${want}`);
}

if (problems.length > 0) {
  console.error('selftest FAILED');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`selftest passed — ${result.testCount} fixtures, ${result.findings.length} findings`);
