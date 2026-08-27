#!/usr/bin/env node
/**
 * Compare a reference capture against a clone capture and report per-module
 * pass/fail.
 *
 *   node diff.js --reference capture.json --ours ours.json \
 *                [--scope-ledger .parity/scope-ledger.json] \
 *                [--deviations .parity/deviations.json] [--json]
 *
 * Exit 0 = no unexpected mismatches. Exit 1 = mismatches. Exit 2 = cannot compare.
 *
 * Zero dependencies, by design: this has to run in any project without an install
 * step, or it won't get run.
 */
'use strict';

const fs = require('fs');

/**
 * Tolerances live in exactly one place so they can be recalibrated without
 * hunting through comparison logic.
 *
 * Structure is EXACT because it is authored intent — a 3x2 grid is never
 * accidentally 2x3. Geometry is toleranced because sub-pixel layout rounding is
 * real and gating on it produces noise, and a noisy check gets ignored.
 */
const TOLERANCE = {
  geometry: 1,     // px — widths, relative offsets
  fontSize: 0.5,   // px
  lineHeight: 0.5, // px
  letterSpacing: 0.1,
};

/**
 * Module height is compared as a FRACTION, not a pixel count. Differing copy
 * length shifts a module by a few percent; a wrong internal layout multiplies
 * its height. 15% separates the two without flagging every paragraph.
 */
const HEIGHT_DRIFT = 0.15;

// Text-node widths legitimately differ whenever the clone substitutes a font for
// a proprietary face, so they are never comparable. Font identity is compared by
// ROLE (display vs UI) instead of by literal family string, for the same reason.
const NEVER_COMPARE = new Set(['fontFamily', 'textWidth']);

const KNOWN_FLAGS = new Set([
  'reference', 'ours', 'map', 'deviations', 'scopeLedger', 'json',
]);

/**
 * Unknown flags are a hard error, not a silent no-op.
 *
 * They used to be accepted and ignored, which is the worst possible behaviour
 * for a gate: `--scope` instead of `--scope-ledger` parsed fine, loaded no scope
 * ledger, and reported seven deliberate out-of-scope decisions as failures. The
 * run looked successful and the number was simply wrong — for a whole session,
 * because nothing ever said the flag was unrecognised.
 */
function parseArgs(argv) {
  const out = { json: false };
  const unknown = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (!a.startsWith('--')) { unknown.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!KNOWN_FLAGS.has(key)) { unknown.push(a); i++; continue; }
    out[key] = argv[++i];
  }
  if (unknown.length) {
    console.error(`diff.js: unrecognised argument(s): ${unknown.join(' ')}`);
    console.error(`  known flags: --reference --ours --map --deviations --scope-ledger --json`);
    process.exit(2);
  }
  return out;
}

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

class Report {
  constructor() {
    this.findings = [];
    this.expected = [];
    this.skipped = [];
    this.checks = 0;
  }

  compare(path, expectedValue, actualValue, tolerance = 0, opts = {}) {
    this.checks++;
    if (expectedValue === undefined && actualValue === undefined) return;

    const bothNumbers = typeof expectedValue === 'number' && typeof actualValue === 'number';
    const delta = bothNumbers ? Math.abs(expectedValue - actualValue) : null;
    const ok = bothNumbers ? delta <= tolerance : expectedValue === actualValue;
    if (ok) return;

    const finding = {
      path,
      expected: expectedValue,
      actual: actualValue,
      delta: delta === null ? null : Math.round(delta * 100) / 100,
      tolerance,
    };
    if (opts.expectedMismatch) {
      finding.rationale = opts.rationale;
      this.expected.push(finding);
    } else {
      this.findings.push(finding);
    }
  }
}

/**
 * Rename reference module ids into our vocabulary so the two sides are
 * comparable at all.
 *
 * The reference names modules after its own CSS families
 * (`lineup-content-carousel-basic`); a clone names them by declared marker
 * (`rail-carousel`). Without a mapping every module reads as missing on one side
 * and extra on the other, the report becomes noise, and the natural response is
 * to stop running it — which is precisely how whole modules get left unbuilt
 * while every measured number still looks fine.
 *
 * Accepts either `{ modules: { refId: ourId } }` or a flat `{ refId: ourId }`.
 *
 * `{ pages: { "/route": { refId: ourId } } }` overlays the shared table for one
 * route. A flat map cannot express what real pages do: the same reference family
 * appears on several pages under different local names — one page's single
 * `CardRow4UpVideo` is its "Videos" module, another's first instance is a
 * named show — and the module is genuinely the same component either way.
 * Without an overlay the choice is to misname our own module to satisfy the map,
 * or to let a built module report MISSING. Both defeat the point of mapping.
 */
