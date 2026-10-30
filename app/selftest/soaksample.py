#!/usr/bin/env python3
"""selftest.sh soak, from outside: every few seconds, until SIGTERM, what the processes of this
run hold — the app, its web view (WebContent, pid from the page's samples) and its pty host (the
rally-ptyd on this run's socket; never another) — and how the logs grow. Then a summary:
<dir>/summary.json with each series' start / end / peak, and "bad" for what is out of bounds.

  soaksample.py <report dir> <scratch home> <seconds>

Only processes of this run are looked at: the app is the copy under this run's scratch directory,
the host the one started on <scratch home>/pty.sock.
"""
import glob, json, os, signal, subprocess, sys, time

d, home, every = sys.argv[1], sys.argv[2], float(sys.argv[3])
scratch = os.path.dirname(home.rstrip("/"))
sock = os.path.join(home, "pty.sock")
osf = os.path.join(d, "os.jsonl")
stop = False
def on_term(*_):
    global stop
    stop = True
signal.signal(signal.SIGTERM, on_term)

def ps_rows():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss=,%cpu=,command="], capture_output=True, text=True).stdout
    rows = []
    for l in out.splitlines():
        f = l.split(None, 4)
        if len(f) == 5:
            try: rows.append((int(f[0]), int(f[1]), int(f[2]), float(f[3]), f[4]))
            except ValueError: pass
    return rows

def fds(pid):
    if not pid: return None
    r = subprocess.run(["lsof", "-n", "-P", "-p", str(pid)], capture_output=True, text=True)
    lines = r.stdout.splitlines()[1:]
    if not lines: return None
    kinds = {}
    for l in lines:
        f = l.split()
        # FD column: numbered descriptors only (cwd, txt, mem are not open files)
        if len(f) > 4 and f[3][:1].isdigit():
            kinds[f[4]] = kinds.get(f[4], 0) + 1
    return {"n": sum(kinds.values()), "kinds": kinds}

def size(p):
    try: return os.path.getsize(p)
    except OSError: return None

def page_samples():
    out = []
    for f in sorted(glob.glob(os.path.join(d, "samples.jsonl")) + glob.glob(os.path.join(d, "phase*", "samples.jsonl"))):
        for l in open(f, errors="replace"):
            try: out.append(json.loads(l))
            except Exception: pass
    out.sort(key=lambda s: s.get("t", 0))
    return out

def one():
    rows = ps_rows()
    app = [r for r in rows if scratch + "/RallySelftest.app/Contents/MacOS/Rally" in r[4]]
    host = [r for r in rows if "rally-ptyd" in r[4] and sock in r[4]]
    ps = page_samples()
    webpid = next((s.get("webpid") for s in reversed(ps) if s.get("webpid")), None)
    web = [r for r in rows if webpid and r[0] == webpid and "WebContent" in r[4]]
    hp = host[0][0] if host else None
    s = {"t": int(time.time() * 1000),
         "app": {"pid": app[0][0], "rss": app[0][2], "cpu": app[0][3]} if app else None,
         "web": {"pid": web[0][0], "rss": web[0][2], "cpu": web[0][3]} if web else None,
         "host": {"pid": hp, "rss": host[0][2], "cpu": host[0][3], "children": len([r for r in rows if r[1] == hp]),
                  "fds": fds(hp)} if host else None,
         "appFds": (fds(app[0][0]) or {}).get("n") if app else None,
         "appLog": size(os.path.join(home, "app.log")), "ptydLog": size(os.path.join(home, "ptyd.log")),
         "hosts": len(host)}
    with open(osf, "a") as f: f.write(json.dumps(s) + "\n")

while not stop:
    try: one()
    except Exception as e: print("sample failed:", e, flush=True)
    for _ in range(int(every * 10)):
        if stop: break
        time.sleep(0.1)
try: one()
except Exception: pass

# ---- summary ---------------------------------------------------------------
oss = [json.loads(l) for l in open(osf)] if os.path.exists(osf) else []
ps = page_samples()
def series(vals):
    v = [x for x in vals if isinstance(x, (int, float))]
    if not v: return None
    return {"start": v[0], "end": v[-1], "peak": max(v), "min": min(v), "n": len(v)}
