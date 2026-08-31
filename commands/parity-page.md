---
description: Clone one page of the reference app end to end — capture, spec, skeleton, data, verify — against the archetype docs produced by /parity-bootstrap. Phase-gated by default. Supports --unattended and --verify-only.
argument-hint: <route> [--unattended] [--verify-only]
---

You are running **/parity-page** — entry point 2 of two.

`$ARGUMENTS` contains the route to clone (e.g. `/pricing`) plus optional flags.

| Flag | Effect |
|---|---|
| *(none)* | Phase gates: stop for review at each boundary below |
| `--unattended` | Run straight through, then present once. **Only** valid in template mode, when this page's archetype has already been cloned at least once and every module resolves to `REUSE`/`EXTEND`. Never valid in per-page mode — there is no template to have been validated |
| `--verify-only` | Skip to P4/P6 verification on an already-built page and report the diff. This is the fix-pass loop. For a bug someone *reported* rather than one the diff found, use `/parity-fix` — it starts from the observation instead of the route |
| `--per-page` | Force per-page mode, ignoring the routing verdict |
| `--template` | Force template mode. Refused if the route has no archetype — there is nothing to build against |

## Non-negotiable boundaries

1. **Never write outside `.parity/`** and the project's own source tree. Generated
   scaffolding is read-only background — read it for its rules, never edit it.
2. **Browser automation points at the reference app only.** The clone side is measured
   by the local extractor against the dev server, never by driving a browser at our
   own app.
3. **Structure, layout, and behavior only.** Never copy the reference's article text,
   headlines, or editorial copy into specs or seed data — that content is originally
   authored. Specs describe how the page is *built*.

## P0 — Preflight

Read `.parity/SYSTEM_DESIGN.md`, `module-catalog.json`, `scope-ledger.json`,
`deviations.json`, `page-inventory.json`, and `tokens.json`.

**Refuse to proceed if `SYSTEM_DESIGN.md` is not `reviewed` or `partial-reviewed`** — tell the user
to run `/parity-bootstrap` or review its output first. Building on an unreviewed
taxonomy is how a wrong assumption gets baked into ten pages.

**Then check `.parity/scope.json`, if it exists.** It names the routes this operator is
accountable for.

- Route **inside `owns`** → proceed.
- Route **outside** → **refuse**, and name it as someone else's. A partial bootstrap
  derived only the routes in scope, so there is nothing here to build against — and
  building a teammate's page from a session that never studied it is how two people
  produce two answers to one question.
- **No `scope.json`** → no scoping; behave exactly as before.

Two things scope must never restrict:

- **Reuse.** Read the whole repo. You have to see every component to reuse one, and a
  scoped session that only reads its own routes will rebuild what already exists — the
  precise failure the catalog is for.
- **Blast-radius warnings.** If a change touches a component another route renders, say
  so even though that route is not yours. That is the case you most need to hear about.

Findings, though, **are** scoped: do not report diffs on routes outside `owns`. They are
not this operator's to act on, and a report full of other people's findings is one nobody
reads.

### Resolve the mode

Read this route's `mode` from `page-inventory.json` (cached from its archetype's Step 7.5
verdict). A route with no archetype is `per-page`. `--per-page` / `--template` override
it; say which mode you are in and why, before anything else.

**Template mode** — also read `templates/<archetype>.json`. Declare, per module the
archetype expects: **REUSE** / **EXTEND** / **NEW**, plus any scope-ledger entry that
applies.

**Per-page mode** — there is no template to read, and the module list is not known until
P1. Declare the reuse position after the capture instead, against `module-catalog.json`
alone. Everything else in this phase is unchanged.

Present the mode, the reuse declarations you can make, and applicable ledger entries
before touching code.

### What the mode changes

Only two phases differ. **P1 and P3–P6 are identical in both modes** — same capture, same
diff, same gates. The verification spine is the reason per-page mode is a real mode and
not a downgrade.

| | template | per-page |
|---|---|---|
| P0 | Read the archetype template; declare REUSE/EXTEND/NEW against its slots | No template; declare against the catalog after P1 |
| P2 | Spec records **deltas only** | Spec is **self-contained** |
| Reuse gate | Modules should mostly resolve REUSE/EXTEND | Modules default NEW; second occurrence triggers extraction |

