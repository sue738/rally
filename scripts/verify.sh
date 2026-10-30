#!/bin/bash
# verify.sh — check a change in proportion to its size.
#
#   scripts/verify.sh              unit tests, a build, and only the E2E scenarios the changed files can reach
#   scripts/verify.sh --plan       say what it would run and about how long that takes; run nothing
#   scripts/verify.sh --full       every E2E scenario: before a hand-off, or when behaviour (not just looks) changed
#   scripts/verify.sh --since REF  the files changed since REF (default: uncommitted and untracked ones)
#   scripts/verify.sh --install    once everything passes, put the built app in ~/Applications and reopen it (a change is not
#                                  done until the app the user runs has it)
#   scripts/verify.sh --bg         the same, detached, logging to $VERIFY_LOG (/tmp/rally-verify.log); returns at once
#
# SELFTEST_LOCK=/path  run the E2E inside that lock (lockf), where several runs share one machine.
# A changed file with no rule below runs a small default set and is named, so this table stays complete.
set -u
cd "$(dirname "$0")/.."

full=0; plan=0; bg=0; install=0; since=""
args=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --full) full=1;; --plan) plan=1;; --bg) bg=1;; --install) install=1;;
    --since) shift; since="${1:-HEAD}";;
    *) echo "usage: scripts/verify.sh [--plan] [--full] [--since REF] [--bg] [--install]"; exit 2;;
  esac
  shift
done

if [ "$bg" = 1 ]; then
  log="${VERIFY_LOG:-/tmp/rally-verify.log}"
  rest=(); for a in "${args[@]}"; do [ "$a" = "--bg" ] || rest+=("$a"); done
  nohup "$0" ${rest[@]+"${rest[@]}"} >"$log" 2>&1 &
  echo "running in the background (pid $!), log: $log"
  exit 0
fi

