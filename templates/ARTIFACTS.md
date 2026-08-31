# Artifact schemas

Every artifact this plugin produces lives in the **target project**, never in the
plugin. The plugin holds procedures; projects hold facts.

Two conventions apply to all of them:

- **`status`** — `draft` | `reviewed` | `stale`. Nothing downstream treats an artifact
  as authoritative until `reviewed`. Commands refuse to build on `draft`.
- **`captured`** — ISO-8601 timestamp of when the underlying observation was made. Used
  to warn when a page capture predates a template change.

**Precedence when two artifacts disagree — specificity wins:**

```
capture.json  >  page spec  >  archetype template  >  SYSTEM_DESIGN  >  plugin docs
```

---

## `capture.json` — one per page, per side

The load-bearing artifact. The same extractor produces it for the reference site and
for our clone, so the two are directly comparable field for field.

```jsonc
{
  "schema": "parity/capture/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "target": {
    "kind": "reference",              // "reference" | "clone"
    "url": "https://example.com/docs",
    "route": "/docs",

    // WHICH state of this route, and WHO was looking. The diff refuses to
    // compare captures differing on either — see "Fixtures and actors" below.
    // null is correct for an app whose pages do not vary by state or role.
    "fixture": "empty-list",          // null when unspecified
    "actor":   "reporter"             // null when unspecified
  },

  // Recorded so a diff can refuse to compare captures taken under
  // different conditions — a mismatch here invalidates the comparison.
  "environment": {
    "viewport":           { "width": 1440, "height": 900 },
    "deviceScaleFactor":  1,
    "reducedMotion":      true,
    "animationsDisabled": true,
    "fontsReady":         true,
    "signedIn":           true
  },

  "archetype": "section-front",

  "page": {
    "chrome": ["utility-bar", "masthead", "primary-nav", "site-footer"],
    "layout": {
      "contentMaxWidth": 1200,
      "columns": [
        { "role": "content", "width": 900 },
        { "role": "rail",    "width": 400 }
      ],
      "gap": 0
    },
    // Exact-match field. Order and membership are both significant.
    "moduleOrder": ["section-header", "promo-rail", "hero", "money-monitor"]
  },

  "modules": [
    {
      "id": "section-header",

      // How this module was identified, and how much to trust it.
      // See SYSTEM_DESIGN's fingerprint ladder.
      // `declared` = read from our own `data-parity-module` attribute (clone side,
      // exact). `class-family` = the reference's build-generated class names
      // (reference side). The two sides are asymmetric: a utility-class clone
      // exposes no identity signal at all, so it declares instead of being guessed.
      "fingerprint": {
        "kind":       "class-family",   // declared | selector | class-family | structural | geometric | human
        "value":      "SectionHeaderBrand",
        "confidence": "high"            // high | medium | low
      },

      "slot": "content",                // which layout column it occupies

      // Geometry is RELATIVE to the named container, never absolute page
      // coordinates — absolute Y shifts whenever an ad or banner appears.
      "geometry": {
        "container":          "content-column",
        "width":              900,
        "height":             180,
        "offsetLeftRelative": 0
      },

      "grid":      { "columns": 3, "rows": 2 },   // exact match
      "itemCount": 5,                             // exact match

      "elements": [
        {
          "role": "title",
          "tag":  "h3",
          "typography": {
            "fontRole":   "display",      // compared by ROLE, never literal stack
            "fontFamily": "ExampleDisplay, Helvetica, Arial, sans-serif",
            "fontSize":   52,
            "fontWeight": 700,
            "lineHeight": 54.6
          },
          "color": "#000000",
          "spacing": { "marginTop": 0, "marginBottom": 8, "paddingLeft": 0 }
        }
      ],

      "a11y": {
        "headingLevel": 3,
        "role":         null,
        "ariaLabel":    null,
        "focusable":    false
      },

      // True => excluded from diffing. Set automatically by double-capture,
      // never hand-maintained.
      "volatile": false,

      // Agent-OBSERVED, not extracted. The honest limit of property capture.
      "behavior": [
        {
          "question":   "Does this carousel loop or clamp at the last slide?",
          "answer":     "Clamps; arrow disables at the end.",
          "observedAt": "2026-08-21T14:40:00Z",
          "method":     "consult"
        }
      ],

      "notes": null
    }
  ],

  // Populated by capturing the reference twice and diffing the two runs.
  // Anything that differs between identical captures is volatile by definition.
  "volatility": {
    "detectedBy": "double-capture",
    "runs":       2,
    "ignore":     ["ad-leaderboard", "ticker-bar", "timestamp-line"]
  },

  // Modules seen in the DOM that matched no known fingerprint. Never silently
  // dropped — an unmatched module is a signal the taxonomy is incomplete.
  "unmatched": []
}
```

