// The terminal strip: a pty per tab, drawn by xterm.js in the page (bytes out as
// base64, keys back as `ptyin`). What runs is decided here, never by the page.
// The ptys live in rally-ptyd (over <home>/pty.sock) so they survive a quit or an
// install; only when it can't start are they held in-process, and quitting asks first.
import Foundation
import Darwin
import PtyCore

final class PtyHost {
    let send: (String) -> Void
    let log: ([String: Any]) -> Void
    init(send: @escaping (String) -> Void, log: @escaping ([String: Any]) -> Void) { self.send = send; self.log = log }

    private var fd: Int32 = -1
    private var src: DispatchSourceRead?
    private var inbuf = Data()
    private let q = DispatchQueue(label: "rally.ptyclient")
    private let lock = NSLock()
    // id → pid (0 until the host says)
    private var known: [String: pid_t] = [:]
    private var metas: [String: String] = [:]
    private var closedAll: DispatchSemaphore?
    private var listWaiters: [([[String: Any]]) -> Void] = []
    private(set) var local: PtyServer?
    /// on main; a host that keeps dying is restarted at most once per restartPause
    private var startedAt: Date?
    /// hosts this app started, reaped when they end (they are our children)
    private var hostExits: [pid_t: DispatchSourceProcess] = [:]

    static var home: String { Env.get("HOME") ?? (NSHomeDirectory() + "/.rally") }
    static var socketPath: String { home + "/pty.sock" }
    /// the app's path first, then each legacy name's (a host started before a rename
    /// whose old directory could not be moved)
    static var socketPaths: [String] { Env.get("HOME") == nil ? [socketPath] + Names.all.dropFirst().map { NSHomeDirectory() + "/." + $0 + "/pty.sock" } : [socketPath] }
    var hosted: Bool { lock.lock(); defer { lock.unlock() }; return fd >= 0 }