# E2E scenario → the files that can change what it sees. Names must be in app/selftest.sh's list.
css_scenarios() {
  case "$(basename "$1")" in
    10-terminal.css|80-panel-term.css)                      echo "term split close termui termcmd panelterm layout";;
    91-controls.css|90-late.css|40-header.css|55-widths.css|00-base.css|25-phone.css) echo "controls layout panelstat onerow uismall";;
    30-prompt.css|32-whenfree.css)                          echo "whenfree drafts controls";;
    15-panel.css|50-misc.css|20-history.css|45-viewer.css)  echo "panelstat onerow detail controls";;
    60-newsession.css)                                      echo "new yaynew agynew";;
    70-list.css|05-board.css)                               echo "listdock layout view";;
    86-askpop.css)                                          echo "askpop";;
    *)                                                      echo "view layout controls";;
  esac
}
js_scenarios() {
  case "$(basename "$1")" in
    03-panel.js|04-panel-html.js|05-panel-send.js|06-history.js|12-thread.js) echo "detail send reply drafts onerow panelstat";;
    22-whenfree.js)                                         echo "whenfree drafts";;
    24-newsession.js)                                       echo "new yaynew agynew";;
    39-board.js|00-core.js|42-state.js|48-bridge.js)        echo "view detail covered listdock kbd";;
    43-askpop.js)                                            echo "askpop askwire askq";;
    51-strip.js|54-pty.js|57-panel-term.js|60-pty-park.js)  echo "term pty panelterm ptycache split close termui";;
    75-keys.js|01-keymap.js|90-help.js|92-keyset.js)        echo "kbd keys keybind qmark";;
    78-boot.js|81-palette.js)                               echo "views controls covered";;
    *)                                                      echo "view detail covered";;
  esac
}
# one file → scenario names, FULL (everything), NONE (unit tests are enough) or DEFAULT (no rule)
for_file() {
  case "$1" in
    app/Sources/*|app/selftest.sh|app/build.sh|app/Package.swift|app/Info.plist|package.json|bin/*|lib/names.js|lib/paths.js) echo FULL;;
    app/selftest/*.js)   basename "$1" .js;;
    app/*|test/*|docs/*|README.md|LICENSE|scripts/*|design/*|Casks/*) echo NONE;;
    lib/ui/css/*.css)    css_scenarios "$1";;
    lib/ui/js/*.js)      js_scenarios "$1";;
    lib/ui/index.html)   echo "view layout controls covered";;
    lib/*)               echo "view detail send whenfree";;
    *)                   echo DEFAULT;;
  esac
}

if [ -n "$since" ]; then changed=$(git diff --name-only "$since"); else changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } ); fi
changed=$(printf '%s\n' "$changed" | sort -u | sed '/^$/d')
[ -n "$changed" ] || { [ "$full" = 1 ] || echo "nothing changed (try --since HEAD~1, or --full)"; [ "$full" = 1 ] || exit 0; }

known=$(grep '^scenarios=(' app/selftest.sh | sed -e 's/^scenarios=(//' -e 's/)$//' -e 's/^.*\[ \${#scenarios\[@\]} -eq 0 \] && scenarios=(//' | tr ' ' '\n' | sed '/^$/d')
need=""; unknown_files=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  r=$(for_file "$f")
  case "$r" in
    FULL) full=1; why_full="$f";;
    NONE) ;;
    DEFAULT) unknown_files="$unknown_files $f"; need="$need view detail covered";;
    *) need="$need $r";;
  esac
done <<EOF2
$changed
EOF2

# the rename copy check (it doubles the unit tests' time) is for new files, a changed name, or a full run
added=$( { git diff --name-only --diff-filter=A "${since:-HEAD}"; git ls-files --others --exclude-standard; } | sed '/^$/d')
rename_check=0
{ [ "$full" = 1 ] || [ -n "$added" ] || printf '%s\n' "$changed" | grep -qE '^(scripts/rename.py|lib/names.js|test/rename-check.js)$'; } && rename_check=1

scen=(); for n in $(printf '%s\n' $need | sort -u); do printf '%s\n' "$known" | grep -qx "$n" && scen+=("$n"); done
all=$(printf '%s\n' "$known" | grep -c .)
if [ "$full" = 1 ]; then n=$all; else n=${#scen[@]}; fi
unit=100; [ "$rename_check" = 1 ] && unit=200
secs=$(( unit + 30 + 9 * n ))      # unit tests ~100 s (200 with the rename copy), build + launch ~30 s, ~9 s per scenario (measured)

echo "changed: $(printf '%s\n' "$changed" | wc -l | tr -d ' ') file(s)"
[ -z "${why_full:-}" ] || echo "full run because of: $why_full"
[ -z "$unknown_files" ] || echo "no rule for:$unknown_files (add it to scripts/verify.sh; ran the default set)"
if [ "$full" = 1 ]; then echo "E2E: all $all scenarios"; else echo "E2E: ${scen[*]:-none} ($n of $all)"; fi
echo "rename copy check: $([ "$rename_check" = 1 ] && echo yes || echo skipped)"
echo "about $(( (secs + 59) / 60 )) min"
[ "$plan" = 1 ] && exit 0

t0=$(date +%s); step() { echo "== $1 ($(( $(date +%s) - t0 ))s in)"; }
step "unit tests"
if [ "$rename_check" = 1 ]; then node test/test.js; else SKIP_RENAME_CHECK=1 node test/test.js; fi > /tmp/rally-verify-unit-full.txt 2>&1
tail -3 /tmp/rally-verify-unit-full.txt | tee /tmp/rally-verify-unit.txt | sed 's/^/   /'
# every summary line must say 0 failed (test.js prints page.js's and its own), and there must be one
if grep -qE '^[0-9]+ passed, [1-9][0-9]* failed$' /tmp/rally-verify-unit.txt || ! grep -qE '^[0-9]+ passed, 0 failed$' /tmp/rally-verify-unit.txt; then
  grep '✗' /tmp/rally-verify-unit-full.txt | head -10 | sed 's/^/   /'; echo "unit tests failed"; exit 1
fi
if [ "$full" = 0 ] && [ ${#scen[@]} -eq 0 ] && [ "$install" = 0 ]; then echo "done in $(( $(date +%s) - t0 ))s (no E2E needed)"; exit 0; fi
step "build"
(cd app && ./build.sh >/tmp/rally-verify-build.log 2>&1) || { tail -20 /tmp/rally-verify-build.log; echo "build failed"; exit 1; }
if [ "$full" = 1 ] || [ ${#scen[@]} -gt 0 ]; then
  step "E2E"
  run=(./selftest.sh); [ "$full" = 1 ] || run+=("${scen[@]}")
  if [ -n "${SELFTEST_LOCK:-}" ]; then run=(lockf -t 900 -k "$SELFTEST_LOCK" "${run[@]}"); fi
  out=$(cd app && "${run[@]}" 2>&1 | grep -E '✗|passed,')
  echo "$out" | sed 's/^/   /' | cut -c1-300
  if [ -z "$out" ] || ! echo "$out" | grep -qE ' 0 failed$' || echo "$out" | grep -q '✗'; then echo "done in $(( $(date +%s) - t0 ))s"; exit 1; fi
fi
if [ "$install" = 1 ]; then
  step "install"
  osascript -e 'tell application "Rally" to quit' 2>/dev/null; sleep 2; pkill -x Rally 2>/dev/null
  rm -rf "$HOME/Applications/Rally.app" && cp -r app/dist/Rally.app "$HOME/Applications/" && open "$HOME/Applications/Rally.app" && echo "   installed and reopened"
fi
echo "done in $(( $(date +%s) - t0 ))s"
