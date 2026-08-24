---
name: scope-ledger
description: Record and apply scope decisions and deliberate deviations while cloning. Use when a feature is being excluded, deferred, or stubbed, when an excluded feature turns up on a new page, or when knowingly departing from the reference.
---

# Scope ledger and deviation register

Two artifacts, one mechanism: facts about what we deliberately did *not* build the
same as the reference, recorded so they're applied consistently and so the fidelity
gate doesn't report them forever.

- `.parity/scope-ledger.json` — features excluded, deferred, or stubbed.
- `.parity/deviations.json` — places we knowingly diverge from the reference (an
  accessibility correction, a substituted font, a bounded dataset standing in for an
  unbounded one).

## The problem this solves

A scope decision written into one page's requirements doc is invisible to the session
building a different page. Six weeks later someone hits the same feature, has no idea
a standing decision exists, and either builds it (blowing scope) or excludes it a
*different* way (producing an inconsistent app). The ledger is global for exactly
this reason.

## When excluding something

Record all five fields — an entry without detection signals is a note, not a ledger
entry, and notes don't get applied:

1. **`decision`** — `out-of-scope` / `deferred` / `stubbed`.
2. **`rationale`** — why. Future readers need the reasoning to know whether it still
   holds.
3. **`detectionSignals`** — how to *recognize* this feature elsewhere: URL patterns,
   selectors, class families, link targets. This is the field that makes the ledger
   active rather than documentary.
4. **`handling`** — what to do on sight: `omit` / `render-disabled` /
   `non-interactive` / `placeholder-target`.
5. **`date`**.

## When capturing a page

Check every captured module against every ledger entry's signals. A match means:

- Flag it in the capture summary before building.
- Apply the recorded handling — the *same* handling used elsewhere, not a fresh
  judgment call.
- The fidelity diff reports it as an **expected** mismatch, not a failure.

That last point is what keeps the gate usable. An out-of-scope module reported as a
failure on every run trains everyone to ignore the report, and a report nobody reads
is worth less than no report at all.

## When deviating deliberately

Add to `deviations.json` with the exact `expectedMismatch` paths the diff should
tolerate — for example `modules.section-header.elements.title.tag`. Include the
rationale.

Legitimate deviations tend to be:

- **Accessibility corrections.** The reference ships a real a11y defect (a
  non-semantic heading, a div-as-button) and the clone fixes it. Visual appearance
  still matches; the tag doesn't.
- **Substituted assets** — fonts, imagery — where the original isn't available.
- **Bounded data** standing in for live or unbounded sources.

## Rules

- **Path-scope deviations narrowly.** Suppress the specific field, never a whole
  module — a blanket suppression hides the module's real defects too, and on a
  data-heavy page that's most of the page going unchecked.
- **A deviation needs a rationale.** Without one it's indistinguishable from a bug
  someone gave up on, and the next reader can't tell whether to fix it.
- **Re-examine `deferred` entries.** Unlike `out-of-scope`, deferred means "later" —
  surface these when the relevant page comes up rather than letting them silently
  become permanent.
- **Never expand scope silently.** Building something the ledger excludes is a
  decision for the user, not a detail to absorb mid-build.