## P1 — Capture  ·  gate

Run the extractor against the reference route:

```
${CLAUDE_PLUGIN_ROOT}/extractor/extract.js
```

Load it via the browser tool's script evaluation, then call
`window.__parityExtract({ kind: 'reference', route, archetype, fontRoles, moduleSelectors })`.
Follow `${CLAUDE_PLUGIN_ROOT}/extractor/run-reference.md`.

**Capture twice and diff the two runs.** Whatever differs between two identical
captures is volatile by definition — ads, live figures, timestamps, rotating content —
and lands in `volatility.ignore` automatically. Never hand-maintain that list.

Write `.parity/pages/<route>/capture.json` — or
`.parity/pages/<route>/<fixture>/capture.json` when the page varies by state or role.
Pass `--fixture` and `--actor` to `run-local.js` so both sides record which state was
measured; the diff refuses to compare captures that disagree on either. Schema and
reasoning in `${CLAUDE_PLUGIN_ROOT}/templates/ARTIFACTS.md`.

**A route is not a page once the app has state.** The empty, error and permission-denied
renderings never show up in a default capture, and they are where a build most often
diverges. Capture them as separate fixtures rather than assuming one capture covers the
route.

Then:

- Flag every module matching a `scope-ledger` detection signal.
- List anything in `unmatched` — those are new modules or a gap in the taxonomy.
- Note which facts are `behavior` (observed) rather than extracted.
- **If the extractor missed something visibly on the page, log it** — append an entry to
  `.parity/tool-feedback.jsonl` (schema in `templates/ARTIFACTS.md`). A pattern the
  capture cannot see is a tool gap, and it will cost the next project the same pass.

### Downgrade check (template mode only)

The capture is the first hard evidence that this page actually belongs to its archetype.
Test it before building on the template. **Downgrade this route to per-page** if either
holds:

- any non-optional slot in the template is absent from the capture, or
- more than 30% of captured modules are `unmatched` by the template

When it downgrades: say so, continue in per-page mode from P2 onward, and record a
prediction miss against that archetype so its accuracy reflects reality. Do not silently
proceed with a template the page has just contradicted.

This is not hypothetical. A topic landing was routed to a category archetype it half
matched — it carried that archetype's masthead but the *hub* archetype's headed archive —
and building it as a delta spec produced 89 mismatches across 226 checks. The capture
already contained every fact needed to catch it one phase earlier.

## P2 — Spec  ·  gate

Write `.parity/pages/<route>/spec.md`. Its shape depends on the mode.

**Template mode — deltas only.** Record only what this page adds or changes relative to
the archetype template. Do not re-describe the template: a per-page doc that restates
shared facts is how three pages end up with three divergent descriptions of the same
layout, and how a template fix silently fails to reach the pages built on it.

**Per-page mode — self-contained.** There is no template to delta against, so the spec
carries the whole page: full module order, band and column structure, and the measured
facts per module. Writing a partial spec here loses information that exists nowhere else
— the capture is data, and the spec is where the reading of it lives.

Both modes include: new modules needing catalog entries, scope-ledger handling that
applies here, data requirements, and open questions.

## P3 — Skeleton

Build layout and structure with **no real data**. Placeholder content only.

**Tag every module root with `data-parity-module="<catalog-id>"`.** This is required, not
optional. The reference app usually leaks a component identity signal in its
build-generated class names, but a clone built with a utility-class framework
(Tailwind and similar) leaks nothing — every element is a pile of `h-[250px] mx-auto`
and no heuristic recovers "this is the hero". The attribute makes clone-side
extraction exact instead of guessed, makes module identity greppable in our own
source, and records which catalogued module each component implements.

