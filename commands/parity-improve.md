---
description: Aggregate tool-feedback entries from one or more projects, rank the tool's own gaps by recurrence and impact, and update the plugin's TOOL-GAPS backlog. Read-only against projects.
argument-hint: [project-dir ...] [--since YYYY-MM-DD] [--write]
---

You are running **/parity-improve** — the feedback loop that turns findings from real runs
into a ranked list of things to fix in the plugin.

`$ARGUMENTS` may name one or more project directories. With none, use the current
project. `--write` updates `TOOL-GAPS.md`; without it, report only.

## Why this exists

Every gap in this tool was found by using it, and without this step each one is found
again by the next project. The write side is cheap — a session appends a line the moment
it hits something. The read side never happens on its own, which is what this command is
for.

## What to read

For each project, `.parity/tool-feedback.jsonl` — one JSON object per line, schema in
`${CLAUDE_PLUGIN_ROOT}/templates/ARTIFACTS.md`. Skip malformed lines, but **report how
many you skipped**: a parse failure is itself a finding about the write side.

Also read `${CLAUDE_PLUGIN_ROOT}/TOOL-GAPS.md` to know what is already tracked, and
`deviations.json` in each project — every `status: "tool-gap"` entry there **should** have
a matching feedback entry. Ones that do not are the gaps nobody wrote up.

## What to produce

Group by `suspectedCause` first, then by `kind`. Within each group:

- **Recurrence** — how many entries, across how many distinct projects and routes
- **Impact** — read the `impact` fields; a gap that caused a wrong build outranks one
  that cost a confusing line of output
- **Status** — `open`, or already fixed and recurring anyway (which means the fix missed)

Rank by **distinct projects first, then total recurrence, then impact.** A gap hit five
times in one project may be one page's quirk; the same gap in three projects is a
property of the tool. That ordering is the whole point of aggregating.

Then present:

1. **Ranked table** — cause · kind · projects · hits · worst impact · status
2. **Root-cause clusters.** Several entries often share one underlying cause and one fix.
   Say so explicitly — three separate symptoms that all reduce to "the extractor cannot
   distinguish *not measured* from *measured absent*" are one piece of work, not three.
3. **Unpaired suppressions** — `tool-gap` deviations with no feedback entry. These are
   silenced gaps with no record, the exact failure mode the pairing rule exists to stop.
4. **Recommended next fix**, with the reason it is first.

With `--write`, merge into `TOOL-GAPS.md`: update recurrence counts, add new clusters,
and move anything now `fixed-in-plugin` to a resolved section with the version it was
fixed in. Never delete a resolved entry — a gap that comes back is important, and you
cannot see that if the history is gone.

## Reporting rules

- **Never invent a cause.** If `suspectedCause` is empty across a cluster, say the cause
  is unknown and name what evidence would identify it. A guessed cause sends the fix to
  the wrong function.
- **Report the write side honestly.** Low entry counts more likely mean sessions are not
  logging than that the tool is clean. If a project has many `tool-gap` deviations and
  few feedback entries, say that plainly — the loop is broken there.
- **Do not rank by count alone.** One `crash` outranks ten `ergonomics` entries.
- **Never close an entry on your own.** Only a real fix in the plugin closes one; mark
  `fixed-in-plugin` when the code changed, not when the symptom stopped appearing.
