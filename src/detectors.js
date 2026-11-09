const {
  ts,
  calleeName,
  expectChain,
  isAssertionCall,
  isFailureSignal,
  isStepLikeCall,
  isListenerCall,
  isIterationCall,
  isAwaited,
  looksLikeAssertingName,
  lineOf,
  snippetOf,
  ASYNC_MATCHERS,
} = require('./ast');

const RULES = {
  'no-assertion': { severity: 'cannot-fail', title: 'Test asserts nothing' },
  'floating-assertion': { severity: 'cannot-fail', title: 'Assertion is never awaited' },
  'swallowed-assertion': { severity: 'cannot-fail', title: 'Assertion failure is swallowed by catch' },
  'tautological-matcher': { severity: 'cannot-fail', title: 'Matcher is true for every value' },
  'guarded-assertion': { severity: 'cannot-fail', title: 'Every assertion sits behind a condition' },
  'silent-early-return': { severity: 'cannot-fail', title: 'Test returns early and passes' },
  'loop-only-assertion': { severity: 'weak', title: 'Assertions run only inside a loop that may be empty' },
  'silent-fallback': { severity: 'weak', title: 'Asserted value has a literal fallback' },
  'assertion-in-callback': { severity: 'weak', title: 'Assertion lives in a callback that may never run' },
  'disabled-test': { severity: 'debt', title: 'Test is disabled' },
  'conditional-skip': { severity: 'debt', title: 'Test skips itself at runtime' },
};

const GUARD_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.ConditionalExpression,
]);

const LOOP_KINDS = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
]);

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.FunctionDeclaration,
]);

function finding(rule, sourceFile, node, test, detail) {
  return {
    rule,
    severity: RULES[rule].severity,
    title: RULES[rule].title,
    file: sourceFile.fileName,
    line: lineOf(sourceFile, node),
    test: test ? test.title : null,
    detail,
    snippet: snippetOf(sourceFile, node),
  };
}

function isLiteralish(node) {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isNewExpression(node)
  );
}

function textOf(sourceFile, node) {
  return node ? node.getText(sourceFile) : '';
}

