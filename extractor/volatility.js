#!/usr/bin/env node
/**
 * Derive the volatility ignore-list by capturing the same page twice and seeing
 * what moved.
 *
 *   node volatility.js --a run1.json --b run2.json [--out capture.json]
 *
 * Anything that differs between two captures of the SAME page cannot be a
 * fidelity signal — it's an ad, a live figure, a timestamp, or rotating content.
 * Deriving the list this way means nobody maintains it by hand, and nobody has to
 * predict in advance which modules are unstable.
 *
 * Reuses the diff engine deliberately: "volatile" and "mismatched" are the same
 * computation with different inputs, so they must not drift apart.
 */
'use strict';

const fs = require('fs');
const { diffCaptures } = require('./diff.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

/**
 * @returns {{ignore: string[], pageLevel: string[], stable: string[]}}
 */
function detectVolatility(runA, runB) {
  const result = diffCaptures(runA, runB, { deviations: null, ledger: null, mode: 'volatility' });
  if (result.fatal) throw new Error(`Cannot compare the two runs: ${result.fatal}`);

  const ignorePaths = new Set();
  const wholeModule = new Set();
  const pageLevel = new Set();
  const touched = new Set();

  for (const f of result.findings) {
    if (!f.path.startsWith('modules.')) {
      pageLevel.add(f.path);
      continue;
    }
    const id = f.path.split('.')[1];
    touched.add(id);

    // A module that appears in one run and not the other is wholesale unstable
    // (an ad slot, a rotating promo). Anything else is volatile only in the
    // specific fields that moved — suppressing the whole module would blind the
    // fidelity gate to that module's real structural defects, and on a
    // data-heavy page almost every module carries some live value.
    if (f.actual === 'MISSING' || f.expected === 'ABSENT') wholeModule.add(id);
    else ignorePaths.add(f.path);
  }

  const all = (runA.modules || []).map(m => m.id);
  return {
    ignorePaths: [...ignorePaths].sort(),
    ignore: [...wholeModule].sort(),
    pageLevel: [...pageLevel].sort(),
    partiallyVolatile: [...touched].filter(id => !wholeModule.has(id)).sort(),
    stable: all.filter(id => !touched.has(id)).sort(),
  };
}

/** Stamp the derived list onto a capture so downstream diffs honor it. */
function applyVolatility(capture, volatility) {
  return {
    ...capture,
    modules: (capture.modules || []).map(m =>
      volatility.ignore.includes(m.id) ? { ...m, volatile: true } : m
    ),
    volatility: {
      detectedBy: 'double-capture',
      runs: 2,
      ignore: volatility.ignore,
      ignorePaths: volatility.ignorePaths,
      pageLevelUnstable: volatility.pageLevel,
    },
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (!args.a || !args.b) {
    console.error('usage: volatility.js --a run1.json --b run2.json [--out capture.json]');
    process.exit(2);
  }

  const runA = JSON.parse(fs.readFileSync(args.a, 'utf8'));
  const runB = JSON.parse(fs.readFileSync(args.b, 'utf8'));
  const volatility = detectVolatility(runA, runB);

  console.log(`wholly volatile (${volatility.ignore.length}): ${volatility.ignore.join(', ') || 'none'}`);
  console.log(`partly volatile (${volatility.partiallyVolatile.length}): ${volatility.partiallyVolatile.join(', ') || 'none'}`);
  console.log(`fully stable    (${volatility.stable.length}): ${volatility.stable.join(', ') || 'none'}`);
  if (volatility.ignorePaths.length) {
    console.log(`\nvolatile fields (${volatility.ignorePaths.length}) — suppressed individually,`);
    console.log('so the rest of each module still gets checked:');
    for (const p of volatility.ignorePaths) console.log(`  ${p}`);
  }
  if (volatility.pageLevel.length) {
    console.log(`page-level unstable: ${volatility.pageLevel.join(', ')}`);
    console.log('  ^ page-level instability is worth a look — it usually means the');
    console.log('    capture ran before layout settled, not that the page is volatile.');
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(applyVolatility(runA, volatility), null, 2));
    console.log(`\nwrote ${args.out}`);
  }
}

module.exports = { detectVolatility, applyVolatility };
