---
name: capture-fidelity
description: Capture a page as machine-readable data and diff our build against it. Use when capturing a reference page, verifying a built page matches, or when the fidelity report looks noisy or wrong.
---

# Capture and fidelity checking

One extraction function, two targets. That symmetry is the whole design — there is no
separate "checker" to build and keep in sync, only an extractor run twice.

```
extract(reference URL)   → capture.json      via run-reference.md  (browser tool)
extract(localhost route) → ours.json         via run-local.js      (Playwright)
diff(capture.json, ours.json)                → per-module pass/fail
```

## Capturing

Reference side: follow `${CLAUDE_PLUGIN_ROOT}/extractor/run-reference.md`.
Clone side:

```bash
node ${CLAUDE_PLUGIN_ROOT}/extractor/run-local.js \
  --url http://localhost:3000/<route> --out ours.json
```

**Both sides must match on viewport and device scale factor.** `diff.js` refuses to
compare captures that don't — deliberately, because the alternative is a report full
of phantom geometry findings that buries the real ones.

**Always capture the reference twice** and derive volatility:

```bash
node ${CLAUDE_PLUGIN_ROOT}/extractor/volatility.js --a run1.json --b run2.json --out capture.json
```

## What the check does and does not prove

**Catches:** typography, colors, spacing, relative geometry, grid dimensions, module
order and presence, tag names, heading levels, item counts, and container placement —
the signal that catches a module escaping the column it belongs in.

**Cannot catch:** anything not captured. A wrong image, an awkward crop, interaction
feel, "it just looks off."

So: **passing means every captured fact is reproduced — not that the page is
indistinguishable.** Say it that way when reporting. Human review still matters; it
just starts from a higher floor.

## Diffing

```bash
node ${CLAUDE_PLUGIN_ROOT}/extractor/diff.js \
  --reference capture.json --ours ours.json \
  --scope-ledger .parity/scope-ledger.json \
  --deviations   .parity/deviations.json
```

Exit 0 = no unexpected mismatches · 1 = mismatches · 2 = cannot compare.

## Tolerances, and why they sit where they do

Defined in one place — `TOLERANCE` in `diff.js`.

| Class | Rule | Why |
|---|---|---|
| Structure — tag, module order, grid, item counts | exact | Authored intent. A 3×2 grid is never accidentally 2×3 |
| Geometry — width, relative offsets | ±1px | Sub-pixel layout rounding is real |
| Line-height | ±0.5px | Same, finer scale |
| Colors | exact, normalized to hex | Authored |
| `font-family` | **role match only** | The clone substitutes fonts; literal comparison would fail forever |
| Height, vertical offset | **not compared** in fidelity mode | Our copy is never the same length as theirs, so these differ permanently even on a correct page |
| Text-node widths | never compared | Same reason, unavoidably |

Height and vertical offset *are* compared in volatility mode — there the question is
the opposite ("did anything move between two runs of the same page?") and sensitivity
is the point.

## When the report looks wrong

Diagnose in this order. Most of the time it's the harness, not the page:

1. **`settled: false`** in the clone capture → layout never stabilized. Something
   animates or loads forever. Measurements are unreliable; fix that and ignore the
   rest of the report until it's clean.
2. **Viewport or scale mismatch** → re-capture both sides at one size.
3. **Findings on live values** (prices, dates, counts) → the volatility list is
   missing or stale. Re-run the double capture.
4. **Many findings sharing one small delta** → a miscalibrated tolerance or a shared
   token off by one step. Look for a single root cause, not N bugs.
5. **A flood of findings on one module** → usually one structural cause (wrong
   container, wrong grid) cascading. Fix the cause, re-run, then read further.

**Calibration gate:** diffing a page against *itself* must produce zero findings. If
it doesn't, the tolerances are wrong and nothing downstream can be trusted. Re-check
this whenever the extractor changes.

## Rules

- **When the harness is wrong, fix the harness — not the page.** Equally: when the
  page is wrong, never loosen a tolerance to get a green report. Both defeat the
  mechanism.
- **Never suppress a whole module** to quiet one volatile field. Field-level
  suppression exists for this; module-level blinds the check to that module's real
  defects, and on a data-heavy page that's most of the page.
- **Report findings as they are.** Never describe a page as matching while mismatches
  remain, and distinguish *verified* (extractor confirms) from *built* (written,
  unverified).
- **Behavior facts are observations, not measurements.** Keep them labeled so a
  reader knows which facts have a number behind them.
