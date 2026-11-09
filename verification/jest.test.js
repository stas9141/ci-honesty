// Same method, Jest: each test is deliberately wrong inside the pattern one rule claims
// to catch. Passing proves the claim.
const EventEmitter = require('events');

it('no-assertion: nothing is checked', () => {
  const sum = 1 + 1;
  void sum;
});

it('swallowed-assertion: catch eats the failure', () => {
  try {
    expect(1).toBe(2);
  } catch {
    // swallowed
  }
});

it('guarded-assertion: condition never holds', () => {
  const never = false;
  if (never) {
    expect(1).toBe(2);
  }
});

it('silent-early-return: returns before asserting', () => {
  const bail = true;
  if (bail) return;
  expect(1).toBe(2);
});

it('tautological-matcher: toMatch empty string', () => {
  expect('literally anything at all').toMatch('');
});

it('tautological-matcher: count >= 0 on an empty list', () => {
  expect([].length).toBeGreaterThanOrEqual(0);
});

it('loop-only-assertion: the collection is empty', () => {
  for (const r of []) {
    expect(r).toBe(-999);
  }
});

it('silent-fallback: missing data becomes a default', () => {
  const fromBackend = {};
  expect(fromBackend.total ?? 0).toBe(0);
});

it('assertion-in-callback: the listener never fires', () => {
  const bus = new EventEmitter();
  bus.on('never-emitted', () => {
    expect(1).toBe(2);
  });
});

it.skip('disabled-test: this one is turned off', () => {
  expect(1).toBe(2);
});