function applyIdMap(capture, map) {
  if (!map) return capture;
  const shared = map.modules || map;
  const route = capture.target?.route;
  const table = { ...shared, ...((map.pages && route && map.pages[route]) || {}) };
  const rename = id => table[id] || id;
  return {
    ...capture,
    page: { ...capture.page, moduleOrder: (capture.page?.moduleOrder || []).map(rename) },
    modules: (capture.modules || []).map(m => ({ ...m, id: rename(m.id), referenceId: m.id })),
  };
}

/**
 * Paths the deviation register marks as knowingly different.
 *
 * `*` in an `expectedMismatch` path is a wildcard spanning one dot-separated
 * segment, so `modules.*.elements.title.tag` covers every module and
 * `modules.lineup-4up-*.a11y.headingLevel` covers one family's instances.
 *
 * This was an exact-string lookup until it was caught silently dropping every
 * pattern containing a `*` — including entries that had been in the register
 * from the start. The effect was the worst kind: a deliberate, reviewed
 * deviation kept being reported as a failure on every run, which is precisely
 * how a fidelity gate turns into noise and stops being read. Patterns are
 * matched here rather than expanded by the caller so that a deviation written
 * once keeps applying as new pages and modules appear.
 */
function expectedPaths(deviations) {
  const exact = new Map();
  const globs = [];
  for (const entry of deviations?.entries || []) {
    const why = entry.rationale || entry.id;
    for (const item of entry.expectedMismatch || []) {
      // An item is either a bare path, or `{path, whenExpected, whenActual}` to
      // pin the deviation to the exact value pair it was written for.
      const path = typeof item === 'string' ? item : item.path;
      if (!path) continue;
      const hit = { why, guard: typeof item === 'string' ? null : item };
      if (!path.includes('*')) {
        exact.set(path, hit);
        continue;
      }
      // Escape every regex metacharacter, then let `*` span one path segment.
      const source = path
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^.]*');
      globs.push([new RegExp(`^${source}$`), hit]);
    }
  }
  const find = path => {
    if (exact.has(path)) return exact.get(path);
    const hit = globs.find(([rx]) => rx.test(path));
    return hit ? hit[1] : undefined;
  };

  return {
    /**
     * A deviation suppresses a finding only when the observed values are the
     * ones it actually claims. An entry may guard a path with `whenExpected` /
     * `whenActual`; if it does and the pair does not match, the finding stays a
     * failure.
     *
     * Without this guard a broad pattern silently swallows real defects that
     * merely touch the same field. `modules.*.a11y.headingLevel` — written to
     * excuse rendering h2 where the reference renders h3 — was suppressing a
     * module that rendered NO heading at all (reference 2, ours null), which is
     * the opposite problem and a genuine a11y regression.
     */
    match(path, expectedValue, actualValue) {
      const hit = find(path);
      if (!hit) return undefined;
      const g = hit.guard;
      // `null` and `undefined` compare equal here. A guard is authored in JSON,
      // where "no value" can only be written as `null`, but the capture side
      // reports an absent field as `undefined` — so a strict `!==` rejected every
      // guard written for an absent value and silently stopped suppressing.
      const same = (a, b) => (a === undefined || a === null ? b === undefined || b === null : a === b);
      if (g && !(same(g.whenExpected, expectedValue) && same(g.whenActual, actualValue))) return undefined;
      return hit.why;
    },
  };
}

/** Module ids the scope ledger says we deliberately did not build as-is. */
function scopedModules(ledger, reference) {
  const hits = new Map();
  for (const entry of ledger?.entries || []) {
    const sig = entry.detectionSignals || {};
    for (const mod of reference.modules || []) {
      const matches =
        (sig.classFamilies || []).includes(mod.fingerprint?.value) ||
        (sig.selectors || []).some(s => mod.id && s.includes(mod.id));
      if (matches) hits.set(mod.id, `${entry.id}: ${entry.handling}`);
    }
  }
  return hits;
}

