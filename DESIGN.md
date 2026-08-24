# Design notes

Why parity works the way it does. The [README](README.md) covers what it does; this
covers the reasoning, and is the file to read before changing how verification behaves.

## Why measure instead of eyeballing

A page can look finished and still be wrong in ways nobody notices until later: a whole
block missing from a column you didn't scroll down to, a heading two pixels off, a
carousel with no arrows. Screenshots don't catch these; a person comparing two browser
tabs catches maybe half.

So the same code reads both pages and diffs the results:

```
read(their page)  →  their measurements
read(your page)   →  your measurements
compare           →  a list of specific differences
```

Because one function reads both sides, the two results are directly comparable — and
there's no second "checker" to write and keep in sync as the first one changes.

## What it does that a screenshot diff doesn't

- Tells you **which block of the page** is wrong, not which pixels
- Knows the difference between a **real defect** and content that changes on every load
  (ads, tickers, timestamps)
- Records **deliberate** differences once, so they stop being reported forever
- Refuses to compare two pages captured at different window sizes, instead of emitting
  hundreds of meaningless findings

## Keeping the gate trustworthy

A noisy check gets ignored within a day and deleted within a week, so most of the
design effort went here:

- **Volatility is derived, not declared.** Capture the reference twice; whatever
  differs between two runs of the same page is live content. Nobody maintains a list.
- **Suppression is field-level.** A module with one live figure stays checked
  everywhere else. Module-level suppression would blind the check to that module's
  real defects — and on a data-heavy page, that's most of the page.
- **Known gaps aren't failures.** Scope-ledger and deviation entries are reported
  separately as expected. A check that reports the same known gap forever trains
  people to stop reading it.
- **Content-dependent dimensions aren't compared.** Height and vertical offset differ
  permanently because our copy is never the same length as theirs. They *are*
  compared in volatility mode, where sensitivity is the goal.
- **Mismatched environments refuse to compare.** A viewport difference exits 2 rather
  than emitting hundreds of phantom geometry findings.
- **Calibration gate:** a page diffed against itself must produce zero findings.

## Design notes

**Reliability is measured, not asserted.** Archetype clustering uses the reference's
own build-generated class families where available — two pages sharing a family *are*
the same component in its source, which is evidence rather than inference. Where
that's unavailable (utility-class frameworks, per-build hashes) it falls back through
structural and geometric fingerprints to human labeling, recording which of those
signals it had to settle for, and how confident that makes it. Then it *tests* the result: pages the clustering claims
belong to an archetype but that were never sampled get captured and checked, and the
accuracy is reported. A taxonomy with a number is a finding; one without is a claim.

**Shared components are a fidelity mechanism, not just hygiene.** If the reference
renders one module in thirty places from one implementation and the clone implements
it thirty times, it will diverge thirty ways — and divergence is the failure being
measured. Hence a module catalog from page one and a reuse gate at creation time.
Extraction happens on the *second* occurrence, though: one instance is a guess, two is
evidence.

**Captures are data, not prose.** A paragraph saying "the title renders at 52px" can't
be checked by anything. `{"fontSize": 52}` can.

**The two sides are asymmetric, so the clone declares its modules.** A reference app
built with CSS modules leaks a real component identity signal in its class names. A
clone built with a utility-class framework leaks none — every element is a pile of
`h-[250px] mx-auto`, and no heuristic recovers "this is the hero". So the build tags
each module root with `data-parity-module="<catalog-id>"`, making clone-side extraction
exact rather than guessed and module identity greppable in your own source. Reference
side: fingerprint discovery. Clone side: declared markers.

## It reports its own gaps

Every limitation in this tool was found by using it, and without a way to record them each
one gets found again by the next project.

So when a session hits something the tool got wrong — a pattern the capture could not see,
a field that resolves on one side only, a finding that was not a real defect — it appends a
line to `.parity/tool-feedback.jsonl` with the evidence and the function it suspects.
`/parity-improve` aggregates those across projects, ranks them by how many *distinct*
projects hit each one, and updates [`TOOL-GAPS.md`](TOOL-GAPS.md).

One rule makes it work: **a suppression needs a paired feedback entry.** Silencing a known
tool artifact in `deviations.json` stops the diff complaining today; the feedback entry is
what gets it fixed. Without the pairing, suppressing costs one line and fixing depends on
somebody remembering.