---

## Fixtures and actors — when a route stops being a page

A URL has one canonical rendering only while an app has no state. As soon as it does, the
same route renders differently for an empty list and a full one, for an admin and a
reporter, before and after a record exists — and the states that matter most never appear
in a default capture at all: empty, loading, error, permission-denied, past the pagination
threshold.

A **fixture** names the precondition a capture was taken under. An **actor** names who was
looking.

```
.parity/pages/browse-PROJ-123/
├── default/capture.json
├── as-reporter/capture.json
└── no-permission/capture.json
```

The fixture is also what makes two *different datasets* comparable. You are never
comparing their record #42 against our record #7 — you are comparing "an issue in this
state" on both sides. On the clone that precondition is produced by seeding; on the
reference it is found or set up.

**The diff refuses to compare across a differing fixture or actor**, exactly as it refuses
a viewport mismatch, and for the same reason: those are not two measurements of one page,
they are measurements of two different pages. Reporting every difference between an empty
list and a full one is worse than refusing, because each one looks exactly like a defect.

Record the fixture the capture **actually observed**, not the one that was requested. A
reference-side precondition is manual setup on someone else's instance and it decays.

---

## `module-catalog.json` — the living registry

The artifact whose absence let ~25 near-duplicate page components accumulate in a
prior project despite a written reuse rule. Maintained by the build command **in the
same run** that creates a component, never "later".

```jsonc
{
  "schema": "parity/module-catalog/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "modules": [
    {
      "id": "story-grid",
      "referenceName": "moduleWrapper / CarouselVariant_moduleWrapperWithHeader",
      "fingerprint": { "kind": "class-family", "value": "moduleWrapper", "confidence": "high" },

      "component": "components/common/StoryGrid",   // null while not-built
      "status":    "built",                          // not-built | built | one-off

      "variants": [
        { "name": "withHeader", "props": { "header": true } },
        { "name": "fourUp",     "props": { "columns": 4 } }
      ],

      // Every place this module appears. Reaching a SECOND occurrence is what
      // triggers extraction into a shared component.
      "occurrences": [
        { "route": "/docs",     "slot": "content", "variant": "fourUp" },
        { "route": "/blog", "slot": "content", "variant": "withHeader" }
      ],

      // Required when status is "one-off": why this deliberately isn't shared.
      "oneOffRationale": null
    }
  ]
}
```

**Reuse verdicts** recorded against this file: `REUSE` (use as-is) · `EXTEND` (add a
variant prop) · `NEW` (record immediately; mark `one-off` only with a written
rationale).

---

## `scope-ledger.json` — what we are deliberately not building

Global per project, not per page. The problem it solves: a scope decision written into
one page's requirements doc is invisible to the session building a different page that
hits the same feature.

Created possibly-empty at bootstrap (one prompt: "any known exclusions?") and appended
to as decisions get made.

```jsonc
{
  "schema": "parity/scope-ledger/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "entries": [
    {
      "id":        "quote-detail-page",
      "description": "The per-security quote/detail destination page",
      "decision":  "out-of-scope",     // out-of-scope | deferred | stubbed
      "rationale": "Owned by another workstream",
      "date":      "2026-08-21",

      // How to RECOGNIZE this feature when it turns up somewhere new.
      // This is what makes the ledger active rather than documentary.
      "detectionSignals": {
        "urlPatterns":  ["/quote/*"],
        "selectors":    ["[data-component='StockChip']"],
        "classFamilies": ["QuoteHeader"],
        "linkTargets":  ["/quote/"]
      },

      // What to DO when it is recognized.
      "handling": "render-disabled",
      // omit | render-disabled | non-interactive | placeholder-target
      "handlingNotes": "Render the chip visually, no navigation on click"
    }
  ]
}
```

**This file feeds the diff.** A module matching a ledger signal is an **expected**
mismatch, not a failure. Without that link the checker reports the same known gap on
every run forever — and a check that always fails is a check nobody reads.

---

## `deviations.json` — deliberate departures from the reference

