#!/bin/bash
# End-to-end tests of Rally.app: each scenario launches the real app, drives the real page, and
# writes report.json, screenshot.png, app.log and board.log under $OUT/<scenario>/.
#
# Isolation: it never touches your board or sessions. The app runs as a copy with its own bundle
# id and HOME=$SCRATCH/fh, a fixture home of made-up sessions (test/fixtures/selftest-home.js);
# every store the CLI and app write is pointed into $SCRATCH (RALLY_*). Under RALLY_SELFTEST the
# app and CLI run no claude but the fake below and drive no terminal app. (NSHomeDirectory() stays
# yours: with CFFIXED_USER_HOME the web view never loads.) A *selftest* file left under a real
# data directory fails the run. The window is invisible and never takes focus or your input.
#
# A skipped check fails (SELFTEST_ALLOW_SKIP=1 passes it); so does a page that threw. Each scenario
# ends within RALLY_SELFTEST_TIMEOUT seconds (240). RALLY_SELFTEST_FOREGROUND=1 shows the window;
# RALLY_SELFTEST_OFFSCREEN=1 never shows it (pty kbd notify then fail).
#
#   ./selftest.sh              all default scenarios (see `scenarios` below, plus selftest/*.js)
#   ./selftest.sh send         one (also: run, soak — not in the default set)
#   ./selftest.sh layout       at 640 / 900 / 1280 / 1920 px (RALLY_SELFTEST_SIZE=WxH for one)
#   ./selftest.sh soak         SOAK_MIN minutes (40) over SOAK_PHASES launches (5), sampled by selftest/soaksample.py
#   SELFTEST_REAL_CLAUDE=1 RALLY_SELFTEST_SESSION=<id> RALLY_SELFTEST_SESSION2=<id>[@<dir>] ./selftest.sh persist
#                              persist with the real claude on two scratch sessions; runs on your real
#                              home (the real claude needs your login)
set -u
cd "$(dirname "$0")"
BUILT="dist/Rally.app"
OUT="${SELFTEST_OUT:-/tmp/rally-selftest}"
[ -x "$BUILT/Contents/MacOS/Rally" ] || { echo "build first: ./build.sh"; exit 2; }
# every name the product has had, current first (lib/names.js)
NAMES=($(node -p "require('../lib/names.js').NAMES.join(' ')"))
NEWN="${NAMES[0]}"; OLDN="${NAMES[${#NAMES[@]}-1]}"
# the real claude only for persist on named sessions: otherwise it would act on whatever card came first
if [ -n "${SELFTEST_REAL_CLAUDE:-}" ]; then
  if [ "$*" != "persist" ]; then echo "SELFTEST_REAL_CLAUDE=1 is for ./selftest.sh persist alone"; exit 2; fi
  if [ -z "${RALLY_SELFTEST_SESSION:-}" ] || [ -z "${RALLY_SELFTEST_SESSION2:-}" ]; then
    echo "SELFTEST_REAL_CLAUDE=1 needs RALLY_SELFTEST_SESSION and RALLY_SELFTEST_SESSION2 (scratch sessions made for it)"; exit 2
  fi
fi
scenarios=("$@"); [ ${#scenarios[@]} -eq 0 ] && scenarios=(view zoom worker new send detail resize finish wip term pty attach keys kbd notify termsize split close views panelterm ptycache shellenv termcmd askwire askq reply attwait homesend bang model yaynew grips askpop cardstep qmark onerow shifttype termime ptyglyph typekeys keysteal uismall listdock termui panelstat pendpage jobspage panelacts whenfree drafts histscroll takeover termblack persist keybind rename controls codexterm covered agynew layout)
SCRATCH="$(mktemp -d)"
# the scratch holds a copy of the app: removed however the run ends
trap 'rm -rf "$SCRATCH"' EXIT
# a copy under another bundle id, re-signed after the Info.plist edit
cp -R "$BUILT" "$SCRATCH/RallySelftest.app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier dev.sue738.rally.selftest" "$SCRATCH/RallySelftest.app/Contents/Info.plist"
codesign --force --deep -s - "$SCRATCH/RallySelftest.app" 2>/dev/null
APP="$SCRATCH/RallySelftest.app/Contents/MacOS/Rally"
mkdir -p "$SCRATCH/home"
touch "$SCRATCH/.start"
# the fixture home (ids as name=<uuid>)
FH="$SCRATCH/fh"
node ../test/fixtures/selftest-home.js "$FH" "$FH/work" > "$SCRATCH/fixture.ids" || { echo "could not make the fixture board"; exit 2; }
fixture() { sed -n "s/^$1=//p" "$SCRATCH/fixture.ids"; }
homeenv=(HOME="$FH")
[ -n "${SELFTEST_REAL_CLAUDE:-}" ] && homeenv=()
fail=0; passed=0; failed=0; skippedn=0
expanded=()
for sc in "${scenarios[@]}"; do
  if [ "$sc" = "layout" ] && [ -z "${RALLY_SELFTEST_SIZE:-}" ]; then expanded+=(layout@640x900 layout@900x900 layout@1280x900 layout@1920x1000)
  else expanded+=("$sc"); fi
done
for sc in "${expanded[@]}"; do
  size="${RALLY_SELFTEST_SIZE:-}"; run="$sc"
  js="${RALLY_SELFTEST_JS:-}"
  case "$sc" in layout@*) size="${sc#layout@}"; run=layout;; esac
  # a page-script check (selftest/<name>.js) runs through the probe scenario
  if [ -f "selftest/$sc.js" ]; then run=probe; js="$PWD/selftest/$sc.js"; fi
  d="$OUT/$sc"; rm -rf "$d"; mkdir -p "$d"
  FAKE="$SCRATCH/fake-claude-$sc"; ARGV="$SCRATCH/argv-$sc.log"
  BINC="$FAKE"; BINX="$FAKE"
  if [ -n "${SELFTEST_REAL_CLAUDE:-}" ]; then BINC="$(command -v claude || echo "$HOME/.local/bin/claude")"; BINX="$(type -P codex 2>/dev/null || command -v codex || echo codex)"; fi
  # A fake claude per scenario (a detached dispatch from the last one must not land in this argv.log).
  # It answers as the real CLI does: `agents --json` an empty list (else the board holds every
  # message), --bg "backgrounded · <id>" with the id in colour even into a file; a new session is
  # listed by `agents` and writes its transcript a moment later.
  export FAKE_ARGV="$ARGV" FAKE_AGENTS="$SCRATCH/agents-$sc.json" FAKE_MADE="$SCRATCH/made-$sc"
  cat > "$FAKE" <<'FAKE'
#!/bin/sh
if [ "$1" = "agents" ]; then cat "$FAKE_AGENTS" 2>/dev/null || echo "[]"; exit 0; fi
# takeover: an interactive claude "in another terminal", idle until SIGTERM
if [ "$1" = "interactive-stub" ]; then trap 'kill $! 2>/dev/null; exit 0' TERM; sleep 300 & wait; exit 0; fi
{ printf "%s\n" "$@"; pwd; printf "\036\n"; } >> "$FAKE_ARGV"
id=0badc0de; prev=; resumed=; for a in "$@"; do [ "$prev" = "--resume" ] && { id=$(printf %s "$a" | cut -c1-8); resumed=1; }; prev=$a; done
if [ "$1" = "attach" ] || { [ "$1" = "--resume" ] && [ "$#" = 2 ]; }; then echo "fake claude $*"; exec sleep 300; fi
# agy -p <ask> --output-format stream-json: init, one answer, the result
case " $* " in *" --output-format stream-json "*)
  conv=; prev=; for a in "$@"; do [ "$prev" = "--conversation" ] && conv=$a; prev=$a; done
  [ -n "$conv" ] || conv=$(uuidgen | tr 'A-Z' 'a-z')
  printf '{"event":"init","conversation_id":"%s","init":{"cwd":"%s","tools":[],"permission_mode":"request-review"}}\n' "$conv" "$(pwd -P)"
  printf '{"event":"step_update","step_update":{"conversation_id":"%s","step_index":0,"state":"DONE","step_type":"user_input"}}\n' "$conv"
  sleep 1
  printf '{"event":"step_update","step_update":{"conversation_id":"%s","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"fake antigravity: PONG","duration_seconds":1}}\n' "$conv"
  printf '{"event":"result","result":{"conversation_id":"%s","status":"SUCCESS","response":"fake antigravity: PONG","num_turns":1}}\n' "$conv"
  exit 0;;
