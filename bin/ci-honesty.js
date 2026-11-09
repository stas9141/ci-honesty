#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { scan } = require('../src/scan');
const { renderConsole, renderMarkdown } = require('../src/report');

function parseArgs(argv) {
  const args = { target: '.', md: null, json: null, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--md') args.md = argv[++i];
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else args.target = a;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
ci-honesty — finds tests that cannot fail

  ci-honesty <path> [--md report.md] [--json findings.json] [--name "Repo"]

Reads the test sources, never runs them. Nothing leaves the machine.
`);
    return;
  }

  const target = path.resolve(args.target);
  if (!fs.existsSync(target)) {
    console.error(`No such path: ${target}`);
    process.exitCode = 2;
    return;
  }

  const started = Date.now();
  const result = scan(target);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(renderConsole(result));
  console.log(`  Done in ${elapsed}s`);

  if (args.md) {
    fs.writeFileSync(args.md, renderMarkdown(result, { name: args.name }), 'utf8');
    console.log(`  Report written to ${args.md}`);
  }
  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(result, null, 2), 'utf8');
    console.log(`  Findings written to ${args.json}`);
  }
  console.log('');
}

main();
