const { ts, calleeName, isFailureSignal } = require('./ast');

function collectFunctions(sourceFile, acc) {
  const record = (name, body) => {
    if (!name || !body) return;
    const entry = acc.get(name) || { name, asserts: false, calls: new Set() };
    let asserts = entry.asserts;
    const calls = entry.calls;
    const walk = (n) => {
      if (isFailureSignal(n)) asserts = true;
      if (ts.isCallExpression(n)) {
        const parts = calleeName(n);
        if (parts.length) calls.add(parts[parts.length - 1]);
      }
      ts.forEachChild(n, walk);
    };
    walk(body);
    entry.asserts = asserts;
    acc.set(name, entry);
  };

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      record(node.name.text, node.body);
    } else if (ts.isMethodDeclaration(node) && node.name && node.body) {
      record(node.name.getText(sourceFile), node.body);
    } else if (ts.isVariableDeclaration(node) && node.name && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        record(node.name.getText(sourceFile), node.initializer.body);
      }
    } else if (ts.isPropertyAssignment(node) && node.name && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        record(node.name.getText(sourceFile), node.initializer.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function resolveAsserting(fns) {
  const asserting = new Set();
  for (const fn of fns.values()) if (fn.asserts) asserting.add(fn.name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns.values()) {
      if (asserting.has(fn.name)) continue;
      for (const c of fn.calls) {
        if (asserting.has(c)) {
          asserting.add(fn.name);
          changed = true;
          break;
        }
      }
    }
  }
  return asserting;
}

module.exports = { collectFunctions, resolveAsserting };
