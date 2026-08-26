---
description: Fix a reported bug on an already-built page. Loads the project's parity artifacts for cold-start context, checks the report against recorded decisions before touching code, says whether the diff should have caught it, and names the other pages the fix could break.
argument-hint: "<what was reported>" [--route <route>]
---

You are running **/parity-fix**.

`$ARGUMENTS` contains a bug report **in the reporter's own words** — a QA ticket, a
screenshot description, a sentence from a colleague. Optionally `--route <route>` when the
operator already knows which page.

## What this is for

`/parity-page --verify-only` starts from a **route** and asks what the measurement says.
This starts from a **human observation** and asks what it means. The gap between those is
the work:

- The measurement can be wrong. A field the diff passes can still be visibly wrong on
  screen, and that is a hole in the gate, not just a bug on the page.
- The report can be wrong. A build that matches its capture is correct, and saying so with
  evidence is a real answer.
- The "bug" can be a decision. Someone deliberately chose this, wrote down why, and a
  fresh session has no memory of it.

It is built to be run by a session with **no context of the build** — the artifacts carry
the context.

## Speed

Every check below is automatic. **Stop only at a genuine fork**, and there are exactly two:
an ambiguous target, and a report that turns out to be a recorded decision — plus a
conditional one at the end when re-verification would cost real time.

A page-local bug with no recorded decision, already visible in the diff, should run start
to finish **without pausing**. If you find yourself stopping to report rather than to ask,
do not stop — put it in the final summary.

---

## 1 — Orient, locate, triage

Read `.parity/SYSTEM_DESIGN.md`, `module-catalog.json`, `page-inventory.json`,
`id-map.json`, `deviations.json`, `scope-ledger.json`, `tokens.json`.

**Refuse if `SYSTEM_DESIGN.md` is not `status: reviewed`** — the same gate `/parity-page`
applies, for the same reason.

**Say what you could not load.** A project that never ran `/parity-bootstrap` has a partial
set: with no `module-catalog.json` there is no component map and no blast radius later.
Report that plainly and continue degraded — never let a missing artifact read as "nothing
found".

Then, in one pass:

**Locate.** Resolve the report to a **route**, a **module id**, and a **component path**.
The catalog's `component` and `referenceName` fields and `id-map.json` (their names ↔ ours)
are what make a plain-English description resolvable. If `--route` was given, take it.

> **Stop if genuinely ambiguous.** "The newsletter box" on a site with three newsletter
> modules is a question, not a guess. Ask which, listing the candidates with their routes.

**Triage — before opening any file to edit.** Match the report against `deviations.json`
and `scope-ledger.json`.

> **Stop on a hit.** Show the entry id, its rationale and its date, and ask whether to
> honour it or revisit it. Never silently overwrite a recorded decision: that is how a
> defect the team deliberately avoided gets reintroduced by someone who never saw the
> reasoning. Never simply refuse either — decisions are sometimes wrong, and a report from
> a real user is legitimate grounds to reconsider one. It is the operator's call.

**Re-run the diff** for the route, with `--map`, `--deviations` and `--scope-ledger`. Note
whether `capture.json` is stale relative to the component or template it depends on; say so
if it is, because you may be comparing against an old truth.

### Classify — report this, do not gate on it

| The diff | Means | Do |
|---|---|---|
| already flags it | The gate worked; the build ignored it | Fix the page |
| is clean and the report is right | **The gate has a blind spot** | Fix the page **and** log a `false-negative` |
| is clean and the report is mistaken | The build matches its capture | Report the measurement, change nothing, stop |

The middle row is why this command exists. A defect the diff *should* have caught will let
the next one through as well, so the finding is worth more than the fix. Record it in
`.parity/tool-feedback.jsonl` with `kind: "false-negative"`, the field path it should have
compared, and the function you suspect — schema in `${CLAUDE_PLUGIN_ROOT}/templates/ARTIFACTS.md`.

The third row is a legitimate outcome, not a failure to try. State what was measured and
why the build is correct.

---

## 2 — Fix

Apply the fix through the **reuse gate**: extend a shared component with a variant prop,
never fork it. A one-page override on a shared component is how thirty copies start.

Re-open the reference **only** when the capture cannot answer — behaviour, interaction, or
a fact nothing captured. Follow the consult protocol in `parity-page.md`: typed, recorded,
and it **writes back** to the archetype template or `SYSTEM_DESIGN.md` when the answer is
true of more than this page.

---

## 3 — Verify, blast radius, record

1. **Re-run the diff.** Clean, or only expected deviations. A fix that does not move the
   measurement did not fix the measured thing — say so rather than declaring victory.

2. **Blast radius.** Read `occurrences` for the touched module and list every *other* route
   using it, with each one's capture freshness. This is the step that catches the classic
   failure: a shared-component fix for one page silently breaking another.

   > **Stop only if** re-verifying costs real time — a module on twenty routes is twenty
   > captures. Present the list and let the operator choose. A page-local fix has no blast
   > radius and no stop.
   >
   > With no `module-catalog.json`, say the blast radius **cannot be computed** and why.
   > Never report "no other routes affected" when the truth is "nothing to check against".

3. **Record.** The `false-negative` entry if the classification found one; catalog and
   inventory updates; any new deviation or scope decision made during the fix, with
   rationale.

4. Run the project's own verify command from `SYSTEM_DESIGN.md`.

**Report:** what was reported, what it resolved to, which of the three classifications
applied, what changed, which routes are affected and whether they were re-verified.

---

## Reporting rules

- **Never fix past a recorded decision without being told to.** The whole point of the
  register is that it outlives the session that wrote it.
- **Never call a bug fixed on the strength of the edit.** The diff says whether it is
  fixed.
- **Say when the report was wrong.** With the measurement that shows it. That is a useful
  answer and it protects a correct build from being "fixed" into a wrong one.
- **Never skip the feedback entry when the diff missed it.** Fixing the page and leaving
  the gate blind means the same class of defect ships again, and the next person has no
  way to know it was ever seen.
- **Distinguish what you verified from what you changed.** They are not the same claim.