function detectTautology(sourceFile, node, test) {
  const chain = expectChain(node);
  if (!chain || !chain.final) return null;
  const subject = chain.args && chain.args[0];
  const arg = chain.outerArgs && chain.outerArgs[0];
  const negated = chain.props.includes('not');
  const subjectText = textOf(sourceFile, subject);
  const argText = textOf(sourceFile, arg);

  if (!negated && chain.final === 'toBeGreaterThanOrEqual' && argText === '0') {
    if (/\.(length|count\(\)|size)\b|\bcount\b/i.test(subjectText)) {
      return finding('tautological-matcher', sourceFile, node, test,
        'A length or count is never negative, so this holds even when the collection is empty.');
    }
  }
  if (!negated && chain.final === 'toBeGreaterThan' && (argText === '-1' || argText === '-1.0')) {
    return finding('tautological-matcher', sourceFile, node, test,
      'Comparing a count against -1 passes for every possible value, including zero.');
  }
  if (!negated && (chain.final === 'toBeLessThan' || chain.final === 'toBeLessThanOrEqual') && /^Infinity$|^Number\.MAX_(SAFE_INTEGER|VALUE)$/.test(argText)) {
    return finding('tautological-matcher', sourceFile, node, test, 'Nothing exceeds this bound.');
  }
  if (!negated && (chain.final === 'toMatch' || chain.final === 'toContain') && (argText === "''" || argText === '""' || argText === '/.*/' || argText === '/.*/s')) {
    return finding('tautological-matcher', sourceFile, node, test, 'Every string matches this pattern.');
  }
  if (!negated && (chain.final === 'toBe' || chain.final === 'toEqual') && subject && arg && isLiteralish(subject) && subjectText === argText) {
    return finding('tautological-matcher', sourceFile, node, test, 'Both sides are the same literal.');
  }
  if (!negated && (chain.final === 'toBeDefined' || chain.final === 'toBeTruthy') && subject && isLiteralish(subject)) {
    return finding('tautological-matcher', sourceFile, node, test, 'The asserted value is a literal, so it is always defined.');
  }
  if (!negated && chain.final === 'toEqual' && /^expect\.(anything|any)\(/.test(argText)) {
    return finding('tautological-matcher', sourceFile, node, test, 'The expected value accepts anything.');
  }
  return null;
}

function detectFloating(sourceFile, statement, test, usesPlaywright) {
  if (!ts.isExpressionStatement(statement)) return null;
  const expr = statement.expression;
  if (ts.isAwaitExpression(expr) || ts.isBinaryExpression(expr)) return null;
  if (!ts.isCallExpression(expr)) return null;
  const chain = expectChain(expr);
  if (!chain || !chain.final) return null;
  const isAsyncMatcher = ASYNC_MATCHERS.has(chain.final) && usesPlaywright;
  const isPromiseChain = chain.props.includes('resolves') || chain.props.includes('rejects');
  const isPoll = chain.head.includes('poll');
  if (!isAsyncMatcher && !isPromiseChain && !isPoll) return null;
  return finding('floating-assertion', sourceFile, expr, test,
    'This assertion returns a promise that is never awaited, so a failure is raised after the test has already passed.');
}

function detectSilentFallback(sourceFile, node, test) {
  const chain = expectChain(node);
  if (!chain) return null;
  const subject = chain.args && chain.args[0];
  if (!subject) return null;
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
        if (isLiteralish(n.right)) hit = n;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(subject);
  if (!hit) return null;
  return finding('silent-fallback', sourceFile, node, test,
    `Missing data silently becomes ${textOf(sourceFile, hit.right)}, so the assertion can pass without the value ever being produced.`);
}

function containsFailureSignal(node) {
  let found = false;
  const w = (n) => {
    if (found) return;
    if (isFailureSignal(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, w);
  };
  w(node);
  return found;
}

function analyzeTestBody(sourceFile, test, ctx) {
  const findings = [];
  const body = test.fn && test.fn.body;
  if (!body) return findings;

  const usesPlaywright = ctx.usesPlaywright;
  let totalAssertions = 0;
  let unguardedAssertions = 0;
  let assertionsInLoops = 0;
  let hasLengthGuard = false;
  let unconditionalSkip = false;
  let unresolvedExternal = false;
  const calledNames = new Set();
  let firstAssertionNode = null;

  const walk = (node, depth) => {
    const nextDepth = { ...depth };
    const exhaustiveBranch = ts.isIfStatement(node)
      && node.elseStatement
      && containsFailureSignal(node.thenStatement)
      && containsFailureSignal(node.elseStatement);
    if (GUARD_KINDS.has(node.kind) && !exhaustiveBranch) nextDepth.guard = depth.guard + 1;
    if (LOOP_KINDS.has(node.kind)) nextDepth.loop = depth.loop + 1;
    if (FUNCTION_KINDS.has(node.kind) && node !== test.fn) {
      const owner = node.parent && ts.isCallExpression(node.parent) ? node.parent : null;
      if (owner && isIterationCall(owner)) {
        nextDepth.loop = depth.loop + 1;
        nextDepth.guard = depth.guard + 1;
      } else {
        const deferred = owner ? !(isAwaited(owner) || isStepLikeCall(owner)) : true;
        const listener = owner ? isListenerCall(owner) : false;
        if (deferred) nextDepth.callback = depth.callback + 1;
        if (listener) nextDepth.listener = depth.listener + 1;
      }
    }
    if (ts.isThrowStatement(node)) {
      totalAssertions += 1;
      if (!firstAssertionNode) firstAssertionNode = node;
      if (nextDepth.callback === 0) unguardedAssertions += 1;
    }
    if (ts.isTryStatement(node) && node.catchClause) {
      const cc = node.catchClause;
      const stmts = cc.block.statements;
      const rethrows = stmts.some((s) => ts.isThrowStatement(s) || /\bthrow\b|expect\(|fail\(/.test(s.getText(sourceFile)));
      if (!rethrows && hasAssertion(node.tryBlock)) {
        findings.push(finding('swallowed-assertion', sourceFile, cc, test,
          stmts.length === 0
            ? 'The catch block is empty, so a failed assertion inside the try is discarded.'
            : 'The catch block neither rethrows nor fails the test, so a failed assertion inside the try is discarded.'));
      }
    }

    if (ts.isCallExpression(node)) {
      const parts = calleeName(node);
      if (parts.length) {
        calledNames.add(parts[parts.length - 1]);
        if (ctx.externalNames && isAwaited(node)
          && (ctx.externalNames.has(parts[0]) || ctx.externalNames.has(parts[parts.length - 1]))) {
          unresolvedExternal = true;
        }
      }
      if (isFailureSignal(node)) {
        totalAssertions += 1;
        if (!firstAssertionNode) firstAssertionNode = node;
        if (nextDepth.guard === 0 && nextDepth.callback === 0) unguardedAssertions += 1;
        if (nextDepth.loop > 0) assertionsInLoops += 1;
        if (nextDepth.listener > 0) {
          findings.push(finding('assertion-in-callback', sourceFile, node, test,
            'Nothing in the test guarantees this callback runs, so the assertion may never execute.'));
        }
        const taut = detectTautology(sourceFile, node, test);
        if (taut) findings.push(taut);
        const fallback = detectSilentFallback(sourceFile, node, test);
        if (fallback) findings.push(fallback);
        const chain = expectChain(node);
        if (chain && /toHaveCount|toHaveLength/.test(chain.final || '')) hasLengthGuard = true;
        if (chain && /\.(length|count)\b/.test(textOf(sourceFile, chain.args && chain.args[0]))) hasLengthGuard = true;
      }
      if (parts[0] === 'test' && parts[1] === 'skip' && node.arguments.length > 0) {
        if (node.arguments[0].kind === ts.SyntaxKind.TrueKeyword) {
          unconditionalSkip = true;
          findings.push(finding('disabled-test', sourceFile, node, test,
            'Skipped unconditionally. It reports as skipped, not as a pass, but it covers nothing.'));
        } else {
          findings.push(finding('conditional-skip', sourceFile, node, test,
            'The test decides at runtime whether to run; a broken environment reads as a skip, not a failure.'));
        }
      }
    }

    ts.forEachChild(node, (child) => walk(child, nextDepth));
  };

  const hasAssertion = (node) => {
    let found = false;
    const w = (n) => {
      if (found) return;
      if (ts.isCallExpression(n) && isAssertionCall(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, w);
    };
    w(node);
    return found;
  };

  walk(body, { guard: 0, loop: 0, callback: 0, listener: 0 });

  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      const f = detectFloating(sourceFile, stmt, test, usesPlaywright);
      if (f) findings.push(f);
    }
    const deepWalk = (node) => {
      if (ts.isBlock(node)) {
        for (const stmt of node.statements) {
          const f = detectFloating(sourceFile, stmt, test, usesPlaywright);
          if (f && !findings.some((x) => x.rule === 'floating-assertion' && x.line === f.line)) findings.push(f);
        }
      }
      ts.forEachChild(node, deepWalk);
    };
    deepWalk(body);
  }

  if (test.disabled) {
    findings.push(finding('disabled-test', sourceFile, test.node, test,
      `Marked ${test.modifiers.join('.') || 'skipped'}; it reports as skipped and nobody sees it rot.`));
    return findings;
  }

  if (totalAssertions === 0 && !unconditionalSkip) {
    const assertsViaHelper = [...calledNames].some(
      (n) => ctx.assertingFunctions.has(n) || looksLikeAssertingName(n),
    );
    if (!assertsViaHelper && !unresolvedExternal) {
      findings.push(finding('no-assertion', sourceFile, test.node, test,
        'The body contains no assertion, directly or through a helper that asserts. It passes as long as nothing throws.'));
    }
  } else if (unguardedAssertions === 0) {
    findings.push(finding('guarded-assertion', sourceFile, firstAssertionNode || test.node, test,
      'Every assertion in this test sits inside a condition or loop. When the condition is false the test still reports green.'));
  }

  if (assertionsInLoops > 0 && !hasLengthGuard && unguardedAssertions > 0) {
    findings.push(finding('loop-only-assertion', sourceFile, firstAssertionNode || test.node, test,
      'Assertions inside the loop are skipped entirely when the collection is empty, and nothing asserts that it is not.'));
  }

  if (ts.isBlock(body) && firstAssertionNode) {
    const firstAssertLine = lineOf(sourceFile, firstAssertionNode);
    for (const stmt of body.statements) {
      if (lineOf(sourceFile, stmt) >= firstAssertLine) break;
      if (ts.isIfStatement(stmt) && stmt.thenStatement) {
        const thenText = stmt.thenStatement.getText(sourceFile);
        const isBareReturn = /^\s*\{?\s*return\s*;?\s*\}?\s*$/.test(thenText);
        if (isBareReturn) {
          const declaresSkip = /skip/i.test(stmt.expression.getText(sourceFile));
          if (declaresSkip) {
            findings.push(finding('conditional-skip', sourceFile, stmt, test,
              'The test opts out through a skip helper. Confirm the helper marks the run as skipped rather than letting it report as passed.'));
          } else {
            findings.push(finding('silent-early-return', sourceFile, stmt, test,
              'When this condition holds the test returns before asserting anything and still reports as passed.'));
          }
        }
      }
    }
  }

  return findings;
}

module.exports = { analyzeTestBody, RULES };
