# Tool gaps

Things to **build**. (Things to **undo** are in [`STOPGAPS.md`](STOPGAPS.md) — different
question, different file.)

Fed by `.parity/tool-feedback.jsonl` in each project, aggregated by `/parity-improve`.
Every entry here was found by using the tool, and the point of writing them down is that
the next project does not have to find them again.

Ranked by **distinct projects first, then recurrence, then impact** — a gap seen in three
projects is a property of the tool; the same gap five times in one project may be one
site's quirk.

---

## 1 · The extractor cannot say "not measured"

**Cluster.** Three separate symptoms, one cause, one fix.
**Projects** 1 · **Hits** 3 · **Worst impact** a module rebuilt wrongly and reverted

| Symptom | Where |
|---|---|
| `arrangementOf` returns null for the reference's feed families but measures ours | `extract.js arrangementOf()` |
| `itemGridOf` resolves different DOM levels per side — their images vs our columns | `extract.js itemGridOf()` |
| Element role resolution (dek / eyebrow) resolves on their markup, not ours | `extract.js elementsOf()` |

Each emits `undefined` for "I did not measure this", which is indistinguishable from "this
does not exist". A consumer cannot tell no-signal from no-element, and the diff reports
the difference as a defect either way.

**It has already caused a wrong build.** An archive was rebuilt headline-only because the
reference capture said `arrangement: undefined`; it measured 758px against the reference's
1412px and was reverted. The row height alone should have refuted it — but the field read
as evidence of absence.

**Fix shape:** every optional field carries an explicit measurement state, so absent and
unmeasured are different values. Then the diff can skip unmeasured fields instead of
comparing them, and nothing downstream has to guess. `itemGridOf` additionally needs to
record *which* DOM level it resolved to, so two sides can be compared at the same level
or not at all.

---

## 2 · EP1 cannot use what the build learned — **FIXED 2026-08-23**

**Projects** 1 · **Hits** 1 · **Worst impact** a documented recovery path that did not work

`parity-page.md` P6 and the module-reuse skill both tell the operator that when enough
modules recur across per-page routes, they should "re-run `/parity-bootstrap`" to promote a
real archetype.

**It did not work.** S3 clustered by sampling the reference site, and `module-catalog.json`
appeared in `parity-bootstrap.md` only as an *output*. Re-running re-derived from the same
site with the same signals and reached the same verdict. The thing that had changed was
*our* catalog — the record of which modules actually recurred across routes we built — and
EP1 could not see it. Per-page was a one-way door while two docs claimed otherwise.

**Fixed:** S0 now reads `module-catalog.json` and `page-inventory.json` when they exist,
and S3 uses catalog occurrence data as an additional clustering signal on a re-run, with
the requirement to say when a cluster came from catalog evidence rather than the
reference's markup — it is a weaker signal and a reader should be able to tell.

---

## 3 · Unknown flags used to be accepted silently

**Projects** 1 · **Hits** 1 · **Status** fixed 2026-08-23 · **Worst impact** a whole
session of wrong numbers

`diff.js` accepted `--scope` (instead of `--scope-ledger`), loaded no scope ledger, and
reported seven deliberate out-of-scope decisions as failures. Every run looked successful
and every number was wrong, for an entire session, because nothing said the flag was
unrecognised.

**Fixed:** unknown arguments now exit 2 with the list of valid flags.

Kept here rather than deleted, because the class of bug is worth remembering: a gate that
accepts a typo and prints a confident wrong number is worse than one that crashes. Any new
flag surface should fail closed.

---

## 4 · Behaviour is not measurable at all

**Projects** 1 · **Hits** 1 · **Status** accepted limitation

Property extraction cannot see whether a carousel loops or clamps, hover and focus states,
whether "load more" appends or paginates, transition timing, or overlay dismissal.

Currently handled by recording agent observation in a `behavior` section, explicitly
labelled to keep it distinct from measurement. That is honest, but it is not verification —
nothing re-checks it on later runs, so a behaviour regression is invisible.

**No fix proposed.** Listed so the limit is not mistaken for coverage. If it ever gets
built, it is a different mechanism from the extractor, not an extension of it.

---

## Resolved

Entries stay after they are fixed. A gap that comes back matters, and that is invisible
if the history is deleted.

| Gap | Fixed | Was |
|---|---|---|
| Wildcard deviations never matched | 2026-08-23 | `expectedPaths` did an exact string lookup, so every entry containing `*` silently suppressed nothing — reviewed deviations were reported as failures forever |
| Broad deviations masked real defects | 2026-08-23 | The wildcard fix over-corrected: `modules.*.a11y.headingLevel` suppressed a module rendering *no* heading. Deviations now carry optional value guards |
| Module presence ignored the register | 2026-08-23 | `page.moduleOrder` consulted only the scope ledger, so a documented absence could never be excused |
| Guards written for absent values never matched | 2026-08-23 | JSON can only express "no value" as `null`, but captures report absent fields as `undefined`; strict `!==` rejected every such guard |
| Unknown flags accepted silently | 2026-08-23 | See §3 |
| EP1 could not use catalog evidence | 2026-08-23 | See §2 — `per-page` was a one-way door while two docs claimed otherwise |