/**
 * @param {object} opts
 * @param {'fidelity'|'volatility'} [opts.mode]
 *
 * The two modes differ in sensitivity on purpose.
 *
 * `fidelity` (default) skips height and vertical offset. Our seeded copy is never
 * the same length as the reference's, so those dimensions differ permanently even
 * on a perfectly built page — gating on them would produce noise forever.
 *
 * `volatility` compares them, because there the question is the opposite: did
 * ANYTHING move between two captures of the same page? A module whose height
 * changes between runs is live content, and missing it would let real instability
 * through into the fidelity gate.
 */
function diffCaptures(reference, ours, { deviations, ledger, mode = 'fidelity' } = {}) {
  const sensitive = mode === 'volatility';
  const report = new Report();
  const expected = expectedPaths(deviations);
  const scoped = scopedModules(ledger, reference);

  // A capture taken at a different viewport is not comparable to one taken here.
  // Failing loudly beats silently reporting hundreds of phantom geometry diffs.
  const re = reference.environment || {};
  const oe = ours.environment || {};
  if (re.viewport?.width !== oe.viewport?.width || re.viewport?.height !== oe.viewport?.height) {
    return {
      fatal: `Viewport mismatch: reference ${re.viewport?.width}x${re.viewport?.height} vs ours ${oe.viewport?.width}x${oe.viewport?.height}. Re-capture at a single viewport.`,
    };
  }
  if (re.deviceScaleFactor !== oe.deviceScaleFactor) {
    return { fatal: `deviceScaleFactor mismatch: ${re.deviceScaleFactor} vs ${oe.deviceScaleFactor}.` };
  }

  // Same reasoning as the viewport guard, one level up: these are not two
  // measurements of one page, they are measurements of two different pages.
  // Reporting every difference between an empty list and a full one is worse
  // than refusing, because each one looks exactly like a defect.
  const rt = reference.target || {};
  const ot = ours.target || {};
  if ((rt.fixture || null) !== (ot.fixture || null)) {
    return {
      fatal: `Fixture mismatch: reference "${rt.fixture || 'unspecified'}" vs ours "${ot.fixture || 'unspecified'}". `
           + `A capture of one state cannot be compared against a capture of another.`,
    };
  }
  if ((rt.actor || null) !== (ot.actor || null)) {
    return {
      fatal: `Actor mismatch: reference "${rt.actor || 'unspecified'}" vs ours "${ot.actor || 'unspecified'}". `
           + `The same route renders differently per role; capture both sides as the same actor.`,
    };
  }
  if (oe.settled === false) {
    report.findings.push({
      path: 'environment.settled',
      expected: true,
      actual: false,
      note: 'Clone layout never stabilized — measurements below are unreliable.',
    });
  }

  const ignore = new Set([
    ...(reference.volatility?.ignore || []),
    ...(ours.volatility?.ignore || []),
  ]);

  // Field-level suppression. A module carrying one live value stays fully checked
  // everywhere else — only the moving field is skipped.
  const ignorePaths = new Set([
    ...(reference.volatility?.ignorePaths || []),
    ...(ours.volatility?.ignorePaths || []),
  ]);

  // ---- page-level ----
  const refOrder = (reference.page?.moduleOrder || []).filter(id => !ignore.has(id));
  const ourOrder = (ours.page?.moduleOrder || []).filter(id => !ignore.has(id));

  // Module PRESENCE consults the deviation register too, not just the scope
  // ledger. Without this a documented, reviewed absence — global chrome that
  // lives in the app shell, a module deliberately not built yet — could never be
  // excused, because the ledger only matches on detection signals against a
  // reference module while these findings are keyed by path. Every such entry
  // stayed red on every run, which is the exact rot that trains people to stop
  // reading the report.
  for (const id of refOrder) {
    if (!ourOrder.includes(id)) {
      const path = `page.moduleOrder[${id}]`;
      const why = expected.match(path, 'present', 'MISSING');
      report.compare(path, 'present', 'MISSING', 0, {
        expectedMismatch: scoped.has(id) || why !== undefined,
        rationale: scoped.get(id) || why,
      });
    }
  }
  for (const id of ourOrder) {
    if (!refOrder.includes(id)) {
      const path = `page.moduleOrder[${id}]`;
      const why = expected.match(path, 'ABSENT', 'present');
      report.compare(path, 'ABSENT', 'present', 0, {
        expectedMismatch: why !== undefined,
        rationale: why,
      });
    }
  }

  const shared = refOrder.filter(id => ourOrder.includes(id));
  const ourShared = ourOrder.filter(id => refOrder.includes(id));
  if (shared.join('>') !== ourShared.join('>')) {
    report.compare('page.moduleOrder.sequence', shared.join(' > '), ourShared.join(' > '));
  }

  const refCols = reference.page?.layout?.columns || [];
  const ourCols = ours.page?.layout?.columns || [];
  report.compare('page.layout.columnCount', refCols.length, ourCols.length);
  refCols.forEach((col, i) => {
    if (!ourCols[i]) return;
    report.compare(`page.layout.columns.${col.role}.width`, col.width, ourCols[i].width, TOLERANCE.geometry);
  });

  // ---- per module ----
  const ourById = new Map((ours.modules || []).map(m => [m.id, m]));

  for (const ref of reference.modules || []) {
    if (ignore.has(ref.id) || ref.volatile) {
      report.skipped.push({ module: ref.id, reason: 'volatile' });
      continue;
    }
    const mine = ourById.get(ref.id);
    if (!mine) continue; // already reported at page level

    const isScoped = scoped.has(ref.id);

    // Fields either side declared it did not measure. Comparing one side's
    // measurement against the other side's gap in knowledge produces a finding
    // that looks exactly like a defect and is not one — and acting on it has
    // already caused a wrong rebuild on this project.
    const unmeasured = new Set([...(ref.unmeasured || []), ...(mine.unmeasured || [])]);

    // itemGrid can resolve at different DOM levels on the two sides — one side's
    // images against the other's columns. Both are "measured"; they are just not
    // measurements OF the same thing, so the comparison is void.
    const refLevel = ref.itemGrid?.resolvedLevel;
    const ourLevel = mine.itemGrid?.resolvedLevel;
    const levelsDiffer = refLevel && ourLevel &&
      (refLevel.childrenAreImages !== ourLevel.childrenAreImages || refLevel.depth !== ourLevel.depth);
    if (levelsDiffer) unmeasured.add('itemGrid');

    const at = (field, a, b, tol = 0) => {
      const path = `modules.${ref.id}.${field}`;
      if (ignorePaths.has(path)) {
        report.skipped.push({ module: ref.id, path, reason: 'volatile-field' });
        return;
      }
      // A prefix match, so declaring `arrangement` covers `arrangement.layout`
      // and every other field beneath it.
      for (const u of unmeasured) {
        if (field === u || field.startsWith(u + '.')) {
          report.skipped.push({
            module: ref.id, path,
            reason: u === 'itemGrid' && levelsDiffer
              ? `not-comparable: itemGrid resolved at different levels (reference depth ${refLevel.depth}${refLevel.childrenAreImages ? ', images' : ''} vs ours ${ourLevel.depth}${ourLevel.childrenAreImages ? ', images' : ''})`
              : 'unmeasured',
          });
          return;
        }
      }
      const why = expected.match(path, a, b);
      report.compare(path, a, b, tol, {
        expectedMismatch: isScoped || why !== undefined,
        rationale: scoped.get(ref.id) || why,
      });
    };

    at('slot', ref.slot, mine.slot);
    at('geometry.width', ref.geometry?.width, mine.geometry?.width, TOLERANCE.geometry);
    at('geometry.offsetLeftRelative', ref.geometry?.offsetLeftRelative, mine.geometry?.offsetLeftRelative, TOLERANCE.geometry);
    at('geometry.container', ref.geometry?.container, mine.geometry?.container);
    if (sensitive) {
      at('geometry.height', ref.geometry?.height, mine.geometry?.height, TOLERANCE.geometry);
      at('geometry.offsetTopRelative', ref.geometry?.offsetTopRelative, mine.geometry?.offsetTopRelative, TOLERANCE.geometry);
    }
    at('grid.columns', ref.grid?.columns, mine.grid?.columns);
    at('grid.rows', ref.grid?.rows, mine.grid?.rows);

    /**
     * Module height, with a PROPORTIONAL tolerance.
     *
     * Height was previously excluded outright on the reasoning that our copy is
     * never the same length as the reference's. True, but far too broad: text
     * length moves a module by a few percent, while a wrong internal layout —
     * a full-bleed image where the reference has a left-hand thumbnail —
     * multiplies it. Excluding height discarded the loudest available signal
     * that a module was built wrong.
     */
    const refH = ref.geometry?.height;
    const ourH = mine.geometry?.height;
    if (typeof refH === 'number' && typeof ourH === 'number' && refH > 0) {
      const drift = Math.abs(ourH - refH) / refH;
      if (drift > HEIGHT_DRIFT) {
        at('geometry.height', refH, ourH, Math.max(1, refH * HEIGHT_DRIFT));
      } else {
        report.checks++;
      }
    }

    // The framing cell — border and padding. Absent these, a ruled, inset page
    // renders as an undifferentiated stack.
    for (const side of ['top', 'right', 'bottom', 'left']) {
      at(`cell.border.${side}`, ref.cell?.box?.border?.[side], mine.cell?.box?.border?.[side]);
      at(`cell.padding.${side}`, ref.cell?.box?.padding?.[side], mine.cell?.box?.padding?.[side], TOLERANCE.geometry);
    }
    at('cell.border.color', ref.cell?.box?.border?.color, mine.cell?.box?.border?.color);

    // The repeating card group — count and arrangement are exact-match, because
    // a module holding six cards in two rows is not the same module as one
    // holding three in one row.
    at('itemGrid.count', ref.itemGrid?.count, mine.itemGrid?.count);
    at('itemGrid.rows', ref.itemGrid?.rows, mine.itemGrid?.rows);
    at('itemGrid.perRow', ref.itemGrid?.perRow, mine.itemGrid?.perRow);
    at('itemGrid.card.width', ref.itemGrid?.card?.width, mine.itemGrid?.card?.width, TOLERANCE.geometry);
    at('arrangement.layout', ref.arrangement?.layout, mine.arrangement?.layout);
    at('arrangement.imageWidthFraction', ref.arrangement?.imageWidthFraction, mine.arrangement?.imageWidthFraction, 0.05);

    // Interactive controls. A missing "Load more", an absent pair of carousel
    // arrows, or a dot strip pushed to the left are all invisible to geometry
    // and typography checks, so they are compared explicitly.
    at('controls.count', ref.controls?.count ?? 0, mine.controls?.count ?? 0);
    at('controls.tabGroup.count', ref.controls?.tabGroup?.count ?? 0, mine.controls?.tabGroup?.count ?? 0);
    at('controls.tabGroup.alignment', ref.controls?.tabGroup?.alignment ?? null, mine.controls?.tabGroup?.alignment ?? null);

    // The largest control is the module's primary affordance — the pill button,
    // not one dot. Its alignment is the one most visible when wrong.
    const primary = list => {
      const items = list?.items || [];
      if (!items.length) return null;
      return items.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    };
    const refPrimary = primary(ref.controls);
    const ourPrimary = primary(mine.controls);
    at('controls.primary.alignment', refPrimary?.alignment ?? null, ourPrimary?.alignment ?? null);
    // Visible copy and accessible name are separate checks. Comparing only the
    // accessible name let a button reading "more stories" match a reference
    // button reading "Load more", because the reference's aria-label happened to
    // be the very string we were displaying.
    at('controls.primary.text', refPrimary?.text ?? null, ourPrimary?.text ?? null);
    at('controls.primary.label', refPrimary?.label ?? null, ourPrimary?.label ?? null);
    at('controls.primary.width', refPrimary?.width ?? null, ourPrimary?.width ?? null, TOLERANCE.geometry);
    at('controls.primary.height', refPrimary?.height ?? null, ourPrimary?.height ?? null, TOLERANCE.geometry);

    at('itemCount', ref.itemCount, mine.itemCount);
    at('a11y.headingLevel', ref.a11y?.headingLevel, mine.a11y?.headingLevel);

    const mineByRole = new Map((mine.elements || []).map(e => [e.role, e]));
    for (const el of ref.elements || []) {
      const m = mineByRole.get(el.role);
      if (!m) {
        at(`elements.${el.role}`, 'present', 'MISSING');
        continue;
      }
      const p = `elements.${el.role}`;
      at(`${p}.tag`, el.tag, m.tag);
      at(`${p}.color`, el.color, m.color);
      at(`${p}.typography.fontRole`, el.typography?.fontRole, m.typography?.fontRole);
      at(`${p}.typography.fontSize`, el.typography?.fontSize, m.typography?.fontSize, TOLERANCE.fontSize);
      at(`${p}.typography.fontWeight`, el.typography?.fontWeight, m.typography?.fontWeight);
      at(`${p}.typography.lineHeight`, el.typography?.lineHeight, m.typography?.lineHeight, TOLERANCE.lineHeight);
      for (const key of ['marginTop', 'marginBottom', 'paddingLeft']) {
        at(`${p}.spacing.${key}`, el.spacing?.[key], m.spacing?.[key], TOLERANCE.geometry);
      }
    }
  }

  return {
    route: reference.target?.route,
    checks: report.checks,
    findings: report.findings,
    expected: report.expected,
    skipped: report.skipped,
    pass: report.findings.length === 0,
  };
}