    /// RALLY_BIN_CLAUDE when it is an executable file, else `claude` from the login shell's PATH
    static var claudeBin: String {
        if let b = Env.get("BIN_CLAUDE"), b.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: b), !b.contains("'") { return "'" + b + "'" }
        return "claude"
    }
    static var agyBin: String {
        if let b = Env.get("BIN_ANTIGRAVITY"), b.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: b), !b.contains("'") { return "'" + b + "'" }
        return "agy"
    }
    static var codexBin: String {
        if let b = Env.get("BIN_CODEX"), b.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: b), !b.contains("'") { return "'" + b + "'" }
        return "codex"
    }
    /// Ids are checked here because they end up in a shell command line.
    static func command(kind: String, session: String, shell: String, mode: String = "") -> ([String], String?) {
        // under the selftest only the stand-in binaries run, never the user's real claude
        if Env.get("SELFTEST") != nil, kind != "shell", claudeBin == "claude" { return ([], "selftest: RALLY_BIN_CLAUDE is not an executable file") }
        if Env.get("SELFTEST") != nil, kind == "codex", codexBin == "codex" { return ([], "selftest: RALLY_BIN_CODEX is not an executable file") }
        if Env.get("SELFTEST") != nil, kind == "agy", agyBin == "agy" { return ([], "selftest: RALLY_BIN_ANTIGRAVITY is not an executable file") }
        switch kind {
        case "shell":
            return ([shell, "-il"], nil)
        case "attach":
            guard session.range(of: "^[0-9a-f]{6,12}$", options: .regularExpression) != nil else { return ([], L("セッションIDが不正です", "Invalid session id")) }
            return ([shell, "-ilc", "exec \(claudeBin) attach \(session)"], nil)
        case "resume":
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return ([], L("セッションIDが不正です", "Invalid session id")) }
            // a mode the Shift+Tab cycle does not reach (auto) must be given at start
            let m = ["auto", "acceptEdits", "plan", "manual"].contains(mode) ? " --permission-mode \(mode)" : ""
            return ([shell, "-ilc", "exec \(claudeBin) --resume \(session)\(m)"], nil)
        case "agy":
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return ([], L("セッションIDが不正です", "Invalid session id")) }
            // "go": continue a headless run that stopped on a permission; the words are fixed
            // so nothing from the page reaches the command line
            let go = mode == "go" ? " -i '許可が必要で止まった操作から続けてください'" : ""
            return ([shell, "-ilc", "exec \(agyBin) --conversation \(session)\(go)"], nil)
        // codex exec cannot be attached to while it runs: only a stopped session resumes
        case "codex":
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return ([], L("セッションIDが不正です", "Invalid session id")) }
            return ([shell, "-ilc", "exec \(codexBin) resume \(session)"], nil)
        default:
            return ([], L("開けない種類です", "Cannot open this kind"))
        }
    }

    /// The app's environment minus Claude Code's session markers: an app launched from
    /// inside a session would pass them on, and a claude in the terminal would take itself
    /// for that session's child and not save its transcript.
    static func childEnv(_ extra: [String: String]) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        for k in env.keys where k == "CLAUDECODE" || k.hasPrefix("CLAUDE_CODE_") || k == "CLAUDE_JOB_DIR" || k.hasPrefix("CLAUDE_SESSION") { env.removeValue(forKey: k) }
        if env["BROWSER"] == "true" { env.removeValue(forKey: "BROWSER") }   // Claude Code's: no browser would ever open
        for (k, v) in extra { env[k] = v }
        return env
    }

    // MARK: the host

    /// Connects to the host, starting it if need be (spawn: false only looks); falls back
    /// to in-process. startWait is long because the first exec of a freshly built or
    /// copied rally-ptyd waits on macOS's signature check (seconds under load).
    static let wait: TimeInterval = 2
    static let startWait: TimeInterval = 6
    static let restartPause: TimeInterval = 2
    @discardableResult
    func connect(spawn: Bool = true) -> Bool {
        if hosted { return true }
        if local != nil { return false }
        if Env.get("PTY_INPROCESS") == "1" { if spawn { useLocal() }; return false }
        var deadline = Date().addingTimeInterval(Self.wait)
        if let s = dial(), adopt(s, until: deadline) { return true }
        guard spawn else { return false }
        let now = Date()
        if startedAt.map({ now.timeIntervalSince($0) >= Self.restartPause }) ?? true {
            startedAt = now; startHost(); deadline = Date().addingTimeInterval(Self.startWait)
        }
        while Date() < deadline { usleep(50_000); if let s = dial(), adopt(s, until: deadline) { return true } }
        log(["ev": "ptyd-unreachable", "sock": Self.socketPath])
        useLocal()
        return false
    }

    private func useLocal() {
        guard local == nil else { return }
        let l = PtyServer()
        l.onData = { [weak self] id, d, _ in self?.send("window.__kanban.ptyData(\(Self.js(id)),'\(d.base64EncodedString())')") }
        l.onExit = { [weak self] id, code in self?.log(["ev": "pty-exit", "id": id, "code": Int(code)]); self?.send("window.__kanban.ptyExit(\(Self.js(id)),\(code))") }
        local = l
        log(["ev": "pty-inprocess"])
    }

    private func dial() -> Int32? {
        for p in Self.socketPaths { if let s = dial(p) { return s } }
        return nil
    }

    private func dial(_ path: String) -> Int32? {
        var a = sockaddr_un()
        a.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: a.sun_path) else { return nil }
        withUnsafeMutableBytes(of: &a.sun_path) { p in for (i, b) in bytes.enumerated() { p[i] = b }; p[bytes.count] = 0 }
        let s = socket(AF_UNIX, SOCK_STREAM, 0)
        if s < 0 { return nil }
        let r = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        if r != 0 { Darwin.close(s); return nil }
        _ = fcntl(s, F_SETFD, FD_CLOEXEC)
        var one: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        return s
    }

    /// Reads the hello before anything else: it names the tabs already running.
    private func adopt(_ s: Int32, until deadline: Date) -> Bool {
        guard writeLine(s, ["op": "hello", "v": 1]) else { Darwin.close(s); return false }
        var buf = Data(), chunk = [UInt8](repeating: 0, count: 65536)
        var pfd = pollfd(fd: s, events: Int16(POLLIN), revents: 0)
        while buf.firstIndex(of: 0x0a) == nil {
            let left = deadline.timeIntervalSinceNow
            if left <= 0 { break }
            if poll(&pfd, 1, Int32(min(200, max(1, left * 1000)))) <= 0 { continue }
            let n = read(s, &chunk, chunk.count)
            if n <= 0 { break }
            buf.append(chunk, count: n)
        }
        guard let nl = buf.firstIndex(of: 0x0a), let m = try? JSONSerialization.jsonObject(with: buf.subdata(in: 0..<nl)) as? [String: Any],
              (m["ev"] as? String) == "hello", (m["v"] as? Int) == 1 else {
            log(["ev": "ptyd-hello-failed"]); Darwin.close(s); return false
        }
        lock.lock()
        fd = s
        inbuf = buf.subdata(in: (nl + 1)..<buf.count)
        for t in (m["tabs"] as? [[String: Any]]) ?? [] { if let id = t["id"] as? String { known[id] = pid_t((t["pid"] as? Int) ?? 0); metas[id] = (t["meta"] as? String) ?? "" } }
        let n = known.count
        lock.unlock()
        let rs = DispatchSource.makeReadSource(fileDescriptor: s, queue: q)
        rs.setEventHandler { [weak self] in self?.readable() }
        src = rs
        rs.resume()
        log(["ev": "ptyd-connected", "host": (m["pid"] as? Int) ?? 0, "tabs": n])
        if !inbuf.isEmpty { q.async { [weak self] in self?.drain() } }
        return true
    }

    /// In its own session (setsid) so the app's quit and signals don't reach it.
    private func startHost() {
        let exe = Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent("rally-ptyd").path ?? ""
        guard FileManager.default.isExecutableFile(atPath: exe) else { log(["ev": "ptyd-missing", "path": exe]); return }
        try? FileManager.default.createDirectory(atPath: Self.home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var attr: posix_spawnattr_t? = nil
        posix_spawnattr_init(&attr)
        // POSIX_SPAWN_SETSID (0x0400): a session, and so a process group, of its own;
        // POSIX_SPAWN_CLOEXEC_DEFAULT (0x4000): none of the app's descriptors go with it
        posix_spawnattr_setflags(&attr, Int16(0x0400 | 0x4000))
        var fa: posix_spawn_file_actions_t? = nil
        posix_spawn_file_actions_init(&fa)
        posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
        let logf = Self.home + "/ptyd.log"
        if let a = try? FileManager.default.attributesOfItem(atPath: logf), ((a[.size] as? Int) ?? 0) > 512_000 { try? FileManager.default.removeItem(atPath: logf) }
        posix_spawn_file_actions_addopen(&fa, 1, logf, O_WRONLY | O_CREAT | O_APPEND, 0o600)
        posix_spawn_file_actions_adddup2(&fa, 1, 2)
        let argv: [UnsafeMutablePointer<CChar>?] = [strdup(exe), strdup(Self.socketPath), nil]
        let envp: [UnsafeMutablePointer<CChar>?] = Self.childEnv([:]).map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { for p in argv { free(p) }; for p in envp { free(p) }; posix_spawn_file_actions_destroy(&fa); posix_spawnattr_destroy(&attr) }
        var pid: pid_t = 0
        let r = posix_spawn(&pid, exe, &fa, &attr, argv, envp)
        log(["ev": "ptyd-start", "pid": Int(pid), "rc": Int(r)])
        if r == 0 && pid > 0 { reapWhenDone(pid) }
    }

    /// setsid gives the host its own session, not another parent: reap it or it stays a zombie.
    private func reapWhenDone(_ pid: pid_t) {
        let ps = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: q)
        let reap: () -> Void = { [weak self] in
            var st: Int32 = 0
            guard waitpid(pid, &st, WNOHANG) == pid else { return }
            self?.hostExits.removeValue(forKey: pid)?.cancel()
            self?.log(["ev": "ptyd-ended", "pid": Int(pid), "status": Int(st)])
        }
        ps.setEventHandler(handler: reap)
        q.async { self.hostExits[pid] = ps; ps.resume(); reap() }   // reap(): it may have ended before the source was there
    }

    private func writeLine(_ s: Int32, _ obj: [String: Any]) -> Bool {
        guard var d = try? JSONSerialization.data(withJSONObject: obj) else { return false }
        d.append(0x0a)
        return d.withUnsafeBytes { p -> Bool in
            var off = 0
            while off < p.count {
                let n = Darwin.write(s, p.baseAddress! + off, p.count - off)
                if n > 0 { off += n; continue }
                if n < 0 && errno == EINTR { continue }
                return false
            }
            return true
        }
    }

    /// To the host, in order (one writer queue).
    private func msg(_ obj: [String: Any]) {
        q.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); let s = self.fd; self.lock.unlock()
            if s >= 0 && !self.writeLine(s, obj) { self.lost() }
        }
    }

    private func readable() {
        lock.lock(); let s = fd; lock.unlock()
        guard s >= 0 else { return }
        var chunk = [UInt8](repeating: 0, count: 262144)
        let n = read(s, &chunk, chunk.count)
        if n > 0 { inbuf.append(chunk, count: n); drain(); return }
        if n < 0 && (errno == EAGAIN || errno == EINTR) { return }
        lost()
    }

    private func drain() {
        while let nl = inbuf.firstIndex(of: 0x0a) {
            let line = inbuf.subdata(in: inbuf.startIndex..<nl)
            inbuf.removeSubrange(inbuf.startIndex...nl)
            guard let m = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            event(m)
        }
    }

    private func event(_ m: [String: Any]) {
        let id = (m["id"] as? String) ?? ""
        switch (m["ev"] as? String) ?? "" {
        case "data":
            let b64 = (m["b64"] as? String) ?? ""
            send("window.__kanban.ptyData(\(Self.js(id)),'\(b64)'\((m["replay"] as? Bool) == true ? ",1" : ""))")
        case "opened":
            lock.lock(); known[id] = pid_t((m["pid"] as? Int) ?? 0); lock.unlock()
            log(["ev": "pty-open", "id": id, "pid": (m["pid"] as? Int) ?? 0, "host": true])
        case "exit":
            lock.lock(); known[id] = nil; metas[id] = nil; lock.unlock()
            let code = (m["code"] as? Int) ?? -1
            log(["ev": "pty-exit", "id": id, "code": code])
            if let e = m["err"] as? String { send("window.__kanban.ptyExit(\(Self.js(id)),\(code),\(Self.js(e)))") }
            else { send("window.__kanban.ptyExit(\(Self.js(id)),\(code))") }
        case "list":
            let tabs = (m["tabs"] as? [[String: Any]]) ?? []
            lock.lock()
            for t in tabs { if let i = t["id"] as? String { known[i] = pid_t((t["pid"] as? Int) ?? 0); metas[i] = (t["meta"] as? String) ?? "" } }
            let w = listWaiters; listWaiters = []
            lock.unlock()
            for f in w { f(tabs) }
        case "closedall":
            lock.lock(); let s = closedAll; closedAll = nil; lock.unlock()
            s?.signal()
        default:
            break
        }
    }

    private func lost() {
        lock.lock()
        let was = fd
        fd = -1
        let ids = Array(known.keys)
        known.removeAll(); metas.removeAll()
        let w = listWaiters; listWaiters = []
        lock.unlock()
        guard was >= 0 else { return }
        src?.cancel(); src = nil
        Darwin.close(was)
        inbuf.removeAll()
        log(["ev": "ptyd-lost", "tabs": ids.count])
        for id in ids { send("window.__kanban.ptyExit(\(Self.js(id)),-1,\(Self.js(L("端末のホスト (rally-ptyd) との接続が切れました", "Lost the connection to the terminal host (rally-ptyd)"))))") }
        for f in w { f([]) }
    }

    // MARK: what main.swift calls

    /// The tab a process runs in, walking up its parents (a `claude` typed into a shell tab).
    func owner(of pid: pid_t) -> String? {
        var byPid: [pid_t: String] = [:]
        if let l = local { for (id, p) in l.pids() { byPid[p] = id } }
        lock.lock(); for (id, p) in known where p > 0 { byPid[p] = id }; lock.unlock()
        var p = pid
        for _ in 0..<32 {
            if let id = byPid[p] { return id }
            var info = kinfo_proc(); var size = MemoryLayout<kinfo_proc>.stride
            var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, p]
            if sysctl(&mib, 4, &info, &size, nil, 0) != 0 || size == 0 { return nil }
            p = info.kp_eproc.e_ppid
            if p <= 1 { return nil }
        }
        return nil
    }

    /// A host-side failure comes back as ptyExit with an error.
    func open(id: String, argv: [String], cwd: String, cols: Int, rows: Int, env extra: [String: String], meta: String = "") -> String? {
        let env = Self.childEnv(extra)
        if connect(), hosted {
            lock.lock(); let exists = known[id] != nil; if !exists { known[id] = 0; metas[id] = meta }; lock.unlock()
            if exists { return L("同じ端末がもう開いています", "That terminal is already open") }
            msg(["op": "open", "id": id, "argv": argv, "cwd": cwd, "env": env, "cols": cols, "rows": rows, "meta": meta])
            return nil
        }
        guard let l = local else { return L("端末を作れませんでした", "Could not create the terminal") }
        let r = l.open(id: id, argv: argv, cwd: cwd, env: env, cols: cols, rows: rows, meta: meta)
        if r.error == nil { log(["ev": "pty-open", "id": id, "pid": Int(r.pid), "cmd": argv.joined(separator: " ")]) }
        return r.error
    }

    func write(id: String, data: String) {
        if let l = local { l.write(id: id, data: Data(data.utf8)); return }
        msg(["op": "in", "id": id, "b64": Data(data.utf8).base64EncodedString()])
    }

    func resize(id: String, cols: Int, rows: Int, redraw: Bool = false) {
        guard cols > 0, rows > 0 else { return }
        if let l = local { l.resize(id: id, cols: cols, rows: rows, redraw: redraw); return }
        msg(["op": "size", "id": id, "cols": cols, "rows": rows, "redraw": redraw])
    }

    func close(id: String) {
        if let l = local { l.close(id: id); return }
        msg(["op": "close", "id": id])
    }

    /// The page's notes on a tab, kept for the next launch.
    func setMeta(id: String, meta: String) {
        if let l = local { l.setMeta(id: id, meta: meta); return }
        lock.lock(); let have = known[id] != nil; if have { metas[id] = meta }; lock.unlock()
        if have { msg(["op": "meta", "id": id, "meta": meta]) }
    }

    /// [{id, pid, meta, cols, rows}]
    func list(_ done: @escaping ([[String: Any]]) -> Void) {
        if let l = local { done(l.list()); return }
        guard connect(spawn: false), hosted else { done([]); return }
        lock.lock(); listWaiters.append(done); lock.unlock()
        msg(["op": "list"])
    }

    func replay(id: String, cols: Int, rows: Int) {
        if let l = local {
            if let d = l.replay(id: id) { send("window.__kanban.ptyData(\(Self.js(id)),'\(d.base64EncodedString())',1)") }
            l.resize(id: id, cols: cols, rows: rows, redraw: true); return
        }
        msg(["op": "replay", "id": id])
        if cols > 0 && rows > 0 { msg(["op": "size", "id": id, "cols": cols, "rows": rows, "redraw": true]) }
    }

    func closeAll() {
        if let l = local { l.closeAll(); return }
        guard hosted else { return }
        let sem = DispatchSemaphore(value: 0)
        lock.lock(); closedAll = sem; lock.unlock()
        msg(["op": "closeall"])
        _ = sem.wait(timeout: .now() + 2)
    }

    /// On quit with a host: the terminals keep running.
    func detach() {
        lock.lock(); let s = fd; fd = -1; lock.unlock()
        guard s >= 0 else { return }
        q.sync { src?.cancel(); src = nil }
        Darwin.close(s)
    }

    /// Claude sessions held in-process (they end with the app), to ask before quitting.
    func localSessions() -> [String] {
        guard let l = local else { return [] }
        return l.list().compactMap { t in
            guard let m = t["meta"] as? String, let d = try? JSONSerialization.jsonObject(with: Data(m.utf8)) as? [String: Any] else { return nil }
            return (d["kind"] as? String) == "resume" ? ((d["label"] as? String) ?? "claude") : nil
        }
    }

    var count: Int {
        if let l = local { return l.count }
        lock.lock(); defer { lock.unlock() }; return known.count
    }

    static func js(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), let j = String(data: d, encoding: .utf8) else { return "''" }
        return String(j.dropFirst().dropLast())
    }
}