Without it, the extractor finds zero modules on our side and the fidelity check has
nothing to compare. (`moduleSelectors` in the archetype template is the fallback for
a page whose components can't be touched.)

Structure first, data second — always. A layout bug found under placeholder content
is a layout bug; the same bug found after wiring data reads as a data bug and costs
far more to isolate.

Apply the **reuse gate** before creating any component:

- **REUSE** — use the catalogued component as-is.
- **EXTEND** — add a variant prop to the existing component. Never fork it.
- **NEW** — build it, and record the catalog entry **in this same change**, never
  later. Mark `one-off` only with a written rationale.
- A module reaching its **second** occurrence gets extracted into a shared component
  now, not eventually. Two instances is evidence; one was a guess.

## P4 — Verify skeleton  ·  gate

Start the dev server. Run the local extractor against the local route, then diff:

```bash
node ${CLAUDE_PLUGIN_ROOT}/extractor/run-local.js  --route <route> --out ours.json
node ${CLAUDE_PLUGIN_ROOT}/extractor/diff.js       --reference capture.json --ours ours.json
```

Fix every real mismatch and re-run until clean. Expected mismatches — scope-ledger
entries and `deviations.json` entries — are reported separately and do not count as
failures.

**If the diff reports noise** (findings that aren't real defects), fix the tolerances
or the volatility list, not the page. A checker that cries wolf gets ignored within a
day and deleted within a week, which costs more than never building it.

**And log it.** Append the finding to `.parity/tool-feedback.jsonl` with the field path
and the function you suspect. Tuning a tolerance fixes this run; the feedback entry is
what stops the next project rediscovering it. Include `evidence` (a file and a field) and
`suspectedCause` (a function) — an entry without both is not actionable.

## P5 — Data  ·  gate

Schema, seed, and wire real data through the project's own blessed data-fetching
pattern (recorded in `SYSTEM_DESIGN.md`).

Seed content is **originally authored** — never lifted from the reference app. Seed
realistically: valid relationships, sane orderings, no placeholder junk, and enough
volume that the page's real behavior is representable.

## P6 — Verify and record  ·  gate

1. Re-run the diff. Layout must still hold with real content in place — real strings
   wrap differently than placeholders.
2. Update `module-catalog.json` (statuses, components, variants, occurrences).
3. Update `page-inventory.json` (`buildStatus`, `lastCapture`).
4. Append any scope decision made during the build to `scope-ledger.json`, with
   detection signals so it's recognized elsewhere.
5. Append any deliberate departure to `deviations.json`, with rationale. **Any entry
   with `status: "tool-gap"` needs a matching line in `.parity/tool-feedback.jsonl`** —
   the deviation stops the diff reporting it today, the feedback entry is what gets it
   fixed. A suppression with no feedback entry is how a gap becomes permanent.
6. If this route downgraded at P1, record the prediction miss against its archetype —
   decrement its `predictionAccuracy` and note the route. An archetype whose verdict
   stops matching reality should lose template mode on the next bootstrap, and that only
   happens if misses are written down.
7. In per-page mode, check the catalog for modules that have now reached a **second**
   occurrence: those are extraction candidates, and enough of them across routes is the
   signal that a real archetype exists and `/parity-bootstrap` should be re-run.
8. Run the project's own verify command (type-check / lint / tests) from
   `SYSTEM_DESIGN.md`.

Report: the mode used (and whether it downgraded), modules matched, mismatches
remaining, expected deviations, catalog changes, and anything you could not verify.

## Consults — re-opening the reference mid-build

Property extraction cannot see behavior: whether a carousel loops or clamps, hover and
focus states, whether "load more" appends or paginates, transition timing, overlay
dismissal. Re-opening the reference to answer those is **encouraged** — with full
project context you know what to look for, which a cold session doesn't.

It is a **typed, recorded action**, not free browsing. Every consult records the
question, the answer, the timestamp, and where the answer landed.

Two rules make it safe:

1. **Consults write back.** Anything true of the archetype rather than just this page
   goes into the archetype template or `SYSTEM_DESIGN.md`. Otherwise the session
   learns something and the knowledge dies with the session — which is exactly how
   the same fact gets rediscovered five times.
2. **A consult that contradicts an existing artifact is a conflict event.** Surface it
   to the user; never silently resolve it in favor of the live site. The live site
   wins on facts, but the contradiction may mean already-built pages are now wrong —
   and that's a decision for the user, not a detail to absorb.

## Reporting rules

- Report the diff as it is. Never describe a page as matching when findings remain.
- Never silently narrow scope. If a module was skipped, say which and why.
- Distinguish **verified** (extractor confirms) from **built** (written, unverified).
- If the reference changed since `capture.json` was taken, say so before building on it.
