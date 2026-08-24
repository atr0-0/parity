# parity

**Rebuild a website, and prove your copy matches.**

A Claude Code plugin. It reads how a site is built, rebuilds its pages in your project,
then measures both and tells you exactly where they differ.

## See it

```
$ node extractor/diff.js --reference capture.json --ours ours.json --map id-map.json

fidelity: /pricing

  page
    FAIL  page.layout.columns.rail.width: expected 400, got 376  (Δ24, tol 1)
  section-header
    FAIL  elements.title.typography.fontSize: expected 52, got 48  (Δ4, tol 0.5)
  plan-grid
    FAIL  grid.columns: expected 3, got 2  (Δ1, tol 0)
    FAIL  geometry.container: expected "content-column", got "rail"

  29 checks · 4 mismatches · 8 expected · 1 volatile module · 3 volatile fields
```

Exit `0` clean · `1` mismatches · `2` cannot compare.

## Install

```bash
claude --plugin-dir /path/to/parity   # local
/reload-plugins                         # pick up edits
```

Needs `node` and `python3`. Playwright is required only for clone-side capture and loads
lazily. Run `preflight.sh --project DIR` to check the environment.

## Quick start

```bash
/parity-bootstrap https://example.com   # once per project — studies the site, then stops
                                       # review its notes, mark them reviewed
/parity-page /pricing                   # build one page, stopping at each gate
/parity-page /pricing --verify-only     # re-measure after a fix
```

`/parity-page` refuses to build until the bootstrap notes are marked `reviewed`.

## Commands

| Command | When | Writes |
|---|---|---|
| `/parity-bootstrap <url>` | Once per project | `.parity/` artifact set, as `draft` |
| `/parity-page <route>` | Once per page | `pages/<route>/`, catalog + inventory updates |
| `/parity-sync` | When a parallel session finishes | Your session copy, or the shared notes |
| `/parity-improve` | Periodically | `TOOL-GAPS.md` |

| Flag | On | Effect |
|---|---|---|
| `--verify-only` | `clone-page` | Re-measure an already-built page |
| `--unattended` | `clone-page` | No gates. Template mode only, on an archetype already built once |
| `--per-page` · `--template` | `clone-page` | Force a build mode instead of the measured verdict |
| `--pull` · `--push` | `clone-sync` | Merge direction |
| `--tag <session>` | `clone-sync` | Operate on a named session |
| `--since` · `--write` | `clone-improve` | Filter by date · update the backlog |

## Workflow

```mermaid
block-beta
  columns 3

  H1["<b>Step 1 · /parity-bootstrap</b> — once per project"]:3
  S0["<b>S0</b><br/>Check for existing notes"]
  S1["<b>S1–S6</b> · Study the site<br/>setup · pages · grouping<br/>blocks · tokens · scope"]
  S7{{"<b>S7</b><br/>Do the groups predict<br/>pages it never sampled?"}}

  space:3

  REV{{"<b>You review and approve</b><br/>nothing builds until you do"}}
  S8["<b>S8</b><br/>Write the findings as draft"]
  S75{{"<b>S7.5</b><br/>Enough reuse to justify<br/>a shared layout?"}}

  H2["<b>Step 2 · /parity-page</b> — once per page"]:3
  P0{{"<b>P0</b><br/>Does this page have<br/>a shared layout?"}}
  P1["<b>P1</b><br/>Measure the real page"]
  P2["<b>P2</b><br/>Write the build notes"]

  space:3

  P5["<b>P5</b><br/>Add the real content"]
  P4{{"<b>P4</b><br/>Does your build<br/>match theirs?"}}
  P3["<b>P3</b><br/>Build the structure<br/>placeholders only"]

  space:3

  P6["<b>P6</b><br/>Re-verify, then record<br/>what was learned"]
  SYNC["<b>/parity-sync --push</b><br/>share with other sessions"]
  space

  S0 --> S1
  S1 --> S7
  S7 --> S75
  S75 --> S8
  S8 --> REV
  REV --> P0
  P0 --> P1
  P1 --> P2
  P2 --> P3
  P3 --> P4
  P4 --> P5
  P5 --> P6
  P6 --> SYNC

  S7 --> S1
  REV --> S8
  P1 --> P0
  P4 --> P3
  P6 --> P0

  style H1 stroke:#d97706,stroke-width:2px
  style H2 stroke:#d97706,stroke-width:2px
  style S0 stroke:#6366f1,stroke-width:2px
  style S1 stroke:#6366f1,stroke-width:2px
  style S8 stroke:#6366f1,stroke-width:2px
  style P3 stroke:#6366f1,stroke-width:2px
  style S7 stroke:#2563eb,stroke-width:2px
  style S75 stroke:#2563eb,stroke-width:2px
  style P0 stroke:#2563eb,stroke-width:2px
  style P4 stroke:#2563eb,stroke-width:2px
  style REV stroke:#16a34a,stroke-width:2px
  style P1 stroke:#16a34a,stroke-width:2px
  style P2 stroke:#16a34a,stroke-width:2px
  style P5 stroke:#16a34a,stroke-width:2px
  style P6 stroke:#16a34a,stroke-width:2px
  style SYNC stroke:#64748b,stroke-width:2px
```

**Reading it.** Rows run left-to-right, then drop and run back. **Hexagons** are
decisions; **green borders** mark the phases that stop and wait for you.

Five connectors run both ways, and those are the loops: **S1–S6 ↔ S7** regroups when the
grouping fails to predict; **S8 ↔ review** stays blocked until you approve; **P0 ↔ P1**
switches a page off a layout it turns out not to fit; **P3 ↔ P4** repeats until the
measurements match; and **P6 ↔ P0** starts the next page.