Same mechanism as the scope ledger, different reason: places where we knowingly do
*not* match the reference, and the diff must treat the mismatch as expected.

```jsonc
{
  "schema": "parity/deviations/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "entries": [
    {
      "id":       "section-title-heading-level",
      "scope":    { "archetype": "section-front", "module": "section-header" },
      "reference": { "tag": "h3" },
      "ours":      { "tag": "h1" },
      "rationale": "Reference ships a non-semantic heading; project a11y rules require a real h1. Visual appearance still matches exactly.",
      "date":      "2026-08-21",
      "expectedMismatch": ["modules.section-header.elements.title.tag"]
    }
  ]
}
```

---

## `page-inventory.json` — every page and its state

```jsonc
{
  "schema": "parity/page-inventory/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "pages": [
    {
      "url":        "https://example.com/docs",
      "route":      "/docs",
      "archetype":  "section-front",
      "confidence": "high",
      "parent":     null,
      "subnavChildren": ["/docs/api", "/docs/cli"],
      "buildStatus": "built",   // not-started | captured | spec | skeleton | built
      "lastCapture": "2026-08-21T14:32:00Z",

      // True when this page was never sampled during archetype derivation —
      // i.e. it is a valid predict-and-test candidate.
      "unsampled": false,

      // Cached from this page's archetype routing verdict, so /parity-page does
      // one lookup instead of resolving the archetype itself. A route with no
      // archetype is always "per-page".
      "mode": "template"        // template | per-page
    }
  ]
}
```

---

## `templates/<archetype>.json` — the shared shape

What every page of an archetype has in common. A page spec records only its
**deltas** from this — never a re-description of it.

```jsonc
{
  "schema": "parity/archetype/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "id": "section-front",
  "fingerprint": { "kind": "class-family", "value": "SectionHeader", "confidence": "high" },

  "evidence": [
    "Same class family on /docs, /blog, /guides",
    "Identical two-column grid: content 900 + rail 400"
  ],

  "layout": {
    "contentMaxWidth": 1200,
    "columns": [
      { "role": "content", "width": 900 },
      { "role": "rail",    "width": 400 }
    ]
  },

  // Ordered slots. `optional` marks a slot some pages of this archetype omit.
  "slots": [
    { "module": "section-header", "slot": "content", "optional": false },
    { "module": "promo-rail",     "slot": "content", "optional": true  },
    { "module": "newsletter-card","slot": "rail",    "optional": true  }
  ],

  // Where the rail stops relative to the content column, breakpoint behavior,
  // and anything else true of every page in the archetype.
  "sharedFacts": {
    "railEndsAfter": "last-rail-slot",
    "breakpoints":   [768, 1020, 1280]
  },

  // Every route the clustering assigned to this archetype, sampled or not.
  // Membership is the leverage signal: one page is not a pattern.
  "members": ["/docs", "/guides", "/changelog"],

  "predictionAccuracy": {
    "testedPages":  ["/guides", "/changelog"],
    "matched":      2,
    "total":        2,
    "measuredAt":   "2026-08-21T15:10:00Z"
  },

  // Which mode /parity-page runs for this archetype's pages. Written by
  // /parity-bootstrap Step 7.5 from the two tests below — never hand-set without
  // also correcting `reason`, which is what makes the verdict auditable.
  "routing": {
    "mode":   "template",        // template | per-page
    "reason": "3 members, predicted 2/2 (1.00)",
    "thresholds": { "minMembers": 2, "minAccuracy": 0.7 }
  }
}
```

---

## `tokens.json`

```jsonc
{
  "schema": "parity/tokens/v1",
  "status": "reviewed",
  "captured": "2026-08-21T14:32:00Z",

  "colors":  { "ink": "#000000", "paper": "#FFFFFF", "rule": "#E5E5E5" },
  "typeScale": [
    { "name": "headline-xl", "fontSize": 52, "lineHeight": 54.6, "fontWeight": 700 }
  ],

  // The substitution map. The clone uses available fonts in place of the
  // reference's proprietary faces, so font comparison is ROLE-based.
  "fontRoles": {
    "display": { "reference": "ExampleDisplay", "ours": "<substitute>" },
    "ui":      { "reference": "ExampleText",    "ours": "<substitute>" }
  },

  "spacing":     [0, 4, 8, 12, 16, 20, 24, 32, 48],
  "breakpoints": [768, 1020, 1280],
  "borders":     { "hairline": "1px solid #E5E5E5", "radius": { "button": 4, "pill": 999 } }
}
```

