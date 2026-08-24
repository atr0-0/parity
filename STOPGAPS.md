# Stopgaps

Temporary deviations from the plugin's intended design, made while validating it against
its first real project. Each row records what, why, and the exact undo.

This is a maintainer's checklist. It is not read by a session at runtime, and nothing in
the plugin depends on it.

**Why this file exists.** The first validation project began before `/parity-bootstrap` (EP1) existed,
so it never ran the bootstrap that provisions a project's artifact set and its
project-local workflow doc. Project-specific facts and setup checks therefore had no
project-local home and landed in the shared plugin instead. That is the common cause of
rows 1–5. Rows 6–7 have a different cause, noted per row.

The contract at stake is stated in `README.md`: *"The plugin holds zero facts about any
app — only procedures for deriving them."*

**Status:** rows 1–4 are resolved. Rows 5 and 7 are unblocked only when the current
project finishes or the plugin is installed — both are load-bearing for sessions in
flight, and deleting them mid-run would strand real work. Row 6 is ready whenever.

---

## Register

### 1–4. `preflight.sh` app-specific checks — **RESOLVED 2026-08-23**

**Was** `preflight.sh` hardcoded `frontend/tailwind.config.ts`, the token name `pageWidth`, the
selector `.max-w-page`, a hardcoded default project path, FastAPI's
`/api/docs` health route, and the RL generator's `./run.sh --dev`.

**Now** the script holds no app facts. The project declares them in
`.parity/preflight.json` (schema in `templates/ARTIFACTS.md`) and the plugin executes
whatever is declared:

```jsonc
{ "frontendUrl": "…", "backendUrl": "…", "backendHealthPath": "/api/docs",
  "devServerHint": "start it: ./run.sh --dev",
  "renderChecks": [ { "name": "container token",
                      "configFile": "frontend/tailwind.config.ts",
                      "pattern": "bb: \"([0-9]+)px\"",
                      "selector": ".max-w-page", "property": "maxWidth",
                      "remedy": "…" } ] }
```

The render check kept its whole point — it verifies by **rendering**, not by grepping the
stylesheet, because a grep once reported "compiled" for a token that had not compiled
(the number appeared elsewhere in the CSS while the rule that mattered still carried the
old value). The plugin now runs that check without knowing what a `pageWidth` token is.

`PARITY_PROJECT` has **no default** any more: `--project DIR` or the env var, or it exits 2.
A wrong default silently checks the wrong project, which is worse than an error.

*Follow-on:* the documented invocation in `PROMPTING.md` gained `--project`, since the
path is a project fact and that is the project's own doc.

### 5. `PROMPTING.md` — the whole file

**Where** `PROMPTING.md`
**What** A manual workflow for driving the extractor by hand, with absolute paths to one project, this project's dev-server ports, and its container-token caveat.
**Why** The most direct EP1 casualty. With the plugin uninstalled there are no slash
commands, and with no EP1 run there is no `WORKFLOW.md` — the project-local doc that is
*supposed* to hold exactly this. `PROMPTING.md` is that file, living in the wrong repo.
**Undo** Delete it once the plugin is installed and EP1 has emitted `WORKFLOW.md` for the
project. Nothing in it needs to survive: the session-isolation guidance it carries is
superseded by `/parity-sync`, and the rest is EP2's job.
**Safe when** Plugin installed and `WORKFLOW.md` exists.
**Blocked now** — eight sessions are actively working from this file. Deleting it while
they are mid-page would strand them. It goes when the RL finishes or the plugin is
installed, whichever comes first.

### 6. `WORKSPACES.md`

**Where** `WORKSPACES.md`
**What** A narrative of the specific session-collision incident that prompted the
session-workspace pattern, mixed with the generic pattern itself.
**Why** Written before `/parity-sync` existed, when the pattern was a hand-rolled
convention rather than a command.
**Cause** Not EP1. This one is about the tool being developed while used.
**Undo** Fold the generic pattern into `commands/parity-sync.md`; delete the incident
narrative. A maintainer wanting the history can read this register.
**Safe when** `/parity-sync` ships.

### 7. Forked copies of the plugin's own JavaScript

**Where** `.sessions/s-*/extractor/`
**What** Per-session copies of `extract.js`, `diff.js`, `volatility.js`, `run-local.js`.
**Why** Not an EP1 gap. Sessions were using the extractor while other sessions were
editing it: one session read `extract.js` mid-refactor — helpers already had new
signatures, the call site did not — and every capture crashed. Copying froze a known-good
version.
**Cost** The workaround has its own failure mode, which also occurred: a copy went stale
against a fixed `diff.js`, silently lacked `--map` route-overlay support, and produced 17
phantom `moduleOrder` mismatches that were chased as page bugs.
**Undo** Delete the directories. Sessions read the installed plugin read-only; only
project artifacts are session-scoped, which is what `/parity-sync` manages.
**Safe when** The plugin is installed and no longer being edited during use.
**Blocked now** — eight session workspaces exist and are in use. `ls .sessions/` to see
them. Delete after the last one finishes, not before.

---

## What EP1 never produced here

Listed because it explains gaps a reader will otherwise find surprising.
That project's `.parity/` contained `tokens.json`, `scope-ledger.json`, `deviations.json`,
`id-map.json`, and one archetype template — and is missing:

| Missing | Consequence |
|---|---|
| `SYSTEM_DESIGN.md` | No single doc a new session reads instead of re-deriving; every session rebuilt context from the pages themselves |
| `page-inventory.json` | No route→archetype map, so routing decisions were made per page by hand |
| `module-catalog.json` | **The reuse gate has nothing to consult.** This is why component reuse in that project has been ad hoc, and why the decision was made not to retrofit it |
| `WORKFLOW.md` | Its absence is why `PROMPTING.md` exists (row 5) |

Only one archetype (`subnav-page`) was ever derived, and it was derived by hand during
page work rather than by clustering the site.

---

## Known tool gaps

Moved to [`TOOL-GAPS.md`](TOOL-GAPS.md), which is fed by `tool-feedback.jsonl` from real
runs. Different question from this file: stopgaps are *things to undo*, tool gaps are
*things to build*.
