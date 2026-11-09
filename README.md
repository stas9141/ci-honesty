# ci-honesty

Finds tests that cannot fail — the ones that report green whatever the product does.

```bash
node bin/ci-honesty.js <path-to-repo> --md report.md --json findings.json
```

Static analysis only. Nothing is executed, nothing leaves the machine.

## What it looks for

| Rule | Severity | What it means |
|---|---|---|
| `no-assertion` | cannot-fail | No assertion, directly or through a helper that asserts |
| `floating-assertion` | cannot-fail | A Playwright assertion that is never awaited |
| `swallowed-assertion` | cannot-fail | A catch block absorbs the assertion error |
| `guarded-assertion` | cannot-fail | Every assertion sits behind a condition |
| `silent-early-return` | cannot-fail | The test returns before asserting and still passes |
| `tautological-matcher` | cannot-fail | The matcher holds for every possible value |
| `loop-only-assertion` | weak | Assertions run only inside a loop that may be empty |
| `silent-fallback` | weak | A literal default stands in for missing data |
| `assertion-in-callback` | weak | The assertion is inside a listener that may never run |
| `conditional-skip` | debt | The test opts out at runtime |
| `disabled-test` | debt | Turned off |

## Precision

False positives are the whole game. A report that over-claims is worth nothing, so every
rule below was written only after reading the code it had been wrong about. Seven classes
of false positive were found and fixed:

1. **Framework hooks counted as tests.** `test.beforeEach` / `afterAll` are not tests.
2. **Assertion style assumed to be `expect`.** Real suites assert with `throw new Error(...)`
   or a custom comparator. `isFailureSignal` covers those too.
3. **Wrappers named like matchers.** A project-local `toEqual()` or `toBeTruthy()` is an
   assertion even though it is not `expect`.
4. **Helpers in external packages.** When a test delegates to something imported from a
   package the scan cannot read, the result is unknown, not "asserts nothing".
5. **Exhaustive `if/else`.** When both branches assert, the assertion always runs.
6. **`.forEach()` treated as a listener.** It is a loop, so its assertions are skipped only
   when the collection is empty.
7. **Type-level tests.** `*.test-d.ts` files are checked by the compiler, not the runner.

Rule 7 alone took one repository from 260 flagged tests to 6.

## Judgement still required

`conditional-skip` is reported as debt, not as a false green, because whether a skip helper
marks the run as skipped or lets it pass depends on the helper. Read it before claiming it.
