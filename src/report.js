const { RULES } = require('./detectors');

const ORDER = [
  'no-assertion',
  'floating-assertion',
  'swallowed-assertion',
  'guarded-assertion',
  'silent-early-return',
  'tautological-matcher',
  'loop-only-assertion',
  'silent-fallback',
  'assertion-in-callback',
  'conditional-skip',
  'disabled-test',
];

const EXPLANATION = {
  'no-assertion': 'Nothing is checked. The test turns red only if the code under it throws.',
  'floating-assertion': 'The assertion returns a promise nobody waits for. Current Playwright and Jest still surface the failure, but detached from the line that caused it and after the state it was checking has moved on — so the report points somewhere unhelpful.',
  'swallowed-assertion': 'A catch block absorbs the assertion error. The test cannot report the failure it just found.',
  'guarded-assertion': 'All checks hide behind an if or a loop. Whenever the condition is false, the test passes having verified nothing.',
  'silent-early-return': 'The test leaves before asserting. A missing precondition reads as success rather than as a problem.',
  'tautological-matcher': 'The matcher holds for every possible value, so no product change can break it.',
  'loop-only-assertion': 'An empty collection means zero assertions run, and nothing checks that the collection is non-empty.',
  'silent-fallback': 'A default value stands in for missing data, so the assertion passes whether or not the data arrived.',
  'assertion-in-callback': 'The assertion is inside a callback the test never waits for.',
  'conditional-skip': 'The test opts out at runtime. A broken environment shows up as a skip instead of a failure.',
  'disabled-test': 'Turned off. Counted here as coverage debt, not as a false green.',
};

function groupBy(findings, key) {
  const map = new Map();
  for (const f of findings) {
    const k = f[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  return map;
}

function summarize(result) {
  const byRule = groupBy(result.findings, 'rule');
  const cannotFail = result.findings.filter((f) => f.severity === 'cannot-fail');
  const weak = result.findings.filter((f) => f.severity === 'weak');
  const debt = result.findings.filter((f) => f.severity === 'debt');
  const affectedTests = new Set(cannotFail.map((f) => `${f.file}::${f.test}`));
  return { byRule, cannotFail, weak, debt, affectedTests };
}

function renderConsole(result) {
  const s = summarize(result);
  const lines = [];
  lines.push('');
  lines.push(`  Scanned ${result.filesParsed} source files, ${result.testFileCount} test files, ${result.testCount} tests.`);
  lines.push('');
  lines.push(`  Cannot fail : ${s.affectedTests.size} tests (${s.cannotFail.length} findings)`);
  lines.push(`  Weakened    : ${s.weak.length} findings`);
  lines.push(`  Disabled    : ${s.debt.length} findings`);
  lines.push('');
  for (const rule of ORDER) {
    const hits = s.byRule.get(rule);
    if (!hits || !hits.length) continue;
    lines.push(`  ${String(hits.length).padStart(4)}  ${rule}  —  ${RULES[rule].title}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(result, meta = {}) {
  const s = summarize(result);
  const pct = result.testCount ? Math.round((s.affectedTests.size / result.testCount) * 100) : 0;
  const out = [];
  const name = meta.name || result.root.split('/').pop();

  out.push(`# CI Honesty Report — ${name}`);
  out.push('');
  out.push(`${s.affectedTests.size} of ${result.testCount} tests (${pct}%) cannot fail, whatever the product does.`);
  out.push('');
  out.push('A test that cannot fail is worse than no test: it occupies a line in the release gate and reports green every run. This report lists them, with the file and line for each.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| | Count |');
  out.push('|---|---|');
  out.push(`| Test files scanned | ${result.testFileCount} |`);
  out.push(`| Tests found | ${result.testCount} |`);
  out.push(`| **Tests that cannot fail** | **${s.affectedTests.size}** |`);
  out.push(`| Assertions weakened but alive | ${s.weak.length} |`);
  out.push(`| Disabled tests | ${s.debt.length} |`);
  out.push('');

  out.push('## Findings by type');
  out.push('');
  out.push('| Rule | Findings | What it means |');
  out.push('|---|---|---|');
  for (const rule of ORDER) {
    const hits = s.byRule.get(rule);
    if (!hits || !hits.length) continue;
    out.push(`| \`${rule}\` | ${hits.length} | ${RULES[rule].title} |`);
  }
  out.push('');

  for (const rule of ORDER) {
    const hits = s.byRule.get(rule);
    if (!hits || !hits.length) continue;
    out.push(`## ${RULES[rule].title}`);
    out.push('');
    out.push(`\`${rule}\` · ${hits.length} finding${hits.length === 1 ? '' : 's'} · severity: ${RULES[rule].severity}`);
    out.push('');
    out.push(EXPLANATION[rule]);
    out.push('');
    const shown = hits.slice(0, meta.perRuleLimit || 25);
    for (const f of shown) {
      out.push(`**\`${f.file}:${f.line}\`**${f.test ? ` — _${f.test}_` : ''}`);
      out.push('');
      out.push('```js');
      out.push(f.snippet);
      out.push('```');
      out.push('');
      out.push(f.detail);
      out.push('');
    }
    if (hits.length > shown.length) {
      out.push(`_…and ${hits.length - shown.length} more of the same kind._`);
      out.push('');
    }
  }

  out.push('## How this was produced');
  out.push('');
  out.push('Static analysis of the test sources with the TypeScript parser. No test was executed and no code left this machine. Each finding is a structural property of the test: an assertion that is never awaited, a matcher that holds for every value, a catch that absorbs the failure. Helper functions are followed across files, so a test that asserts through a page object or workflow is not reported as assertion-free.');
  out.push('');
  return out.join('\n');
}

module.exports = { renderConsole, renderMarkdown, summarize };