---

## `SYSTEM_DESIGN.md` — section order

Human-readable HLD. The one document a new session reads instead of re-deriving the
app. Required sections, in order:

1. **Header** — `status`, `captured`, reference base URL, edition/locale scope, and
   `scope` — `full`, or `partial` with the routes it covers (see `scope.json`).
2. **Stack profile** — framework, styling system, blessed data-fetch pattern,
   directory conventions. Read from the project's own config files, not inferred.
3. **Archetypes** — one entry each: id, fingerprint, confidence, cited evidence,
   which pages belong to it.
4. **Template taxonomy** — the page → archetype table.
5. **Global chrome** — what appears on every page.
6. **Layout grid** — widths, columns, breakpoints.
7. **Prediction accuracy** — the predict-and-test result. A taxonomy without a
   measured accuracy number is a claim, not a finding. At a partial scope there may
   be nothing to measure against; say so rather than reporting a number.
8. **Conventions** — project-specific rules established during bootstrap.

`status` may be `partial-reviewed`: reviewed, and honestly covering only part of the
app. `/parity-page` and `/parity-fix` accept it for routes inside the scope.

---

## `scope.json` — the routes you are accountable for

Optional, and **local: git-ignored, never merged by `/parity-sync`.** Scope is an
*assignment*, not a property of the project. Your own parallel sessions share one file; a
teammate with a different assignment keeps their own; sync never has to adjudicate whose
assignment is whose.

```jsonc
{
  "schema": "parity/scope/v1",
  "owns": ["/board", "/backlog"],

  // Routes outside `owns` that render components yours depend on. Derived, not
  // declared — and it carries how it was derived, because the two sources are not
  // equally trustworthy. `derivedFrom` names a source, not a degree — unlike the
  // `confidence` field on an archetype fingerprint elsewhere in this document.
  "neighbours": [
    { "route": "/roadmap", "module": "issue-card", "derivedFrom": "occurrences" },
    { "route": "/reports", "module": "issue-card", "derivedFrom": "imports" }
  ]
}
```

**Absent this file, every command behaves exactly as it does with no scope at all.**

| | Inside `owns` | Outside |
|---|---|---|
| Build, edit, verify | yes | **refuse**, naming the route that owns it |
| Read for reuse | yes | **yes — always, the whole repo** |
| Report findings | yes | no — not your page, not your finding |
| Blast-radius warnings | yes | **yes** — you must know what you might break |

The read/write asymmetry is the point: you have to see every component in the repo to
reuse them while owning three pages. The findings row matters nearly as much — a scoped
session reporting on pages its operator cannot act on produces noise, and noise is what
stops a gate being read.

### `derivedFrom` on a neighbour

| | Means |
|---|---|
| `occurrences` | Exact. A real capture recorded this module on this route |
| `imports` | Inferred from the import graph. Over-reports |

`imports` over-reports on purpose, and in three known ways: a component can be imported
but rendered conditionally; a module's id often comes from a call-site prop rather than
the component's default; and one route file can serve many routes through dynamic
segments.

That is the right way to be wrong here. Over-reporting costs a check you did not need;
under-reporting skips one you did, and the whole job of this list is *do not break someone
else's page*. An `occurrences` entry supersedes an `imports` one for the same module as
soon as a real build produces it.

Never present an `imports` list as though it were measured.

---

## `WORKFLOW.md`

The page pipeline with this project's real paths, routes, commands, and stack
substituted in. Generated, not hand-written — a stale copy of the workflow is worse
than none.

---

## `sessions/<tag>/` — parallel session workspace

Present only when more than one session is working the project. Managed by
`/parity-sync`; see `commands/parity-sync.md` for the merge itself.

```
.parity/sessions/
├── claims.json                 who is building what
└── <tag>/
    ├── base/                   snapshot of the shared artifacts at fork or last sync
    ├── work/                   this session's editable copies
    └── pages/<route>/          capture.json · ours.json · spec.md
```

`base/` is not a backup — it is the **merge base**. A three-way merge needs it to tell
"I added this entry" from "they deleted it". With only two versions those are
indistinguishable, and a rename reads as a delete plus an add, which is how a session's
entries get silently dropped. A push without a valid `base/` is refused rather than
degraded to a two-way merge.

`work/` holds only the shared artifacts a session might extend: `module-catalog.json`,
`deviations.json`, `scope-ledger.json`, `page-inventory.json`, `id-map.json`,
`templates/*.json`, `tokens.json`. Never the plugin's own code — the extractor is read
read-only from the installed plugin.

