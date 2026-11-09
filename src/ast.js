const ts = require('typescript');

const TEST_CALLEES = new Set(['test', 'it', 'fit', 'xit', 'specify']);
const SUITE_CALLEES = new Set(['describe', 'context', 'suite', 'xdescribe', 'fdescribe']);

const ASYNC_MATCHERS = new Set([
  'toBeVisible', 'toBeHidden', 'toBeAttached', 'toBeChecked', 'toBeDisabled',
  'toBeEditable', 'toBeEmpty', 'toBeEnabled', 'toBeFocused', 'toBeInViewport',
  'toContainText', 'toHaveAccessibleName', 'toHaveAttribute', 'toHaveClass',
  'toHaveCount', 'toHaveCSS', 'toHaveId', 'toHaveJSProperty', 'toHaveScreenshot',
  'toHaveText', 'toHaveTitle', 'toHaveURL', 'toHaveValue', 'toHaveValues',
  'toBeOK', 'toPass', 'toMatchAriaSnapshot',
]);

const ALWAYS_TRUE_PREFIXES = ['verify', 'assert', 'expect', 'check', 'ensure', 'should', 'validate', 'compare'];

const HOOKS = new Set([
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'before', 'after',
  'step', 'use', 'setTimeout', 'slow', 'info', 'extend', 'configure',
]);

const ASSERTION_ROOTS = /^(expect|assert|chai|should|comparator|compare|verify|validate|ensure)/i;
const ASSERTION_MEMBERS = /^(assert|expect|verify|validate|ensure|should|must)/i;
const MATCHER_FN = /^to(Be|Have|Equal|Contain|Match|Throw|Strict|Pass|Close|Satisfy)/;

const STEP_LIKE = /(^|\.)(\w*step|poll|toPass|describe|parallel|serial|retry|group)$/i;
const LISTENER_LIKE = /(^|\.)(on|once|addEventListener|addListener|then|catch|finally|subscribe)$/;
const ITERATION_LIKE = /(^|\.)(forEach|map|flatMap|filter|some|every|reduce|find|findIndex|sort)$/;
const EXPECT_VALUE_HELPERS = new Set(['any','anything','objectContaining','arrayContaining','stringContaining','stringMatching','closeTo']);

function parse(fileName, text) {
  const kind = /\.tsx$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.jsx$/.test(fileName)
      ? ts.ScriptKind.JSX
      : /\.ts$/.test(fileName)
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

function calleeName(node) {
  let cur = node.expression;
  const parts = [];
  while (cur) {
    if (ts.isPropertyAccessExpression(cur)) {
      parts.unshift(cur.name.text);
      cur = cur.expression;
    } else if (ts.isIdentifier(cur)) {
      parts.unshift(cur.text);
      break;
    } else if (ts.isCallExpression(cur) || ts.isNewExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return parts;
}

function isTestCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const parts = calleeName(node);
  if (!parts.length) return null;
  const root = parts[0];
  const rest = parts.slice(1);
  if (!TEST_CALLEES.has(root)) return null;
  if (rest.some((p) => p === 'describe' || HOOKS.has(p))) return null;
  const modifiers = rest.filter((p) => p !== 'each');
  const fn = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  const title = node.arguments.find((a) => ts.isStringLiteralLike(a) || ts.isTemplateExpression(a));
  const disabled = root === 'xit' || modifiers.some((m) => ['skip', 'fixme', 'todo', 'failing'].includes(m));
  return {
    node,
    fn,
    modifiers,
    disabled,
    title: title && ts.isStringLiteralLike(title) ? title.text : '<dynamic title>',
  };
}

function isSuiteCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const parts = calleeName(node);
  if (!parts.length) return false;
  return SUITE_CALLEES.has(parts[0]) || (TEST_CALLEES.has(parts[0]) && parts.includes('describe'));
}

function expectChain(node) {
  if (!ts.isCallExpression(node)) return null;
  const props = [];
  let cur = node.expression;
  while (ts.isPropertyAccessExpression(cur)) {
    props.unshift(cur.name.text);
    cur = cur.expression;
  }
  if (ts.isCallExpression(cur)) {
    const inner = calleeName(cur);
    if (inner[0] === 'expect') {
      return { props, final: props[props.length - 1], args: cur.arguments, outerArgs: node.arguments, head: inner };
    }
    return null;
  }
  if (ts.isIdentifier(cur) && cur.text === 'expect') {
    return { props, final: props[props.length - 1], args: node.arguments, outerArgs: node.arguments, head: ['expect'] };
  }
  return null;
}

function isAssertionCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const parts = calleeName(node);
  if (!parts.length) return false;
  if (parts.length === 2 && parts[0] === 'expect' && EXPECT_VALUE_HELPERS.has(parts[1])) return false;
  return parts[0] === 'expect' || parts[0] === 'assert' || parts[0] === 'chai';
}

function isIterationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  return ITERATION_LIKE.test(calleeName(node).join('.'));
}

function isFailureSignal(node) {
  if (ts.isThrowStatement(node)) return true;
  if (!ts.isCallExpression(node)) return false;
  if (isAssertionCall(node)) return true;
  const parts = calleeName(node);
  if (!parts.length) return false;
  if (ASSERTION_ROOTS.test(parts[0])) return true;
  if (MATCHER_FN.test(parts[parts.length - 1])) return true;
  return parts.slice(1).some((p) => ASSERTION_MEMBERS.test(p));
}

function isStepLikeCall(node) {
  if (!ts.isCallExpression(node)) return false;
  return STEP_LIKE.test(calleeName(node).join('.'));
}

function isListenerCall(node) {
  if (!ts.isCallExpression(node)) return false;
  return LISTENER_LIKE.test(calleeName(node).join('.'));
}

function isAwaited(node) {
  let cur = node.parent;
  while (cur && !ts.isExpressionStatement(cur) && !ts.isBlock(cur)) {
    if (ts.isAwaitExpression(cur) || ts.isReturnStatement(cur) || ts.isYieldExpression(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

function hasAssertionInside(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (isAssertionCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
  return found || isAssertionCall(node);
}

function looksLikeAssertingName(name) {
  const lower = String(name || '').toLowerCase();
  return ALWAYS_TRUE_PREFIXES.some((p) => lower.startsWith(p));
}

function collectExternalImports(sourceFile) {
  const names = new Set();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteralLike(spec)) continue;
    if (spec.text.startsWith('.')) continue;
    if (/^(@playwright\/test|playwright|playwright-core|@jest\/globals|vitest|mocha|chai)$/.test(spec.text)) continue;
    const clause = stmt.importClause;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) names.add(el.name.text);
      } else if (ts.isNamespaceImport(clause.namedBindings)) {
        names.add(clause.namedBindings.name.text);
      }
    }
  }
  return names;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function snippetOf(sourceFile, node, maxLen = 140) {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

module.exports = {
  ts,
  parse,
  calleeName,
  isTestCall,
  isSuiteCall,
  expectChain,
  isAssertionCall,
  isFailureSignal,
  isStepLikeCall,
  isListenerCall,
  isIterationCall,
  isAwaited,
  hasAssertionInside,
  looksLikeAssertingName,
  collectExternalImports,
  lineOf,
  snippetOf,
  ASYNC_MATCHERS,
};
