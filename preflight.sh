#!/usr/bin/env bash
# Environment check before capturing or diffing.
#
# Verifies the runtimes, resolves Playwright, confirms the artifacts the diff needs,
# and runs whatever render checks the PROJECT declares.
#
# This script holds no facts about any application. Anything app-specific — URLs, a
# health path, a CSS token to verify — is declared by the project in
# `.parity/preflight.json`. See `templates/ARTIFACTS.md`.
#
#   preflight.sh --project DIR     full report
#   preflight.sh --node-path       print only the NODE_PATH value (for export)
#
# The project may also come from $PARITY_PROJECT. There is deliberately no default: a
# wrong default silently checks the wrong project, which is worse than an error.
set -uo pipefail

PROJECT="${PARITY_PROJECT:-}"
MODE="report"
while [ $# -gt 0 ]; do
  case "$1" in
    --project)   PROJECT="${2:-}"; shift 2 ;;
    --node-path) MODE="node-path"; shift ;;
    *)           echo "preflight.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

find_playwright() {
  if node -e "require('playwright')" >/dev/null 2>&1; then
    node -e "console.log(require.resolve('playwright').replace(/\/playwright\/.*$/,''))" 2>/dev/null
    return 0
  fi
  for d in "$PROJECT" "$PROJECT/frontend" "$PWD"; do
    [ -n "$d" ] && [ -d "$d/node_modules/playwright" ] && { echo "$d/node_modules"; return 0; }
  done
  local hit
  hit=$(find "$HOME/.npm/_npx" -maxdepth 4 -type d -name playwright 2>/dev/null | head -1)
  [ -n "$hit" ] && { dirname "$hit"; return 0; }
  return 1
}

if [ "$MODE" = "node-path" ]; then
  find_playwright || { echo ""; exit 1; }
  exit 0
fi

if [ -z "$PROJECT" ]; then
  echo "preflight.sh: no project given. Pass --project DIR or set PARITY_PROJECT." >&2
  exit 2
fi

fail=0
ok()   { printf "  \033[32mOK\033[0m    %s\n" "$1"; }
warn() { printf "  \033[33mWARN\033[0m  %s\n" "$1"; }
bad()  { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; fail=1; }

ART="$PROJECT/.parity"
CFG="$ART/preflight.json"

# Project-declared settings. Every one has a neutral fallback so a project that has
# not written a config still gets the generic checks.
cfgval() {  # cfgval <json-path> <default>
  [ -f "$CFG" ] || { echo "$2"; return; }
  python3 - "$CFG" "$1" "$2" <<'PY' 2>/dev/null || echo "$2"
import json, sys
cfg, path, default = sys.argv[1], sys.argv[2], sys.argv[3]
cur = json.load(open(cfg))
for part in path.split('.'):
    if not isinstance(cur, dict) or part not in cur:
        print(default); raise SystemExit
    cur = cur[part]
print(cur if cur not in (None, '') else default)
PY
}

FRONTEND_URL="${PARITY_FRONTEND_URL:-$(cfgval frontendUrl http://localhost:3000)}"
BACKEND_URL="${PARITY_BACKEND_URL:-$(cfgval backendUrl '')}"
BACKEND_PATH="$(cfgval backendHealthPath /)"
DEV_HINT="$(cfgval devServerHint 'start your dev server')"

echo "parity preflight"
echo "  project: $PROJECT"
echo

# --- runtimes ---
command -v node >/dev/null 2>&1 && ok "node $(node -v)" || bad "node not found"
command -v python3 >/dev/null 2>&1 && ok "python3 present (used to verify captures)" || bad "python3 not found"

# --- servers ---
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$FRONTEND_URL" 2>/dev/null || echo 000)
[ "$code" = "200" ] && ok "frontend up at $FRONTEND_URL" \
  || bad "frontend not responding at $FRONTEND_URL ($DEV_HINT)"

