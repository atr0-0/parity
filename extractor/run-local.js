#!/usr/bin/env node
/**
 * Clone-side driver: run the shared extractor against our own dev server.
 *
 *   node run-local.js --url http://localhost:3000/pricing --out ours.json
 *   node run-local.js --url http://localhost:3000/pricing --out capture.json --runs 2
 *
 * This side is scripted rather than agent-driven because it runs over and over
 * during the fix loop, needs no auth, and must be byte-reproducible. The reference
 * side is different — see run-reference.md.
 *
 * `--runs 2` captures twice and derives the volatility list, which is worth doing
 * on our own app too: a clone can have its own instability (animations that never
 * settle, skeleton loaders, dates rendered from the clock).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// `load` rather than `networkidle`: dev servers with an HMR websocket, and any
// page that polls, never reach network idle. The extractor's own rAF stability
// check is a stronger settle signal anyway, and it's capped.
const DEFAULTS = { viewport: '1440x900', scale: 1, runs: 1, wait: 'load', timeout: 45000 };

// --fixture names the state this capture was taken under, --actor who was
// looking. Both are recorded on the capture, and the diff refuses to compare
// two captures that disagree on either.


function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i] ?? true;
  }
  return out;
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    console.error(
      [
        'Playwright is required for clone-side capture but is not installed.',
        '',
        '  npm install -D playwright && npx playwright install chromium',
        '',
        'It is intentionally not a hard dependency of this plugin — the diff and',
        'volatility tools run with no dependencies at all, so they work anywhere.',
      ].join('\n')
    );
    process.exit(2);
  }
}

async function capture(browser, args, config) {
  const [width, height] = String(args.viewport).split('x').map(Number);

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: Number(args.scale),
    // Matches what the extractor asserts in `environment`, so a capture taken
    // with motion enabled can never be silently compared against one without.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  const budget = Number(args.timeout);
  try {
    await page.goto(args.url, { waitUntil: args.wait, timeout: budget });
    await page.addScriptTag({ path: path.join(__dirname, 'extract.js') });

    // Hard cap on extraction itself. Without it a single never-resolving wait
    // inside the page burns the whole run and reports nothing at all.
    //
    // The timer must be cleared on the happy path: an un-cleared setTimeout keeps
    // Node's event loop alive, so the process sits idle until it fires and a
    // 1-second capture looks like a 45-second one.
    let guard;
    try {
      return await Promise.race([
        page.evaluate(cfg => window.__parityExtract(cfg), config),
        new Promise((_, reject) => {
          guard = setTimeout(
            () => reject(new Error(`Extraction exceeded ${budget}ms. Raise it with --timeout, or look for an asset or animation that never completes.`)),
            budget
          );
        }),
      ]);
    } finally {
      clearTimeout(guard);
    }
  } finally {
    await context.close();
  }
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.url || !args.out) {
    console.error('usage: run-local.js --url <url> --out <file.json> [--runs 2] [--viewport 1440x900] [--config cfg.json]');
    process.exit(2);
  }

  const config = {
    kind: 'clone',
    route: args.route || new URL(args.url).pathname,
    fixture: args.fixture || null,
    actor: args.actor || null,
    ...(args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : {}),
  };

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();

  try {
    const runs = Number(args.runs) || 1;
    const first = await capture(browser, args, config);

    if (runs < 2) {
      fs.writeFileSync(args.out, JSON.stringify(first, null, 2));
      console.log(`wrote ${args.out} — ${first.modules.length} modules, settled=${first.environment.settled}`);
      if (!first.environment.settled) {
        console.log('WARNING: layout never stabilized. Measurements are unreliable —');
        console.log('  check for an animation or loader that never completes.');
      }
      return;
    }

    const second = await capture(browser, args, config);
    const { detectVolatility, applyVolatility } = require('./volatility.js');
    const volatility = detectVolatility(first, second);
    fs.writeFileSync(args.out, JSON.stringify(applyVolatility(first, volatility), null, 2));

    console.log(`wrote ${args.out} — ${first.modules.length} modules`);
    console.log(`  wholly volatile: ${volatility.ignore.join(', ') || 'none'}`);
    console.log(`  volatile fields: ${volatility.ignorePaths.length}`);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(2);
});