### `claims.json`

```jsonc
{
  "schema": "parity/claims/v1",
  "claims": [
    { "session": "s-a91f", "routes": ["/markets"], "claimedAt": "2026-08-23T09:12:00Z" },
    { "session": "s-77c2", "routes": ["/opinion", "/green"], "claimedAt": "2026-08-23T09:14:00Z" }
  ]
}
```

Advisory, not a lock. Nothing enforces it; `/parity-sync --push` warns when two sessions
have built the same route, which catches duplicated work before the merge does.

---

## `preflight.json` — project-declared environment checks

Optional. Lets `preflight.sh` verify things that are true of *this* app without the
plugin knowing what any of them mean.

```jsonc
{
  "schema": "parity/preflight/v1",

  "frontendUrl":       "http://localhost:3000",
  "backendUrl":        "http://localhost:8000",   // omit to skip the backend probe
  "backendHealthPath": "/api/docs",               // default "/"
  "devServerHint":     "start it: ./run.sh --dev",

  // Assert that a value written in a config file is actually being SERVED.
  // Verified by rendering, never by grepping the stylesheet: a grep once reported
  // "compiled" for a token that had not compiled, because the number appeared
  // elsewhere in the CSS while the rule that mattered still held the old value.
  "renderChecks": [
    {
      "name":       "container token",
      "configFile": "frontend/tailwind.config.ts",  // relative to the project root
      "pattern":    "bb: \"([0-9]+)px\"",           // first captured number is expected
      "selector":   ".max-w-page",
      "property":   "maxWidth",                     // computed style to read
      "remedy":     "Tailwind does not pick up config changes without a restart."
    }
  ]
}
```

Every field has a neutral fallback, so a project with no config still gets the generic
checks. `--project DIR` (or `PARITY_PROJECT`) is required and has no default — a wrong
default silently checks the wrong project.

---

## `tool-feedback.jsonl` — gaps found in the tool itself

Append-only. One JSON object per line, one line per finding. Written by a session at the
moment of discovery; read by `/parity-improve`.

**JSONL, not JSON, on purpose:** appending a line never conflicts, so parallel sessions
can all write findings without `/parity-sync` having to merge them.

```jsonc
{ "id": "itemgrid-level-asymmetry",
  "date": "2026-08-23",
  "route": "/ai",              // where it surfaced
  "phase": "P4",               // P1 | P2 | P3 | P4 | P5 | P6 | S0..S8
  "kind": "asymmetry",         // see table below
  "symptom": "itemGrid matched the reference's images (299px) against our columns (346px)",
  "evidence": "pages/ai/capture.json → modules[lineup-2up-hero].itemGrid",
  "impact": "two rebuilds of one module on a false signal",
  "workaround": "measured the live DOM directly; filed a tool-gap deviation",
  "suspectedCause": "extract.js itemGridOf()",
  "status": "open" }            // open | fixed-in-plugin | wont-fix
```

| `kind` | Means |
|---|---|
| `missed-pattern` | The extractor did not see something that is on the page |
| `asymmetry` | A field resolves on one side but not the other, so comparing it is meaningless |
| `false-positive` | The diff reported a defect that is not one |
| `false-negative` | The diff passed something a human then found. A hole in the gate itself |
| `crash` | The extractor or a driver failed outright |
| `unmeasurable` | A real fidelity property nothing can currently capture |
| `ergonomics` | The tool let someone do the wrong thing quietly |
| `doc-gap` | A command doc says something untrue or unactionable |

**Two fields make an entry actionable, and an entry without them is close to useless:**
`evidence` (a file and a field, not a feeling) and `suspectedCause` (a function, where
known). "capture.json missed something" cannot be fixed. "`findModules` collapsed four
sibling repeats because it accepted one node per class family" can.

### The pairing rule

A `tool-gap` entry in `deviations.json` **must** be accompanied by a feedback entry, and
so must any bug `/parity-fix` finds that the diff had passed — that is a `false-negative`,
and it is the most valuable kind here because it is a hole in the gate rather than in one
page.
They do different jobs: the deviation stops the diff reporting it *today*, the feedback
entry is what gets it fixed *later*. A suppression with no feedback entry is precisely
how a gap becomes permanent — suppressing costs one line, and without this rule fixing
costs someone happening to remember.
