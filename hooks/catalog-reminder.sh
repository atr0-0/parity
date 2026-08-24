#!/usr/bin/env bash
# UserPromptSubmit hook: re-inject the reuse-first and scope rules every prompt.
#
# Long build sessions outlive their own context. A rule stated once at the top of
# a session is gone by the time the twentieth module gets built — which is how a
# written reuse rule can lose to twenty-five hand-written near-duplicates. A hook
# is the only mechanism that survives compaction.
#
# Silent by design when the project has not been bootstrapped: no artifacts means
# no nudge, so this adds exactly zero overhead to unrelated projects.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}/.parity"
CATALOG="$ROOT/module-catalog.json"
LEDGER="$ROOT/scope-ledger.json"

[ -f "$CATALOG" ] || exit 0

summarize() {
  python3 - "$1" "$2" <<'PY' 2>/dev/null
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    with open(path) as fh:
        data = json.load(fh)
except Exception:
    sys.exit(1)
items = data.get(key) or []
if key == "modules":
    built = sum(1 for m in items if m.get("status") == "built")
    print(f"{len(items)} catalogued, {built} built")
else:
    print(f"{len(items)} entries")
PY
}

CATALOG_SUMMARY="$(summarize "$CATALOG" modules)" || CATALOG_SUMMARY="present"
[ -n "$CATALOG_SUMMARY" ] || CATALOG_SUMMARY="present"

if [ -f "$LEDGER" ]; then
  LEDGER_SUMMARY="$(summarize "$LEDGER" entries)" || LEDGER_SUMMARY="present"
  [ -n "$LEDGER_SUMMARY" ] || LEDGER_SUMMARY="present"
  LEDGER_LINE="Scope ledger ($LEDGER_SUMMARY): before building a feature, check
.parity/scope-ledger.json — a feature excluded elsewhere must be handled the
same way here (omit / disabled / non-interactive), not silently built."
else
  LEDGER_LINE=""
fi

cat <<EOF
<parity-reminder source="hooks/catalog-reminder.sh" injected-on="every-prompt">
Automated nudge, not user input. Apply when relevant to the current task;
otherwise ignore it — no acknowledgement needed.

Module catalog ($CATALOG_SUMMARY): before creating ANY component, consult
.parity/module-catalog.json and record a verdict — REUSE as-is, EXTEND with a
variant prop, or NEW. Record a NEW entry in the same change that creates it,
never later. A module reaching its second occurrence gets extracted into a
shared component.
$LEDGER_LINE
</parity-reminder>
EOF