if [ -n "$BACKEND_URL" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "${BACKEND_URL}${BACKEND_PATH}" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && ok "backend up at $BACKEND_URL" \
    || warn "backend not responding at ${BACKEND_URL}${BACKEND_PATH}"
fi

# --- playwright (clone-side capture) ---
if np=$(find_playwright); then
  if NODE_PATH="$np" node -e "require('playwright')" >/dev/null 2>&1; then
    ok "playwright resolvable"
    echo "        export NODE_PATH=\"$np\""
  else
    bad "playwright found at $np but does not load"
  fi
else
  bad "playwright not found — install it: npm i -D playwright && npx playwright install chromium"
fi

# --- artifacts the diff depends on ---
[ -d "$ART" ] && ok "artifact dir $ART" || bad "missing $ART — run /parity-bootstrap first"
if [ -f "$ART/id-map.json" ]; then
  n=$(python3 -c "import json;print(len(json.load(open('$ART/id-map.json')).get('modules',{})))" 2>/dev/null || echo "?")
  ok "id-map present ($n module mappings)"
  echo "        add a line whenever you name a new module — unmapped reads as missing"
else
  bad "missing $ART/id-map.json — diff.js --map needs it or every module reports MISSING"
fi
for f in deviations.json scope-ledger.json; do
  [ -f "$ART/$f" ] && ok "$f present" || warn "$f absent — expected mismatches will report as failures"
done

# --- project-declared render checks ---
#
# A project can assert that a value in one of its config files is actually being
# SERVED, not merely written. Checked by rendering rather than by grepping the
# stylesheet: a grep gave a false OK once, because the number appeared elsewhere in
# the CSS while the rule that mattered still carried the old value. A setup check
# that can be confidently wrong is worse than no check.
#
# The plugin does not know what any of these values mean — the project names the
# config file, the pattern, the selector and the property.
if [ -f "$CFG" ] && [ -n "${np:-}" ]; then
  count=$(python3 -c "import json;print(len(json.load(open('$CFG')).get('renderChecks',[])))" 2>/dev/null || echo 0)
  i=0
  while [ "$i" -lt "$count" ]; do
    spec=$(python3 - "$CFG" "$i" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))['renderChecks'][int(sys.argv[2])]
print('\t'.join([c.get('name','check'), c.get('configFile',''), c.get('pattern',''),
                 c.get('selector',''), c.get('property','maxWidth'), c.get('remedy','')]))
PY
    )
    name=$(echo "$spec" | cut -f1); conf=$(echo "$spec" | cut -f2)
    pat=$(echo "$spec"  | cut -f3); sel=$(echo "$spec" | cut -f4)
    prop=$(echo "$spec" | cut -f5); remedy=$(echo "$spec" | cut -f6)

    want=$(grep -oE "$pat" "$PROJECT/$conf" 2>/dev/null | grep -oE '[0-9]+' | head -1)
    if [ -n "${want:-}" ]; then
      got=$(NODE_PATH="$np" SEL="$sel" PROP="$prop" URL="$FRONTEND_URL" node -e "
const {chromium}=require('playwright');
(async()=>{try{
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1512,height:861}});
  await p.goto(process.env.URL,{waitUntil:'load',timeout:20000});await p.waitForTimeout(1200);
  const v=await p.evaluate(([s,k])=>{const e=document.querySelector(s);
    return e?getComputedStyle(e)[k]:'none';},[process.env.SEL,process.env.PROP]);
  console.log(v);await b.close();
}catch(e){console.log('error')}})();" 2>/dev/null | tr -d 'px\n')
      if [ "${got:-}" = "$want" ]; then
        ok "$name live ($sel $prop = ${want}px)"
      elif [ "${got:-}" = "error" ] || [ -z "${got:-}" ]; then
        warn "could not render-check $name"
      else
        warn "$name is ${want}px in $conf but the browser computes ${got}px"
        [ -n "$remedy" ] && echo "        $remedy"
        echo "        Absolute sizes run ~$(( (want - got) * 100 / want ))% off while proportions stay exact."
        echo "        Do not 'fix' this per-module; it is one value."
      fi
    fi
    i=$((i + 1))
  done
fi

echo
[ "$fail" -eq 0 ] && echo "preflight passed" || echo "preflight FAILED — fix the above before capturing"
exit "$fail"