esac
# codex resume <id>: the panel's terminal for a stopped codex session
if [ "$1" = "resume" ] && [ "$#" = 2 ]; then echo "fake codex $*"; exec sleep 300; fi
# a relay carrier (lib/relay.js)
case " $* " in *"ListAgents,SendMessage"*) printf '{"type":"result","subtype":"success","is_error":false,"result":"SENT"}\n'; exit 0;; esac
case " $* " in *" --bg "*) ;; *) exit 0;; esac
if [ -z "$resumed" ] && [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  full=$(uuidgen | tr 'A-Z' 'a-z'); id=$(printf %s "$full" | cut -c1-8); cwd=$(pwd -P)
  text=; seen=; for a in "$@"; do [ -n "$seen" ] && text=$a; [ "$a" = "--" ] && seen=1; done
  printf '%s\n' "$full" >> "$FAKE_MADE"
  printf '[{"id":"%s","sessionId":"%s","pid":%s,"kind":"background","status":"busy","cwd":"%s","startedAt":%s000}]\n' "$id" "$full" "$$" "$cwd" "$(date +%s)" > "$FAKE_AGENTS"
  proj="$CLAUDE_CONFIG_DIR/projects/$(printf %s "$cwd" | sed 's/[^A-Za-z0-9]/-/g')"; mkdir -p "$proj"
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  ( sleep 2; python3 -c 'import json,sys; print(json.dumps({"parentUuid":None,"isSidechain":False,"type":"user","message":{"role":"user","content":sys.argv[1]},"uuid":sys.argv[2],"timestamp":sys.argv[3],"userType":"external","entrypoint":"cli","cwd":sys.argv[4],"sessionId":sys.argv[2],"sessionKind":"bg","version":"selftest"}, ensure_ascii=False))' "$text" "$full" "$ts" "$cwd" > "$proj/$full.jsonl" ) >/dev/null 2>&1 &
fi
printf 'backgrounded · \033[36m%s\033[39m\n' "$id"
for c in "agents             list sessions" "attach $id    open in this terminal" "logs $id      show recent output" "stop $id      stop this session"; do printf '\033[2m  claude %s\033[22m\n' "$c"; done
FAKE
  chmod +x "$FAKE"; rm -f "$FAKE_AGENTS" "$FAKE_MADE"
  # rename: the oldest name's data directory in the fixture home, for the app to move at start
  if [ "$sc" = "rename" ]; then
    for n in "${NAMES[@]}"; do rm -rf "$FH/.$n"; done
    mkdir -p "$FH/.$OLDN/bin"
    printf 'old-data\n' > "$FH/.$OLDN/marker"
    printf '#!/bin/sh\nexit 0\n' > "$FH/.$OLDN/bin/permhook"; chmod +x "$FH/.$OLDN/bin/permhook"
  fi
  # askq: two AskUserQuestion requests held by the real lib/permhook.js on a fixture card, in the
  # scratch perm directory; the hook's stdout (the answer) is checked after the app exits
  hookpids=()
  if [ "$sc" = "askq" ]; then
    sid="$(fixture gamma)"
    mkdir -p "$SCRATCH/home/perm"; touch "$SCRATCH/home/perm/.watch"
    q1='{"question":"Which color do you prefer?","header":"Color","multiSelect":false,"options":[{"label":"Red","description":"warm"},{"label":"Blue","description":"cool"}]}'
    q2='{"question":"Which sizes?","header":"Size","multiSelect":true,"options":[{"label":"S"},{"label":"M"},{"label":"L"}]}'
    n=1
    for qs in "[$q1]" "[$q1,$q2]"; do
      printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":%s}}' "$sid" "$SCRATCH" "$qs" \
        | env -u RALLY_PERM_DIR CLAUDE_CODE_ENTRYPOINT=cli RALLY_HOME="$SCRATCH/home" node ../lib/permhook.js > "$d/hook$n.out" &
      hookpids+=($!); n=$((n+1)); sleep 0.5
    done
  fi
  # whenfree (今の作業後に送る): a fixture session the fake lists as a busy
  # interactive one. It goes idle once the page colours the card (labels.json is the page's one
  # write); each relay then runs a turn. Markers in argv.log time it for the check below.
  wfpid=
  if [ "$sc" = "whenfree" ]; then
    # not written to lately (a live one reads as 作業中)
    wsid="$(fixture zeta)"
    # the transcript must agree with the status (busy over an ended turn reads as background tasks,
    # lib/live.js turnEnded); restored after the scenario
    zf="$(find "$FH/.claude/projects" -name "$wsid.jsonl" | head -1)"; zbak="$SCRATCH/zeta-$sc.bak"; cp -p "$zf" "$zbak"
    wfturn() { python3 - "$zf" "$1" <<'PY'
import json, sys, time
f, st = sys.argv[1], sys.argv[2]
last = json.loads(open(f).read().rstrip('\n').split('\n')[-1])
base = {k: last[k] for k in ('cwd', 'sessionId', 'entrypoint', 'userType', 'version') if k in last}
ms = int(time.time() * 1000)
ts = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(ms / 1000)) + '.%03dZ' % (ms % 1000)
tidf = f + '.wftid'
out = []
if st == 'busy':
    tid = 'toolu_wf_%d' % ms
    open(tidf, 'w').write(tid)
    out.append({**base, 'type': 'assistant', 'timestamp': ts, 'message': {'role': 'assistant', 'model': 'claude-selftest', 'stop_reason': 'tool_use', 'content': [{'type': 'tool_use', 'id': tid, 'name': 'Bash', 'input': {'command': 'sleep 8'}}]}})
else:
    try: tid = open(tidf).read().strip()
    except OSError: tid = ''
    if tid: out.append({**base, 'type': 'user', 'timestamp': ts, 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tid, 'content': 'ok'}]}})
    out.append({**base, 'type': 'assistant', 'timestamp': ts, 'message': {'role': 'assistant', 'model': 'claude-selftest', 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': 'selftest: 終わりました'}]}})
    out.append({**base, 'type': 'system', 'subtype': 'turn_duration', 'timestamp': ts, 'durationMs': 8000})
with open(f, 'a') as w:
    for o in out: w.write(json.dumps(o, ensure_ascii=False) + '\n')
PY
    }
    wfstatus() { printf '[{"id":"%s","sessionId":"%s","pid":%s,"kind":"interactive","status":"%s","name":"wf-selftest","cwd":"%s","startedAt":%s000}]\n' "$(printf %s "$wsid" | cut -c1-8)" "$wsid" "$$" "$1" "$SCRATCH" "$(date +%s)" > "$FAKE_AGENTS"; }
    # busy: transcript first; idle: status first (never busy over an ended turn)
    wfentry() { if [ "$1" = busy ]; then wfturn busy; wfstatus busy; else wfstatus idle; wfturn idle; fi; }
    wfentry busy
    ( WL="$SCRATCH/labels-$sc.json"
      for _ in $(seq 1 1500); do grep -q '"color"' "$WL" 2>/dev/null && break; sleep 0.2; done
      printf 'FLIP-idle\n\036\n' >> "$ARGV"; wfentry idle
      seen=0
      # TURN-idle before the flip: once idle the board may send at once, ahead of a later marker
      for _ in $(seq 1 1500); do
        n="$(grep -c 'ListAgents,SendMessage' "$ARGV" 2>/dev/null)"; n="${n:-0}"
        if [ "$n" -gt "$seen" ]; then seen=$n; wfentry busy; printf 'TURN-busy\n\036\n' >> "$ARGV"; sleep 8; printf 'TURN-idle\n\036\n' >> "$ARGV"; wfentry idle; fi
        [ "$seen" -ge 3 ] && break; sleep 0.2
      done ) >/dev/null 2>&1 &
    wfpid=$!
  fi
  # takeover (ここで開き直す): a fixture session open in "another terminal" (a stand-in pid); when it
  # exits, TK-closed goes into argv.log, and a resume must come only after it
  tkpid=; tkwatch=
  if [ "$sc" = "takeover" ]; then
    tsid="$(fixture beta)"
    "$FAKE" interactive-stub & tkpid=$!
    printf '[{"sessionId":"%s","pid":%s,"kind":"interactive","status":"idle","cwd":"%s","startedAt":%s000}]\n' "$tsid" "$tkpid" "$FH/work/beta" "$(date +%s)" > "$FAKE_AGENTS"
    ( while kill -0 "$tkpid" 2>/dev/null; do sleep 0.2; done; echo "[]" > "$FAKE_AGENTS"; printf 'TK-closed\n\036\n' >> "$ARGV" ) >/dev/null 2>&1 &
    tkwatch=$!
  fi
  # termblack: a fixture session idle in the background, so its terminal is `claude attach`
  if [ "$sc" = "termblack" ]; then
    tsid="$(fixture beta)"
    "$FAKE" interactive-stub & tkpid=$!
    printf '[{"id":"%s","sessionId":"%s","pid":%s,"kind":"background","status":"idle","cwd":"%s","startedAt":%s000}]\n' "$(printf %s "$tsid" | cut -c1-8)" "$tsid" "$tkpid" "$FH/work/beta" "$(date +%s)" > "$FAKE_AGENTS"
  fi
  # new: a claude home of its own, with one earlier session (an empty one is not rescanned for 10 min)
  cfg=(); if [ "$run" = "new" ]; then
    old="$SCRATCH/claude-$sc/projects/-selftest-earlier"; mkdir -p "$old"
    python3 -c 'import json,sys,time,uuid; t=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-3600)); u=str(uuid.uuid4()); print(json.dumps({"type":"user","message":{"role":"user","content":"selftest: an earlier session"},"uuid":u,"timestamp":t,"userType":"external","entrypoint":"cli","cwd":sys.argv[1],"sessionId":u,"isSidechain":False,"parentUuid":None}))' "$SCRATCH" > "$old/earlier.jsonl"
    cfg=(CLAUDE_CONFIG_DIR="$SCRATCH/claude-$sc")
  fi
  # persist: two launches on one scratch home, terminals left running between them
  phases=(""); [ "$sc" = "persist" ] && phases=(1 2)
  # soak: the same, SOAK_PHASES times, watched by a sampler that outlives each launch
  lastphase=2; samplerpid=
  if [ "$sc" = "soak" ]; then
    lastphase="${SOAK_PHASES:-5}"; phases=($(seq 1 "$lastphase"))
    python3 selftest/soaksample.py "$d" "$SCRATCH/home" "${SOAK_EVERY:-15}" > "$d/sampler.log" 2>&1 &
    samplerpid=$!
  fi
  for phase in "${phases[@]}"; do
  pd="$d"; extra=(); if [ -n "$phase" ]; then extra=(RALLY_SELFTEST_PHASE="$phase" RALLY_SELFTEST_SESSION="${RALLY_SELFTEST_SESSION:-}" RALLY_SELFTEST_SESSION2="${RALLY_SELFTEST_SESSION2:-}" SELFTEST_REAL_CLAUDE="${SELFTEST_REAL_CLAUDE:-}"); fi
  [ "$sc" = "soak" ] && extra+=(RALLY_SELFTEST_PHASES="$lastphase" RALLY_SELFTEST_MINUTES="${SOAK_MIN:-40}")
  if [ -n "$phase" ] && [ "$phase" -lt "$lastphase" ]; then pd="$d/phase$phase"; mkdir -p "$pd"; extra+=(RALLY_SELFTEST_KEEPPTY=1); fi
  # the app's own log (RALLY_HOME/app.log), kept per scenario as board.log
  rm -f "$SCRATCH/home/app.log"
  env ${homeenv[@]+"${homeenv[@]}"} ${cfg[@]+"${cfg[@]}"} ${extra[@]+"${extra[@]}"} RALLY_SELFTEST="$pd" RALLY_SELFTEST_SCENARIO="$run" RALLY_SELFTEST_SIZE="$size" RALLY_SELFTEST_CWD="$SCRATCH" RALLY_SELFTEST_JS="$js" \
  RALLY_RUNS="$SCRATCH/runs-$sc" RALLY_BIN_CLAUDE="$BINC" RALLY_BIN_CODEX="$BINX" RALLY_BIN_ANTIGRAVITY="$BINX" \
  RALLY_TITLES="$SCRATCH/titles.json" RALLY_SCAN_CACHE="$SCRATCH/scan-cache.json" RALLY_NO_ENRICH=1 \
  RALLY_ATTACHMENTS="$SCRATCH/attachments-$sc" RALLY_DONE="$SCRATCH/done-$sc.json" RALLY_WIP="$SCRATCH/wip-$sc.json" RALLY_WIP_OUT="$SCRATCH/wip-$sc" \
  RALLY_QUEUE="$SCRATCH/queue-$sc.json" RALLY_LABELS="$SCRATCH/labels-$sc.json" \
  RALLY_HOME="$SCRATCH/home" RALLY_INDEX="$SCRATCH/session-index.json" RALLY_IMG="$SCRATCH/img" \
  RALLY_LAST_CACHE="$SCRATCH/last-cache.json" \
  RALLY_MADE_CACHE="$SCRATCH/made-cache.json" RALLY_FORKS="$SCRATCH/forks-$sc.json" \
  RALLY_WTSETUP="$SCRATCH/wtsetup-$sc.json" RALLY_TRASH="$SCRATCH/trash" \
  RALLY_ENRICH_LOG="$SCRATCH/enrich-spawns.json" RALLY_LIMITS="$SCRATCH/rate_limits.json" \
  RALLY_CLAUDE_SETTINGS="$FH/.claude/settings.json" RALLY_CLAUDE_JOBS="$SCRATCH/claude-jobs" \
  RALLY_CODEX_SESSIONS="$SCRATCH/codex-sessions" \
    "$APP" > "$pd/app.log" 2>&1
  mv "$SCRATCH/home/app.log" "$pd/board.log" 2>/dev/null
  [ "$sc" = "soak" ] && sleep 1
  if [ "$sc" = "persist" ] && [ "$phase" = 1 ]; then
    # the app has quit: its pty host and terminals must still run, reparented to launchd
    sleep 1
    python3 - "$SCRATCH/home/pty.sock" "$d/between.json" "${SELFTEST_REAL_CLAUDE:+real}" <<'EOF'
import json, subprocess, sys
sock, outp, real = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
ps = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True).stdout.splitlines()
rows = [(int(l.split(None, 2)[0]), int(l.split(None, 2)[1]), l.split(None, 2)[2] if len(l.split(None, 2)) > 2 else "") for l in ps if l.strip()]
host = [r for r in rows if "rally-ptyd" in r[2] and sock in r[2]]
hp = host[0][0] if host else 0
kids = [r for r in rows if hp and r[1] == hp]
out = {"host": hp, "hostPpid": host[0][1] if host else None, "children": [{"pid": k[0], "cmd": k[2][:160]} for k in kids]}
if real:
    try: out["agents"] = [{k: a.get(k) for k in ("id", "sessionId", "pid", "kind", "status", "state")} for a in json.loads(subprocess.run(["claude", "agents", "--json"], capture_output=True, text=True, timeout=20).stdout or "[]")]
    except Exception as e: out["agents"] = str(e)
json.dump(out, open(outp, "w"), indent=1)
EOF
  fi
  done
  for hp in ${hookpids[@]+"${hookpids[@]}"}; do kill "$hp" 2>/dev/null; wait "$hp" 2>/dev/null; done
  [ -n "$wfpid" ] && { pkill -P "$wfpid" 2>/dev/null; kill "$wfpid" 2>/dev/null; wait "$wfpid" 2>/dev/null; }
  [ -n "${zbak:-}" ] && [ -f "$zbak" ] && { cp -p "$zbak" "$zf"; rm -f "$zbak" "$zf.wftid"; zbak=; }
  # the sampler takes one last look and writes its summary
  [ -n "$samplerpid" ] && { sleep 8; kill -TERM "$samplerpid" 2>/dev/null; wait "$samplerpid" 2>/dev/null; }
  # takeover: a stand-in still running when the app quit was never closed
  tkleft=; if [ -n "$tkpid" ]; then kill -0 "$tkpid" 2>/dev/null && tkleft=1; kill "$tkpid" 2>/dev/null; wait "$tkpid" 2>/dev/null; sleep 0.5; kill "$tkwatch" 2>/dev/null; wait "$tkwatch" 2>/dev/null; fi
  export TKLEFT="$tkleft" RENAME_FH="$FH" RENAME_APP="$APP" RENAME_NEW="$NEWN" RENAME_OLD="$OLDN" RENAME_NAMES="${NAMES[*]}"
  # argv.log comes from a detached process the app never waits on: poll for it (up to 15s under load)
  if [ "$sc" = "new" ] || [ "$sc" = "send" ] || [ "$sc" = "wip" ] || [ "$sc" = "attach" ]; then
    for _ in $(seq 1 150); do [ -s "$ARGV" ] && break; sleep 0.1; done
  fi
  cp "$ARGV" "$d/argv.log" 2>/dev/null
  if python3 - "$d/report.json" "$sc" "$ARGV" "$SCRATCH/board.json" "$FAKE_MADE" "$SCRATCH" <<'EOF'
import json, sys, os
p, sc, argv = sys.argv[1:4]
made, scratch = sys.argv[5], os.path.realpath(sys.argv[6])
try: r = json.load(open(p))
except Exception as e: print(f"  ✗ {sc}: no report ({e})"); sys.exit(1)
ok = r.get("ok") is True
notes = []
# opening a stopped session sends nothing: `--bg --resume <id>` with no `--`, or attach (lib/bgopen.js)
def opened(c):
    return c[0] == "attach" or (c[0] == "--bg" and len(c) >= 3 and c[1] == "--resume" and "--" not in c)
if sc == "kbd" and os.path.exists(argv):
    # thirty key presses, one Enter in the message box: none may send (a `-p --no-session-persistence`
    # summary read and a bare `--resume <id>` are not sends)
    sent = [c for c in (r.strip("\n").split("\n") for r in open(argv).read().split("\x1e") if r.strip()) if c and c[0] != "agents" and not (c[0] == "-p" and "--no-session-persistence" in c) and not (c[0] == "--resume" and len(c) == 3) and not opened(c)]
    if sent: ok = False; notes.append("a key sent something: " + " ".join(sent[0][:4]))
if sc == "kbd" and not ok and r.get("failed"): notes.append("failed: " + " / ".join(r["failed"]))
def skips_of(rep):
    out = [rep["skipped"]] if rep.get("skipped") else []
    pr = rep.get("probe") if isinstance(rep.get("probe"), dict) else {}
    for k, v in pr.items():
        if k == "skipped" and v: out.append(str(v))
        elif k.startswith("skipped") or (isinstance(v, str) and v.startswith("skipped")): out.append(f"{k}: {v}")
    return out
skips = skips_of(r)
if sc == "persist":
    try: skips += ["phase 1: " + x for x in skips_of(json.load(open(os.path.join(os.path.dirname(p), "phase1", "report.json"))))]
    except Exception: pass
allow_skip = os.environ.get("SELFTEST_ALLOW_SKIP") == "1"
if skips:
    notes.append("SKIPPED: " + " / ".join(skips) + ("" if allow_skip else " (a failure; SELFTEST_ALLOW_SKIP=1 passes it)"))
    if not allow_skip: ok = False
# 完了 only marks the card: it wakes nothing, so no agent may have started
if sc == "finish" and os.path.exists(argv):
    woke = [c for c in (r.strip("\n").split("\n") for r in open(argv).read().split("\x1e") if r.strip()) if c and c[0] != "agents" and not (c[0] == "-p" and "--no-session-persistence" in c) and not (c[0] == "--resume" and len(c) == 3) and not opened(c)]
    if woke: ok = False; notes.append("完了 started an agent: " + " ".join(woke[0][:4]))
if sc in ("new", "send", "wip", "attach"):
    if os.path.exists(argv):
        # every call, newest last, probes (`agents --json`) included
        calls = [r.strip("\n").split("\n") for r in open(argv).read().split("\x1e") if r.strip()]
        def has(pred): return any(pred(c) for c in calls)
        a = calls[-1] if calls else [""]
        for c in calls:
            if c and c[0] != "agents": a = c
        notes.append("argv=" + " ".join(a[:5]))
        if sc == "new" and not has(lambda c: c[0] == "--bg" and len(c) > 2 and c[1] == "--" and c[2] == "selftest: say PONG"): ok = False; notes.append("wrong argv for new")
        if sc == "send" and not has(lambda c: c[0] == "--bg" and len(c) > 4 and c[1] == "--resume" and c[3] == "--" and c[4] == "selftest reply"): ok = False; notes.append("wrong argv for send")
        # the text always follows "--". A resume may carry no flags (any flag forks a copy), so an
        # attached file is staged into the session's directory and named in the text.
        if sc == "attach" and not has(lambda c: c[0] == "--bg" and "--add-dir" not in c and "添付ファイル" in "\n".join(c)): ok = False; notes.append("wrong argv for 添付")
        # staged under the scratch directory, never a real project
        if sc == "attach":
            staged = [l[2:] for c in calls if c and c[0] == "--bg" for x in c for l in x.split("\n") if l.startswith("- /")]
            out = [f for f in staged if not os.path.realpath(f).startswith(scratch + "/")]
            if not staged or out: ok = False; notes.append("staged outside the scratch directory: %s" % (out or "(no path in the message)"))
        if sc == "wip" and not has(lambda c: c[0] == "-p" and "--restricted" in c and "--resume" not in c and "推測で足さない" in " ".join(c)): ok = False; notes.append("wrong argv for 棚卸し")
    else:
        ok = False; notes.append("fake claude was never started")
if sc == "askq":
    d = os.path.dirname(p)
    def said(n):
        try: return json.load(open(os.path.join(d, f"hook{n}.out")))["hookSpecificOutput"]["decision"]
        except Exception: return {}
    h1, h2 = said(1), said(2)
    a1 = (h1.get("updatedInput") or {}).get("answers")
    a2 = (h2.get("updatedInput") or {}).get("answers")
    if h1.get("behavior") != "allow" or a1 != {"Which color do you prefer?": "Blue"}: ok = False; notes.append(f"hook 1 answered {h1}")
    if h2.get("behavior") != "allow" or a2 != {"Which color do you prefer?": "Red", "Which sizes?": "S, L"}: ok = False; notes.append(f"hook 2 answered {h2}")
    if ok: notes.append(f"answers={a1} / {a2}")
# whenfree: nothing sent while busy, then the two held ones in order, one per idle
if sc == "whenfree":
    recs = [x.strip("\n").split("\n") for x in open(argv).read().split("\x1e") if x.strip()] if os.path.exists(argv) else []
    def sends(c): return bool(c) and not opened(c) and (c[0] in ("--bg", "stop") or "ListAgents,SendMessage" in "\n".join(c))
    flip = [i for i, c in enumerate(recs) if c and c[0] == "FLIP-idle"]
    if not flip: ok = False; notes.append("the session was never flipped idle")
    else:
        early = [c for c in recs[:flip[0]] if sends(c)]
        if early: ok = False; notes.append("sent while busy: " + " ".join(early[0][:4]))
        idx = [i for i, c in enumerate(recs) if i > flip[0] and sends(c)]
        order = ["1" if "selftest whenfree 1" in "\n".join(recs[i]) else "2" if "selftest whenfree 2" in "\n".join(recs[i]) else "?" for i in idx]
        if order != ["1", "2"]: ok = False; notes.append("delivered: %s" % order)
        elif not any(c and c[0] == "TURN-idle" for c in recs[idx[0]:idx[1]]): ok = False; notes.append("the second went before the first one's turn ended")
        else: notes.append("delivered in order, one per idle: 1 > (turn) > 2")
    if any("selftest whenfree 3" in "\n".join(c) for c in recs): ok = False; notes.append("the one taken back was sent")
    pr = r.get("probe") or {}
    notes.append("timeline=" + ">".join(pr.get("timeline") or []) + " in " + str(pr.get("deliveredIn")))
# takeover: the other terminal's claude closed first, then resumed
if sc == "takeover":
    recs = [x.strip("\n").split("\n") for x in open(argv).read().split("\x1e") if x.strip()] if os.path.exists(argv) else []
    def resumes(c): return bool(c) and ("--resume" in c or c[0] == "attach")
    cut = [i for i, c in enumerate(recs) if c and c[0] == "TK-closed"]
    if os.environ.get("TKLEFT"): ok = False; notes.append("the stand-in claude was still running when the app quit")
    if not cut: ok = False; notes.append("the other terminal's claude was never closed")
    else:
        # only the taken-over session counts: another card the board opened on its own may resume meanwhile
        tk = str((r.get("probe") or {}).get("card") or "")
        early = [c for c in recs[:cut[0]] if resumes(c) and (not tk or any(a.startswith(tk) for a in c))]
        if early: ok = False; notes.append("resumed before it was closed (a copy): " + " ".join(early[0][:4]))
        late = [c for c in recs[cut[0]:] if resumes(c)]
        if not late: ok = False; notes.append("closed, but never resumed in the panel")
        else: notes.append("closed, then " + " ".join(late[0][:3]))
if sc == "persist":
    try: skips += ["phase 1: " + x for x in skips_of(json.load(open(os.path.join(os.path.dirname(p), "phase1", "report.json"))))]
    except Exception: pass
allow_skip = os.environ.get("SELFTEST_ALLOW_SKIP") == "1"
if skips:
    notes.append("SKIPPED: " + " / ".join(skips) + ("" if allow_skip else " (a failure; SELFTEST_ALLOW_SKIP=1 passes it)"))
    if not allow_skip: ok = False
# 完了 only marks the card: it wakes nothing, so no agent may have started
if sc == "finish" and os.path.exists(argv):
    woke = [c for c in (r.strip("\n").split("\n") for r in open(argv).read().split("\x1e") if r.strip()) if c and c[0] != "agents" and not (c[0] == "-p" and "--no-session-persistence" in c) and not (c[0] == "--resume" and len(c) == 3) and not opened(c)]
    if woke: ok = False; notes.append("完了 started an agent: " + " ".join(woke[0][:4]))
if sc in ("new", "send", "wip", "attach"):
    if os.path.exists(argv):
        # every call, newest last, probes (`agents --json`) included
        calls = [r.strip("\n").split("\n") for r in open(argv).read().split("\x1e") if r.strip()]
        def has(pred): return any(pred(c) for c in calls)
        a = calls[-1] if calls else [""]
        for c in calls:
            if c and c[0] != "agents": a = c
        notes.append("argv=" + " ".join(a[:5]))
        if sc == "new" and not has(lambda c: c[0] == "--bg" and len(c) > 2 and c[1] == "--" and c[2] == "selftest: say PONG"): ok = False; notes.append("wrong argv for new")
        if sc == "send" and not has(lambda c: c[0] == "--bg" and len(c) > 4 and c[1] == "--resume" and c[3] == "--" and c[4] == "selftest reply"): ok = False; notes.append("wrong argv for send")
        # the text always follows "--". A resume may carry no flags (any flag forks a copy), so an
        # attached file is staged into the session's directory and named in the text.
        if sc == "attach" and not has(lambda c: c[0] == "--bg" and "--add-dir" not in c and "添付ファイル" in "\n".join(c)): ok = False; notes.append("wrong argv for 添付")
        # staged under the scratch directory, never a real project
        if sc == "attach":
            staged = [l[2:] for c in calls if c and c[0] == "--bg" for x in c for l in x.split("\n") if l.startswith("- /")]
            out = [f for f in staged if not os.path.realpath(f).startswith(scratch + "/")]
            if not staged or out: ok = False; notes.append("staged outside the scratch directory: %s" % (out or "(no path in the message)"))
        if sc == "wip" and not has(lambda c: c[0] == "-p" and "--restricted" in c and "--resume" not in c and "推測で足さない" in " ".join(c)): ok = False; notes.append("wrong argv for 棚卸し")
    else:
        ok = False; notes.append("fake claude was never started")
if sc == "askq":
    d = os.path.dirname(p)
    def said(n):
        try: return json.load(open(os.path.join(d, f"hook{n}.out")))["hookSpecificOutput"]["decision"]
        except Exception: return {}
    h1, h2 = said(1), said(2)
    a1 = (h1.get("updatedInput") or {}).get("answers")
    a2 = (h2.get("updatedInput") or {}).get("answers")
    if h1.get("behavior") != "allow" or a1 != {"Which color do you prefer?": "Blue"}: ok = False; notes.append(f"hook 1 answered {h1}")
    if h2.get("behavior") != "allow" or a2 != {"Which color do you prefer?": "Red", "Which sizes?": "S, L"}: ok = False; notes.append(f"hook 2 answered {h2}")
    if ok: notes.append(f"answers={a1} / {a2}")
# whenfree: nothing sent while busy, then the two held ones in order, one per idle
if sc == "whenfree":
    recs = [x.strip("\n").split("\n") for x in open(argv).read().split("\x1e") if x.strip()] if os.path.exists(argv) else []
    def sends(c): return bool(c) and not opened(c) and (c[0] in ("--bg", "stop") or "ListAgents,SendMessage" in "\n".join(c))
    flip = [i for i, c in enumerate(recs) if c and c[0] == "FLIP-idle"]
    if not flip: ok = False; notes.append("the session was never flipped idle")
    else:
        early = [c for c in recs[:flip[0]] if sends(c)]
        if early: ok = False; notes.append("sent while busy: " + " ".join(early[0][:4]))
        idx = [i for i, c in enumerate(recs) if i > flip[0] and sends(c)]
        order = ["1" if "selftest whenfree 1" in "\n".join(recs[i]) else "2" if "selftest whenfree 2" in "\n".join(recs[i]) else "?" for i in idx]
        if order != ["1", "2"]: ok = False; notes.append("delivered: %s" % order)
        elif not any(c and c[0] == "TURN-idle" for c in recs[idx[0]:idx[1]]): ok = False; notes.append("the second went before the first one's turn ended")
        else: notes.append("delivered in order, one per idle: 1 > (turn) > 2")
    if any("selftest whenfree 3" in "\n".join(c) for c in recs): ok = False; notes.append("the one taken back was sent")
    pr = r.get("probe") or {}
    notes.append("timeline=" + ">".join(pr.get("timeline") or []) + " in " + str(pr.get("deliveredIn")))
# takeover: the other terminal's claude closed first, then resumed
if sc == "takeover":
    recs = [x.strip("\n").split("\n") for x in open(argv).read().split("\x1e") if x.strip()] if os.path.exists(argv) else []
    def resumes(c): return bool(c) and ("--resume" in c or c[0] == "attach")
    cut = [i for i, c in enumerate(recs) if c and c[0] == "TK-closed"]
    if os.environ.get("TKLEFT"): ok = False; notes.append("the stand-in claude was still running when the app quit")
    if not cut: ok = False; notes.append("the other terminal's claude was never closed")
    else:
        # only the taken-over session counts: another card the board opened on its own may resume meanwhile
        tk = str((r.get("probe") or {}).get("card") or "")
        early = [c for c in recs[:cut[0]] if resumes(c) and (not tk or any(a.startswith(tk) for a in c))]
        if early: ok = False; notes.append("resumed before it was closed (a copy): " + " ".join(early[0][:4]))
        late = [c for c in recs[cut[0]:] if resumes(c)]
        if not late: ok = False; notes.append("closed, but never resumed in the panel")
        else: notes.append("closed, then " + " ".join(late[0][:3]))
if sc == "persist":
    d = os.path.dirname(p)
    try: r1 = json.load(open(os.path.join(d, "phase1", "report.json"))); btw = json.load(open(os.path.join(d, "between.json")))
    except Exception as e: r1, btw = {}, {}; ok = False; notes.append(f"no phase 1 / between ({e})")
    if r1.get("ok") is not True: ok = False; notes.append("phase 1: " + str(r1.get("error") or r1.get("skipped") or "failed"))
    if r1.get("ptyHosted") is not True: ok = False; notes.append("phase 1 ran its terminals in-process, not in the pty host")
    kids = btw.get("children") or []
    if not btw.get("host"): ok = False; notes.append("no pty host after the app quit")
    elif btw.get("hostPpid") != 1: ok = False; notes.append(f"the pty host's parent is {btw.get('hostPpid')}, not launchd")
    if len(kids) < 2: ok = False; notes.append(f"after the quit the host runs {len(kids)} terminal(s)")
    notes.append("after quit: host %s runs %s" % (btw.get("host"), "; ".join(k["cmd"][-60:] for k in kids)))
    pr = r.get("probe") or {}
    if isinstance(pr, dict): notes.append("restored=" + json.dumps([(t.get("kind"), t.get("session"), t.get("chars")) for t in pr.get("restored") or []]))
    if "agents" in btw:
        sess = ((r1.get("probe") or {}).get("a") or {}).get("id")
        a = [x for x in btw["agents"] if isinstance(x, dict) and x.get("sessionId") == sess] if isinstance(btw["agents"], list) else []
        notes.append("claude agents after quit: " + json.dumps(a))
        if not a or not a[0].get("pid"): ok = False; notes.append("the background session is not running after the quit")
# soak: every launch passed and the sampled series stayed within bounds
if sc == "soak":
    d = os.path.dirname(p)
    for ph in sorted(x for x in os.listdir(d) if x.startswith("phase")):
        try: rp = json.load(open(os.path.join(d, ph, "report.json")))
        except Exception as e: rp = {"error": f"no report ({e})"}
        if rp.get("ok") is not True: ok = False; notes.append(f"{ph}: " + str(rp.get("error") or "failed")[:300])
    try: sm = json.load(open(os.path.join(d, "summary.json")))
    except Exception as e: sm = {}; ok = False; notes.append(f"no sampler summary ({e})")
    if sm.get("bad"): ok = False; notes.append("sampler: " + "; ".join(sm["bad"]))
    for k, v in (sm.get("series") or {}).items(): notes.append(f"{k} {v.get('start')}>{v.get('end')} (peak {v.get('peak')})")
# new: the panel is on the session the fake started
if sc == "new":
    ids = open(made).read().split() if os.path.exists(made) else []
    if not ids: ok = False; notes.append("the fake started no new session")
    elif r.get("panel") != "claude:" + ids[0]: ok = False; notes.append("panel is %r, the session started was %s" % (r.get("panel"), ids[0]))
    if len(ids) > 1: ok = False; notes.append("two Enters started %d sessions" % len(ids))
    ans = r.get("answers") or []
    if ids and not any(a.get("short") == ids[0][:8] for a in ans): ok = False; notes.append("the start's answer did not carry the short id: " + json.dumps(ans)[:200])
    notes.append("phases=" + ">".join(r.get("phases") or []))
# rename: old data directory moved and linked, logged, old hook path still runs; the binary names no
# old name except as a compatibility name
if sc == "rename":
    import subprocess, re
    fh = os.environ.get("RENAME_FH", ""); oldn, newn = os.environ["RENAME_OLD"], os.environ["RENAME_NEW"]
    old, new = os.path.join(fh, "." + oldn), os.path.join(fh, "." + newn)
    try:
        if not os.path.islink(old) or os.readlink(old) != "." + newn: ok = False; notes.append("~/.%s is not a link to .%s" % (oldn, newn))
        if not os.path.isdir(new) or open(os.path.join(new, "marker")).read() != "old-data\n": ok = False; notes.append("the old data is not in ~/.%s" % newn)
        elif subprocess.run([os.path.join(old, "bin", "permhook")]).returncode != 0: ok = False; notes.append("the hook by its old path does not run")
    except Exception as e: ok = False; notes.append("move not as expected: %s" % e)
    ev = []
    for l in open(os.path.join(os.path.dirname(p), "board.log"), encoding="utf-8", errors="replace").read().splitlines():
        try: j = json.loads(l)
        except Exception: continue
        if j.get("ev") == "datadir": ev.append(j.get("migrate"))
    if ev != ["migrated"]: ok = False; notes.append("app log datadir events: %s (want ['migrated'])" % ev)
    names = subprocess.run(["strings", "-a", os.environ.get("RENAME_APP", "")], capture_output=True, text=True).stdout.splitlines()
    olds = os.environ["RENAME_NAMES"].split()[1:]
    def compat(l, n): return l.strip().lower() == n or re.search(r"\." + n + r"|" + n.upper() + "_", l, re.I)
    left = sorted({l.strip()[:80] for l in names for n in olds if re.search(n, l, re.I) and not compat(l, n)})
    if left: ok = False; notes.append("the app names an old name in: %s" % left[:3])
    else: notes.append("moved and linked; the app's own strings carry only the compatibility names")
    import shutil
    for x in (old, new):
        try: os.unlink(x) if os.path.islink(x) else shutil.rmtree(x)
        except Exception: pass
# the page threw ("<message> @ <line>" or "promise: …"): a failure though the check passed
import re
thrown, vis = [], []
for bl in [os.path.join(os.path.dirname(p), "board.log"), os.path.join(os.path.dirname(p), "phase1", "board.log")]:
    try: lines = open(bl, encoding="utf-8", errors="replace").read().splitlines()
    except Exception: continue
    for l in lines:
        try: j = json.loads(l)
        except Exception: continue
        if j.get("ev") != "page-error": continue
        m = str(j.get("msg") or "")
        if m.startswith("selftest: page "): vis.append(m[15:])
        elif m.startswith("promise: ") or re.search(r" @ (\d+|\?)$", m): thrown.append(m)
if thrown: ok = False; notes.append("the page threw %d time(s): %s" % (len(thrown), " / ".join(sorted(set(thrown))[:3])))
if r.get("visibility") or vis: notes.append("page visibility: " + " > ".join(([r["visibility"]] if r.get("visibility") else []) + vis))
if r.get("timedOut"): notes.append("the app's watchdog ended it (see board.log)")
extra = {k: r[k] for k in ("pointer", "columns", "toast", "cardCol", "backlogCards", "error", "panel") if k in r}
if sc.startswith("layout") and r.get("issues"): notes.append("\n      " + "\n      ".join(r["issues"][:25]))
print(("  ✓ " if ok else "  ✗ ") + sc + "  " + json.dumps(extra, ensure_ascii=False) + ("  " + "; ".join(notes) if notes else ""))
sys.exit((3 if skips else 0) if ok else 1)
EOF
  then passed=$((passed+1)); else rc=$?; if [ $rc -eq 3 ]; then passed=$((passed+1)); skippedn=$((skippedn+1)); else fail=1; failed=$((failed+1)); fi; fi
done
# nothing of a run may land outside the scratch directory
strays=(); pats=()
for n in "${NAMES[@]}"; do strays+=("$HOME/.$n"); pats+=(-o -path "*/.$n/*"); done
# the board's data dirs, the agents' transcripts, and any dirs named in SELFTEST_STRAY_DIRS (space-separated)
strays+=("$HOME/.claude/projects" "$HOME/.codex/sessions"); for d in ${SELFTEST_STRAY_DIRS:-}; do strays+=("$d"); done
stray="$(find "${strays[@]}" -maxdepth 4 \( -path '*/.selftest-never/*' "${pats[@]}" \) -name '*selftest*' -newer "$SCRATCH/.start" 2>/dev/null)"
if [ -n "$stray" ]; then echo; echo "  ✗ files written outside the scratch directory:"; printf '      %s\n' $stray; fail=1; fi
echo; echo "$passed passed, $failed failed$([ $skippedn -gt 0 ] && echo ", $skippedn skipped (counted as passed: SELFTEST_ALLOW_SKIP=1)")"
[ $fail -eq 0 ] && echo "all scenarios passed (reports and screenshots under $OUT)" || echo "FAILED — see $OUT/<scenario>/report.json and screenshot.png"
exit $fail
