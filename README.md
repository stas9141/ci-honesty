# ci-honesty

Finds tests that cannot fail.

Such a test still runs, still costs time in CI, and still goes green while the product is
broken. This tool reads your test sources and tells you which ones they are.

## Install

```bash
git clone https://github.com/stas9141/ci-honesty.git
cd ci-honesty
npm install
```

Node 18 or newer. The only dependency is the TypeScript compiler, used as a parser.

## Use

```bash
node bin/ci-honesty.js <path-to-repo>
```

Add `--md report.md` for a written report with file, line and snippet for every finding,
or `--json findings.json` if you want to feed it to something else.

No test is ever executed — the tool parses source files and nothing more, so running it
against a repository you don't own is harmless.

Output looks like this:

```
  Scanned 1535 source files, 148 test files, 1996 tests.

  Cannot fail : 67 tests (81 findings)
  Weakened    : 60 findings
  Disabled    : 88 findings

    19  floating-assertion  —  Assertion is never awaited
    40  guarded-assertion  —  Every assertion sits behind a condition
    19  silent-early-return  —  Test returns early and passes
    17  loop-only-assertion  —  Assertions run only inside a loop that may be empty
    40  silent-fallback  —  Asserted value has a literal fallback
     2  swallowed-assertion  —  Assertion failure is swallowed by catch
```

## Rules

| Rule | Severity | What it means |
|---|---|---|
| `no-assertion` | cannot-fail | No assertion, directly or through a helper that asserts |
| `floating-assertion` | weak | An assertion nobody awaits — still reported, but attributed to the wrong place |
| `swallowed-assertion` | cannot-fail | A catch block absorbs the assertion error |
| `guarded-assertion` | cannot-fail | Every assertion sits behind a condition |
| `silent-early-return` | cannot-fail | The test returns before asserting and still passes |
| `tautological-matcher` | cannot-fail | The matcher holds for every possible value |
| `loop-only-assertion` | weak | Assertions run only inside a loop that may be empty |
| `silent-fallback` | weak | A literal default stands in for missing data |
| `assertion-in-callback` | weak | The assertion is inside a listener that may never run |
| `conditional-skip` | debt | The test opts out at runtime |
| `disabled-test` | debt | Turned off |

Works on Playwright, Jest, Vitest and Mocha suites in JavaScript or TypeScript.

## False positives

This is the part that decides whether the tool is worth running. A list full of wrong
answers is worse than no list, because somebody has to read all of it before finding
that out.

Seven kinds of wrong answer have turned up so far. Each was fixed by opening the code
the tool had misjudged and seeing what it had missed:

1. **Framework hooks counted as tests.** `test.beforeEach` and `afterAll` are not tests.
2. **Assuming everyone asserts with `expect`.** Plenty of suites raise `throw new Error(...)`
   or call a project comparator instead.
3. **Wrappers named like matchers.** A local `toEqual()` or `toBeTruthy()` asserts just
   fine without being `expect`.
4. **Helpers living in external packages.** If the scan can't read the package, the honest
   answer is "unknown", not "asserts nothing".
5. **Exhaustive `if/else`.** Both branches assert, so the assertion always runs.
6. **`.forEach()` mistaken for an event listener.** It's a loop. Its assertions are skipped
   only when the collection is empty.
7. **Type-level tests.** `*.test-d.ts` is the compiler's job, not the test runner's.

That last one alone took one repository from 260 flagged tests down to 6.

## One claim this tool used to get wrong

`floating-assertion` was reported as "cannot fail" until it was checked properly. It is not.
An unawaited assertion written to fail was run against Playwright 1.56 and Jest 29, and both
reported it: Playwright failed the test and pointed at the line, Jest raised an unhandled
rejection that took the worker down with it. The failure is attributed badly and arrives after
the state has moved on, which is worth fixing — but the test does not pass.

Severity is now `weak`. The lesson generalises: a rule is a claim about a runner's behaviour,
and the only way to know is to write a check that must fail and watch what the runner does.

## Where a human is still needed

`conditional-skip` is reported as debt rather than as a false green, because the tool
genuinely can't tell the difference. Whether a skip helper marks the run as skipped or
quietly lets it pass depends on what the helper does. Open the file and look.