### Step 1 · `/parity-bootstrap` — once per project

| | What happens | What you do |
|---|---|---|
| **S0** | Reads existing `.parity/` state. Refuses to overwrite `reviewed` work | Answer refresh-or-stop |
| **S1** | Records the stack from your own config files — framework, styling, data-fetch pattern, dev-server URL, verify command | Answer anything it can't discover. It won't guess |
| **S2** | Crawls the reference: nav, sub-navs, footer | — |
| **S3** | Samples 2–3 pages per candidate group and clusters them, recording which signal it used | — |
| **S4** | Enumerates every distinct block per layout | — |
| **S5** | Extracts colours, type scale, spacing, and the font **role** map | — |
| **S6** | Asks once: anything out of scope, deferred, or stubbed? | Answer — empty is fine |
| **S7** | Tests its own clustering against pages it never sampled. Poor result → back to S3 | — |
| **S7.5** | Per layout: 2+ pages **and** 70%+ accurate, or its pages go per-page | — |
| **S8** | Writes every artifact as `draft`, reports, stops | **Review, then mark `reviewed`** |

Nothing builds until you promote them — that gate is what stops one wrong assumption
reaching ten pages.

### Step 2 · `/parity-page <route>` — once per page

| | What happens | Stops? |
|---|---|---|
| **P0** | Resolves the mode, declares reuse / extend / new per block | no |
| **P1** | Captures the reference **twice** — whatever differs between two identical captures is live content, and self-populates the ignore list | **yes** |
| **P2** | Writes the build notes: differences only, or the whole page | **yes** |
| **P3** | Builds structure with placeholder content, tagging each block `data-parity-module` | no |
| **P4** | Captures your page, diffs, loops until clean | **yes** |
| **P5** | Wires real data through your project's own pattern | **yes** |
| **P6** | Re-diffs with real content, updates the catalog, inventory and ledgers | **yes** |

P3 is untagged for a reason: without `data-parity-module` the extractor finds nothing on
your side and the diff has nothing to compare.

## Two build modes

Decided per page, because real sites mix strong layouts with one-offs. Only P0 and P2
differ — capture, diff and every gate are identical, which is why per-page is a real mode
and not a degraded one.

| | shared layout | per-page |
|---|---|---|
| P0 | Read the layout, declare reuse / extend / new | No layout; expectations come from the capture |
| P2 | Notes record only the **differences** | Notes are **self-contained** |
| Reuse | Blocks resolve reuse/extend | Blocks start new; the 2nd occurrence gets shared |

## Parallel sessions

Several chats, one project. Each works on its own copy; merge when one finishes:

```bash
/parity-sync --push    # publish this session's findings
/parity-sync --pull    # pick up what others published
```

Entries merge by id, so two sessions adding different findings never collide. Shared
layouts, tokens and `SYSTEM_DESIGN.md` **stop and show you both versions** if two sessions
changed them.

## What lands in your project

```
.parity/
├── SYSTEM_DESIGN.md          the doc a new session reads instead of re-deriving
├── page-inventory.json       route → layout, build mode, status
├── module-catalog.json       every block, its component, where it appears
├── tokens.json               colours, type scale, font roles
├── templates/<archetype>.json  shared slots + the reuse verdict
├── scope-ledger.json         what you deliberately don't build
├── deviations.json           deliberate departures, so the diff expects them
├── id-map.json               their module names ↔ yours
├── pages/<route>/            capture.json · ours.json · spec.md
├── preflight.json            this project's own environment checks (optional)
├── tool-feedback.jsonl       gaps found in the tool itself (append-only)
└── sessions/<tag>/           only when sessions run in parallel
```

Nothing else in your project is written to. Existing scaffolding — build scripts, task
runners, `AGENTS.md`, `docs/` — is read for its rules and never modified.

## Plugin layout

```
parity/
├── commands/     parity-bootstrap · parity-page · clone-sync · clone-improve
├── skills/       capture-fidelity · module-reuse · scope-ledger
├── extractor/    extract.js · run-local.js · diff.js · volatility.js
│                 run-reference.md — the reference-capture protocol
├── hooks/        catalog-reminder.sh (silent unless bootstrapped)
├── templates/    ARTIFACTS.md — every artifact schema
├── preflight.sh
├── DESIGN.md     why it works this way
├── STOPGAPS.md   temporary deviations, and how to undo them
└── TOOL-GAPS.md  known gaps, ranked by how often they bite
```

`diff.js` and `volatility.js` have no dependencies and run anywhere.

The plugin holds **zero facts about any app** — only procedures for deriving them.
Everything app-specific lands in the target project under `.parity/`.

## Terms

| Term | Means |
|---|---|
| **capture** | JSON of everything measurable about one page — sizes, fonts, colours, positions, counts |
| **module** | One repeated block: a header, a story card, an ad slot |
| **archetype** | A layout several pages share |
| **deviation** | A difference you chose on purpose, so the check expects it |
| **scope ledger** | Features you decided not to build, so they aren't mistaken for bugs |

## Docs

| | |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Why verification works this way — read before changing it |
| [`templates/ARTIFACTS.md`](templates/ARTIFACTS.md) | Every artifact schema |
| [`commands/`](commands/) | Each command, phase by phase |
| [`extractor/run-reference.md`](extractor/run-reference.md) | Capturing the reference side |
| [`TOOL-GAPS.md`](TOOL-GAPS.md) · [`STOPGAPS.md`](STOPGAPS.md) | Known gaps · temporary deviations |

## Limits

Passing the diff means every captured fact is reproduced — not that the page is
indistinguishable. It cannot see a wrong image, an awkward crop, or interaction feel.
Behaviour is recorded as agent observation and labelled as such.

Seed content is originally authored, never copied from the reference.
