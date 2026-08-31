---
description: Merge a parallel session's work into the project's shared parity docs, or refresh the session's copies from them. Three-way merge against a recorded base; conflicts are reported, never guessed.
argument-hint: --pull | --push [--tag <session>]
---

You are running **/parity-sync** — the merge step for parallel sessions.

`$ARGUMENTS` contains a direction (`--pull` or `--push`) and an optional `--tag`.
Without a tag, use this session's own tag; if the session has none, create one and say
so.

| Flag | Effect |
|---|---|
| `--pull` | Bring the latest shared state into this session's copies |
| `--push` | Merge this session's work into the shared docs |
| `--tag <session>` | Operate on a named session instead of this one |

Both directions are **operator-triggered**. Nothing syncs on its own: the person running
four chats knows which one just finished, and sequencing the merges is their call.

## Why this exists

Parallel sessions write the same files. Without a merge step the last writer wins and the
other session's findings vanish silently — not detectable in the diff, because the diff
compares a page against the reference, not the docs against themselves.

## The workspace

```
.parity/sessions/<tag>/
├── base/     snapshot of the shared artifacts at fork or last sync
├── work/     this session's editable copies
└── pages/<route>/
```

`base/` is the load-bearing part, and the reason this is a real merge rather than a copy.

A two-way comparison cannot distinguish **"I added this entry"** from **"they deleted
it"** — both show up as "present on one side only". With `base/` the answer is
unambiguous: absent in base and present in mine means I added it; present in base and
absent in theirs means they removed it. A rename is a delete plus an add, which without a
base silently drops one of them.

**Refuse to push when `base/` is missing or malformed.** Say what is wrong and stop.
Degrading to a two-way merge is exactly the data loss this command exists to prevent.

**`.parity/scope.json` is never merged, in either direction.** It records *this operator's*
assignment, not a fact about the project — pushing it would hand a teammate your routes,
and pulling it would overwrite yours with theirs. It is git-ignored and stays local. Your
own parallel chats on one machine share the single file and need no merge at all.

## The merge

Both directions run the *same* three-way merge — `base`, `work`, `global` — and differ
only in where the result is written and what is reported.

**`--pull`** → result lands in `work/`, then `base := global`.
Report what changed globally since the fork. **Warn loudly if an archetype template this
session is building against was revised** — that changes the ground under an in-flight
page, and the session needs to know before it specs another delta.

**`--push`** → result lands in the shared `.parity/`, then `base := global`.
Report what was contributed and what conflicted.

### Per-artifact rules

| Artifact | Rule |
|---|---|
| `module-catalog.json`, `deviations.json`, `scope-ledger.json` | Merge by entry id. Two sessions appending different ids never conflict, even in the same file |
| `page-inventory.json` | Merge by route. `buildStatus` advances monotonically — never regress `built` to `captured` |
| `id-map.json` | Per-route `pages` overlays cannot collide by construction. The top-level `modules` table merges by key |
| `templates/<archetype>.json`, `tokens.json`, `SYSTEM_DESIGN.md` | **Conflict whenever both sides changed.** These carry judgment; a wrong silent merge here poisons every page built afterward |
| `pages/<route>/*` | Single-owner — promote by copy. Two sessions having built the same route is itself the conflict |

Merging **by id, not by line**, is what makes this quiet in the common case: two sessions
appending different deviations to one file is not a conflict, though a line-based merge
would call it one.

### Conflicts

**Never guess.** Print both versions with their ids, say which artifact and which side
changed what, and stop. A silently-resolved merge that drops a deviation is
indistinguishable from the overwrite this command exists to prevent.

Two cases that look like conflicts and are not: the same entry added identically on both
sides (converge), and a monotonic status advance (take the later state).

**Deletion is only quiet when the other side left the entry alone.** Work the cases from
the base explicitly:

| base | mine | theirs | result |
|---|---|---|---|
| present | unchanged | deleted | delete — nobody is losing work |
| present | **changed** | deleted | **conflict** |
| present | changed | unchanged | take mine |
| present | unchanged | changed | take theirs |
| present | changed | changed differently | **conflict** |
| absent | added | absent | take mine |
| absent | added | added identically | converge |

The second row is the one that matters, and it is easy to get wrong. An **id rename**
arrives as a delete plus an add; if the renamed entry is one you also edited, a merge that
treats the delete as uncontested drops your edit with no conflict reported — the precise
failure this command exists to prevent. Compare against the base before honouring any
deletion.

## Claims

`.parity/sessions/claims.json` records which routes each session owns. Advisory, not a
lock — nothing enforces it.

On `--push`, warn when another session has already built a route this session also built.
That catches duplicated work at merge time, which is late but far better than never.

## Reporting rules

- **Say what moved.** Every entry added, updated, or skipped, by artifact. A merge whose
  effect is unclear is a merge nobody will trust enough to run.
- **Never report success with unresolved conflicts.** Exit having changed nothing on the
  conflicting artifacts, and leave the others merged only if that is safe to do
  independently — say clearly which were applied and which were not.
- **State the new base.** After a successful sync, both sides agree; if they do not, the
  next merge will be wrong and the operator should know now.
