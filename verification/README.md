# Verification

Every rule in this tool is a claim about how a test runner behaves. Claims like that are
cheap to believe and cheap to check, and believing one without checking it is how
`floating-assertion` shipped as "cannot fail" when it is nothing of the sort.

So each rule has a test here that is **deliberately wrong inside the pattern the rule
describes**. If the runner lets it pass, the rule's claim holds: that kind of wrongness is
invisible, which is the whole point of reporting it. If the runner catches it, the claim is
false and the rule has to be downgraded or dropped.

```bash
npm run verify
```

These suites are meant to pass. A failure here is not a broken test — it means a runner
changed its behaviour and a rule now overstates its case.

## Results

Measured against Playwright 1.56 / 1.65 and Jest 29:

| Rule | Runner lets it pass? | Claim |
|---|---|---|
| `no-assertion` | yes | holds |
| `swallowed-assertion` | yes | holds |
| `guarded-assertion` | yes | holds |
| `silent-early-return` | yes | holds |
| `tautological-matcher` | yes | holds |
| `loop-only-assertion` | yes | holds |
| `silent-fallback` | yes | holds |
| `assertion-in-callback` | yes | holds |
| `disabled-test` | reported as skipped | holds — debt, not a false green |
| `floating-assertion` | **no** | **false; downgraded to `weak`** |

`floating-assertion` is the reason this directory exists. Playwright fails the test and
points at the line; Jest raises an unhandled rejection that takes the worker down. The
failure is attributed badly and arrives late, which is worth reporting — but the test does
not pass, and the rule used to say it did.