function render(result) {
  if (result.fatal) return `CANNOT COMPARE\n  ${result.fatal}`;

  const lines = [`fidelity: ${result.route}`, ''];
  const byModule = new Map();
  for (const f of result.findings) {
    const key = f.path.startsWith('modules.') ? f.path.split('.')[1] : 'page';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(f);
  }

  if (!result.findings.length) lines.push('  no unexpected mismatches');

  for (const [mod, findings] of byModule) {
    lines.push(`  ${mod}`);
    for (const f of findings) {
      const tail = f.path.replace(`modules.${mod}.`, '');
      const delta = f.delta !== null && f.delta !== undefined ? `  (Δ${f.delta}, tol ${f.tolerance})` : '';
      lines.push(`    FAIL  ${tail}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}${delta}`);
      if (f.note) lines.push(`          ${f.note}`);
    }
  }

  if (result.expected.length) {
    lines.push('', `  expected deviations (not failures) — ${result.expected.length}`);
    for (const e of result.expected) lines.push(`    ok    ${e.path} — ${e.rationale}`);
  }
  const wholeSkips = result.skipped.filter(s => s.reason === 'volatile');
  const fieldSkips = result.skipped.filter(s => s.reason === 'volatile-field');
  if (wholeSkips.length) {
    lines.push('', `  skipped, wholly volatile — ${wholeSkips.map(s => s.module).join(', ')}`);
  }
  if (fieldSkips.length) {
    const byMod = new Map();
    for (const s of fieldSkips) {
      const field = s.path.replace(`modules.${s.module}.`, '');
      byMod.set(s.module, [...(byMod.get(s.module) || []), field]);
    }
    lines.push('', '  volatile fields skipped (rest of each module still checked)');
    for (const [mod, fields] of byMod) lines.push(`    ${mod}: ${fields.join(', ')}`);
  }

  lines.push(
    '',
    `  ${result.checks} checks · ${result.findings.length} mismatches · ` +
      `${result.expected.length} expected · ${wholeSkips.length} volatile modules · ` +
      `${fieldSkips.length} volatile fields`
  );
  return lines.join('\n');
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (!args.reference || !args.ours) {
    console.error('usage: diff.js --reference <capture.json> --ours <ours.json> [--map ids.json] [--scope-ledger f] [--deviations f] [--json]');
    process.exit(2);
  }
  // The reference names modules after its own CSS families; a clone names them by
  // declared marker. Without --map the two vocabularies never line up and every
  // module reports as missing.
  const map = args.map ? readJson(args.map) : null;
  const result = diffCaptures(applyIdMap(readJson(args.reference), map), readJson(args.ours), {
    deviations: args.deviations ? readJson(args.deviations) : null,
    ledger: args.scopeLedger ? readJson(args.scopeLedger) : null,
  });
  console.log(args.json ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.fatal ? 2 : result.pass ? 0 : 1);
}

module.exports = { diffCaptures, render, TOLERANCE, NEVER_COMPARE };