def at(o, path):
    for k in path.split("."):
        o = o.get(k) if isinstance(o, dict) else None
    return o
out = {"series": {}, "bad": [], "phases": {}}
for name, path in [("appRssKB", "app.rss"), ("webRssKB", "web.rss"), ("hostRssKB", "host.rss"), ("hostFds", "host.fds.n"),
                   ("hostChildren", "host.children"), ("appFds", "appFds"), ("appLogB", "appLog"), ("ptydLogB", "ptydLog")]:
    sr = series([at(s, path) for s in oss])
    if sr: out["series"][name] = sr
for name in ["dom", "ptys", "xtLive", "xtermEls", "glLive", "canvases", "timeouts", "intervals", "blinks", "ctxLost", "ls", "errors", "lagMax"]:
    sr = series([s.get(name) for s in ps])
    if sr: out["series"]["page." + name] = sr
# app.log (in the scratch home, gone with the run): kept beside the report, and what it is made of
ev = {}
try:
    import shutil
    shutil.copy(os.path.join(home, "app.log"), os.path.join(d, "app-home.log"))
    for l in open(os.path.join(home, "app.log"), errors="replace"):
        try: j = json.loads(l); e = j.get("ev", "?")
        except Exception: j, e = {}, "(not json)"
        # the page's "log" carries its errors and a few notes of its own (a panel closed, a dispatch unanswered)
        if e == "page-error" and str(j.get("msg", "")).startswith("close("): e = "page-note"
        c = ev.setdefault(e, [0, 0]); c[0] += 1; c[1] += len(l)
except OSError: pass
out["appLogEvents"] = dict(sorted(ev.items(), key=lambda x: -x[1][1])[:25])
if ev.get("page-error"): out["bad"].append(f"{ev['page-error'][0]} page-error line(s) in app.log")
# per launch: the page's counts at its start and its end (a page reload resets them)
for s in ps:
    ph = out["phases"].setdefault(str(s.get("phase")), {})
    ph.setdefault("first", s); ph["last"] = s
for k, ph in out["phases"].items():
    f, l = ph.pop("first"), ph.pop("last")
    ph.update({x: [f.get(x), l.get(x)] for x in ("dom", "ptys", "xtLive", "xtermEls", "glLive", "timeouts", "intervals", "ls", "errors")})
# out of bounds
if any(s.get("hosts", 0) > 1 for s in oss): out["bad"].append("more than one pty host on this run's socket at once")
for s in ps:
    if s.get("xtLive") != s.get("ptys") and s.get("why") in ("start", "end"):
        out["bad"].append(f"phase {s.get('phase')} {s.get('why')}: {s.get('xtLive')} live xterms for {s.get('ptys')} ptys"); break
errs = sum((ph.get("errors") or [0, 0])[1] or 0 for ph in out["phases"].values())
if errs: out["bad"].append(f"{errs} page exception(s)")
# a hang: the page stopped sampling while its app ran (samples every 15 s)
gaps = [(b["t"] - a["t"]) / 1000 for a, b in zip(ps, ps[1:]) if a.get("phase") == b.get("phase")]
if gaps and max(gaps) > 90: out["bad"].append(f"the page went {max(gaps):.0f} s without a sample")
out["maxSampleGapS"] = max(gaps) if gaps else None
# growth of the host's descriptors beyond what its terminals hold (a pty is 1-2 each, plus the socket)
hf = [(at(s, "host.fds.n"), at(s, "host.children")) for s in oss if at(s, "host.fds.n") is not None]
if hf:
    over = max(n - 3 * (c or 0) for n, c in hf)
    out["hostFdsOverChildren"] = over
    if over > 40: out["bad"].append(f"pty host holds {over} descriptors more than 3 per terminal")
# the logs: under a few MB for a soak of this length
if (out["series"].get("appLogB") or {}).get("end", 0) > 20_000_000: out["bad"].append("app.log over 20 MB")
json.dump(out, open(os.path.join(d, "summary.json"), "w"), indent=1)
print(json.dumps(out)[:2000], flush=True)
