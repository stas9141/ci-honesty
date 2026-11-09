import { test, expect } from '@playwright/test';

// Every test here contains an assertion that is DELIBERATELY WRONG, written inside the
// pattern one rule claims to catch. A test that PASSES proves the rule's claim: the
// wrongness was invisible to the runner. A test that FAILS disproves it.

test('no-assertion: nothing is checked', async () => {
  const sum = 1 + 1;
  void sum;
});

test('swallowed-assertion: catch eats the failure', async () => {
  try {
    expect(1, 'deliberately wrong').toBe(2);
  } catch {
    // swallowed
  }
});

test('guarded-assertion: condition never holds', async () => {
  const never = false;
  if (never) {
    expect(1, 'deliberately wrong').toBe(2);
  }
});

test('silent-early-return: returns before asserting', async () => {
  const bail = true;
  if (bail) return;
  expect(1, 'deliberately wrong').toBe(2);
});

test('tautological-matcher: toMatch empty string', async () => {
  expect('literally anything at all').toMatch('');
});

test('tautological-matcher: count >= 0 on an empty list', async () => {
  const rows: string[] = [];
  expect(rows.length).toBeGreaterThanOrEqual(0);
});

test('loop-only-assertion: the collection is empty', async () => {
  const rows: number[] = [];
  for (const r of rows) {
    expect(r, 'deliberately wrong').toBe(-999);
  }
});

test('silent-fallback: missing data becomes a default', async () => {
  const fromBackend: { total?: number } = {};
  expect(fromBackend.total ?? 0).toBe(0);
});

test('assertion-in-callback: the listener never fires', async ({ page }) => {
  page.on('download', () => {
    expect(1, 'deliberately wrong').toBe(2);
  });
  await page.setContent('<p>no download will happen</p>');
});

test.skip('disabled-test: this one is turned off', async () => {
  expect(1, 'deliberately wrong').toBe(2);
});
