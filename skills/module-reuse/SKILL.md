---
name: module-reuse
description: Apply the reuse-first gate before creating any component while cloning a page. Use when about to write a new component, or when deciding whether a module is a variant of an existing one or genuinely new.
---

# The reuse gate

Run this **before** creating any component, not after. The gate exists because a
written reuse rule loses to expedience: mid-page, "grep the tree for something
similar" is slower than just writing the component, so the component gets written.
A catalog makes the question answerable in seconds, which is the only reason it gets
asked.

## Procedure

1. **Read** `.parity/module-catalog.json`.
2. **Match on fingerprint first, name second.** The reference's own class family is
   the reliable key — if this module shares a family with a catalogued one, it *is*
   the same component in the reference's source, whatever it looks like. Names lie;
   fingerprints don't.
3. **Return one of three verdicts, explicitly:**

| Verdict | When | Action |
|---|---|---|
| **REUSE** | A catalogued component covers this as-is | Use it. Add an occurrence entry. No new file |
| **EXTEND** | A catalogued component is close | Add a variant prop (`variant`, `size`, `columns`, a slot). **Never fork the file** |
| **NEW** | Nothing matches | Build it, and write the catalog entry in the same change |

## Rules

- **Record NEW immediately.** In the same change that creates the component, never
  "later." Later is how a catalog becomes fiction, and a fictional catalog is worse
  than none because it gets trusted.
- **Second occurrence triggers extraction.** One instance was a guess; two is
  evidence. When a NEW module appears a second time, extract it into a shared
  component *then* — not eventually.
- **One-offs are legitimate, but must be declared.** Set `status: "one-off"` with a
  written `oneOffRationale`. Forcing a genuine one-off into a shared component
  produces a component with nine boolean props, which is worse than two files.
- **Extend over fork, always.** A forked atom is the single largest source of drift:
  the fork and the original diverge silently, and a fix applied to one never reaches
  the other.
- **Update occurrences even on REUSE.** The occurrence list is what makes the
  second-occurrence rule work. Skipping it breaks the mechanism.

## In per-page mode, the catalog is how archetypes get discovered

When `/parity-page` runs per-page — no archetype, or one that failed its routing verdict —
there is no template listing the modules to expect. The reuse gate does not disappear; it
inverts.

Template mode asks *"the archetype expects a hero here — do we already have one?"*
Per-page mode has no such expectation, so every module starts as **NEW** and the catalog
is the only thing that can tell you otherwise. Consult it per module anyway: a page with
no archetype can still reuse a module built for a page that had one.

The second-occurrence rule does the real work here. A module appearing on one page is a
guess; the same fingerprint on a second page is evidence, and that is when it gets
extracted into a shared component. Over several pages this accumulates bottom-up into
exactly what clustering failed to find top-down.

**So per-page mode is a starting point, not a dead end.** When enough routes share
extracted modules, that is the signal to re-run `/parity-bootstrap`: the members now exist
for a cluster that previously had one page, and the archetype can earn template mode on
its next verdict. Say so when you notice it — the operator cannot see the pattern
accumulating in the catalog.

## Why this matters more for a clone than a normal app

The reference app is itself built from a component system. If one of its modules
renders in thirty places from one implementation and we implement it thirty times, we
will diverge in thirty small ways — and divergence *is* the fidelity failure being
measured. Duplication here doesn't just cost maintenance; it directly degrades the
thing the project exists to achieve.

It also makes verification cheap. One implementation means verify once and every page
using it inherits the result. Thirty copies means thirty verifications, and the ones
nobody re-checks are where the drift lives.
