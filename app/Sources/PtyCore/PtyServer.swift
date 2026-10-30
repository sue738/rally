// A pty per tab, its child, and the last RING_MAX bytes it printed. Used by the
// detached host (rally-ptyd) and, when that can't start, in-process by the app.
// replay() redraws a screen for a board that comes back, led by the DEC modes
// the program set, which may have scrolled out of the ring.
import Foundation
import Darwin

public final class PtyServer {
    final class Tab {
        let id: String
        let pid: pid_t
        let fd: Int32
        var source: DispatchSourceRead?
        var pending = Data()
        var flushScheduled = false
        var meta: String
        var cols: Int
        var rows: Int
        var ring = Data()   // newest RING_MAX bytes; `total` counts every byte ever
        var total = 0
        var modes = ModeScan()
        /// Set by finish() on the pty queue: fd and pid may now belong to someone
        /// else, so anything touching them checks this on that queue.
        var closed = false
        /// bytes handed to onData not yet reported by sent(), and whether reading is paused
        var unsent = 0
        var paused = false
        init(id: String, pid: pid_t, fd: Int32, meta: String, cols: Int, rows: Int) { self.id = id; self.pid = pid; self.fd = fd; self.meta = meta; self.cols = cols; self.rows = rows }
    }
    public static let RING_MAX = 1 << 20
    private var tabs: [String: Tab] = [:]
    private let lock = NSLock()
    private let io = DispatchQueue(label: "rally.pty")
    /// output batched per frame, on the pty queue, with the `total` offset just past it
    public var onData: ((String, Data, Int) -> Void)?
    /// a tab's child ended (its exit code, or 128+signal, or -1), on the pty queue
    public var onExit: ((String, Int32) -> Void)?
    /// Flow control for a host whose onData only queues (ptyd): past this many
    /// unsent bytes the tab isn't read until a quarter remains, so the program
    /// blocks on write instead of the queue growing without bound. nil: no limit.
    public var flowLimit: Int?
    public init() {}

    /// TIOCSWINSZ, _IOW('t', 103, struct winsize): the macro does not reach Swift.
    private static let setWinSize = UInt(0x80087467)

    /// Everything is built before the fork: the child only calls async-signal-safe
    /// sigaction/sigprocmask/chdir/execve/_exit. `env` is the whole environment.
    public func open(id: String, argv: [String], cwd: String, env: [String: String], cols: Int, rows: Int, meta: String) -> (pid: pid_t, error: String?) {
        guard !argv.isEmpty else { return (0, "開けない種類です") }
        lock.lock(); let exists = tabs[id] != nil; lock.unlock()
        if exists { return (0, "同じ端末がもう開いています") }
        let cArgv: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) } + [nil]
        let cEnv: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
        let cDir = strdup(FileManager.default.fileExists(atPath: cwd) ? cwd : NSHomeDirectory())
        let cPath = strdup(argv[0])
        defer {
            for p in cArgv { free(p) }; for p in cEnv { free(p) }
            free(cDir); free(cPath)
        }
        let r = max(4, min(rows, 500)), c = max(10, min(cols, 1000))
        var ws = winsize(ws_row: UInt16(r), ws_col: UInt16(c), ws_xpixel: 0, ws_ypixel: 0)
        // Reset dispositions and mask: the host ignores SIGHUP/SIGTERM/SIGPIPE, and
        // ignored signals survive execve, so a closed tab's jobs would outlive SIGHUP.
        var dfl = sigaction()
        dfl.__sigaction_u.__sa_handler = SIG_DFL
        var none = sigset_t()
        sigemptyset(&none)
        var fd: Int32 = -1
        let pid = forkpty(&fd, nil, nil, &ws)
        if pid < 0 { return (0, "端末を作れませんでした (errno \(errno))") }
        if pid == 0 {
            var s: Int32 = 1
            while s < NSIG { _ = sigaction(s, &dfl, nil); s += 1 }
            _ = sigprocmask(SIG_SETMASK, &none, nil)
            _ = chdir(cDir)
            execve(cPath, cArgv, cEnv)
            _exit(127)
        }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        let tab = Tab(id: id, pid: pid, fd: fd, meta: meta, cols: c, rows: r)
        let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: io)
        src.setEventHandler { [weak self] in self?.readable(tab) }
        tab.source = src
        lock.lock(); tabs[id] = tab; lock.unlock()
        src.resume()
        return (pid, nil)
    }

    private func readable(_ tab: Tab) {
        var buf = [UInt8](repeating: 0, count: 65536)
        var ended = false
        var got = 0
        while got < 1 << 20 {
            let n = read(tab.fd, &buf, buf.count)
            if n > 0 {
                got += n
                tab.pending.append(buf, count: n)
                tab.modes.scan(buf, n, at: tab.total)
                tab.ring.append(buf, count: n); tab.total += n
                // a copy, not removeFirst: that leaves startIndex past 0 and replay's subdata traps
                if tab.ring.count > Self.RING_MAX + 65536 { tab.ring = Data(tab.ring.suffix(Self.RING_MAX)) }
                continue
            }
            // EIO once the child side is gone; EAGAIN when drained
            if n == 0 || (n < 0 && errno != EAGAIN && errno != EINTR) { ended = true }
            break
        }
        // one message per frame, not per read (a TUI redraw is thousands of reads)
        if !tab.pending.isEmpty && !tab.flushScheduled {
            tab.flushScheduled = true
            io.asyncAfter(deadline: .now() + .milliseconds(12)) { [weak self] in self?.flush(tab) }
        }
        if ended { finish(tab); return }
        if let lim = flowLimit, !tab.paused, tab.unsent + tab.pending.count > lim {
            tab.paused = true; tab.source?.suspend()
        }
    }

    /// onData's bytes have gone out (flowLimit).
    public func sent(id: String, bytes: Int) {
        guard let tab = tab(id), let lim = flowLimit else { return }
        io.async {
            tab.unsent = max(0, tab.unsent - bytes)
            if tab.paused && !tab.closed && tab.unsent + tab.pending.count <= lim / 4 {
                tab.paused = false; tab.source?.resume()
            }
        }
    }

    private func flush(_ tab: Tab) {
        tab.flushScheduled = false
        guard !tab.pending.isEmpty else { return }
        let d = tab.pending
        tab.pending.removeAll(keepingCapacity: true)
        if flowLimit != nil { tab.unsent += d.count }
        onData?(tab.id, d, tab.total)
    }

    private func finish(_ tab: Tab) {
        tab.source?.cancel(); tab.source = nil
        flush(tab)
        var status: Int32 = 0
        // the child may still be on its way out after the pty closed
        var reaped = waitpid(tab.pid, &status, WNOHANG)
        for _ in 0..<20 where reaped == 0 { usleep(50_000); reaped = waitpid(tab.pid, &status, WNOHANG) }
        tab.closed = true
        Darwin.close(tab.fd)
        lock.lock(); tabs[tab.id] = nil; lock.unlock()
        let code: Int32 = reaped == tab.pid ? ((status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)) : -1
        onExit?(tab.id, code)
    }

    private func tab(_ id: String) -> Tab? { lock.lock(); defer { lock.unlock() }; return tabs[id] }

    public func write(id: String, data: Data) {
        guard let tab = tab(id), !data.isEmpty else { return }
        let bytes = [UInt8](data)
        io.async {
            var off = 0
            var tries = 0
            while !tab.closed && off < bytes.count && tries < 200 {
                let n = bytes[off...].withUnsafeBufferPointer { Darwin.write(tab.fd, $0.baseAddress, $0.count) }
                if n > 0 { off += n; continue }
                if n < 0 && (errno == EAGAIN || errno == EINTR) { tries += 1; usleep(5_000); continue }
                break
            }
        }
    }

    /// redraw: an unchanged size sends no SIGWINCH, so go one row less first.
    public func resize(id: String, cols: Int, rows: Int, redraw: Bool = false) {
        guard let tab = tab(id), cols > 0, rows > 0 else { return }
        let r = min(rows, 500), c = min(cols, 1000)
        io.async {
            guard !tab.closed else { return }
            tab.cols = c; tab.rows = r
            if redraw && r > 4 {
                var w0 = winsize(ws_row: UInt16(r - 1), ws_col: UInt16(c), ws_xpixel: 0, ws_ypixel: 0)
                _ = ioctl(tab.fd, Self.setWinSize, &w0)
                self.io.asyncAfter(deadline: .now() + .milliseconds(80)) {
                    guard !tab.closed else { return }
                    var w = winsize(ws_row: UInt16(tab.rows), ws_col: UInt16(tab.cols), ws_xpixel: 0, ws_ypixel: 0)
                    _ = ioctl(tab.fd, Self.setWinSize, &w)
                }
                return
            }
            var ws = winsize(ws_row: UInt16(r), ws_col: UInt16(c), ws_xpixel: 0, ws_ypixel: 0)
            _ = ioctl(tab.fd, Self.setWinSize, &ws)
        }
    }

    /// SIGHUP; the read source then sees the end and reports it.
    public func close(id: String) {
        guard let tab = tab(id) else { return }
        // by pid only before finish() reaps it: after that the pid may be reused
        io.async { if !tab.closed { kill(tab.pid, SIGHUP) } }
        io.asyncAfter(deadline: .now() + 2) { if !tab.closed && kill(tab.pid, 0) == 0 { kill(tab.pid, SIGKILL) } }
    }

    public func closeAll() {
        lock.lock(); let all = Array(tabs.values); lock.unlock()
        for t in all { kill(t.pid, SIGHUP) }
        if all.isEmpty { return }
        usleep(300_000)
        io.sync { for t in all where !t.closed && kill(t.pid, 0) == 0 { kill(t.pid, SIGKILL) } }
    }

    public func setMeta(id: String, meta: String) { tab(id)?.meta = meta }

    public func list() -> [[String: Any]] {
        lock.lock(); let all = Array(tabs.values); lock.unlock()
        return all.sorted { $0.id < $1.id }.map { ["id": $0.id, "pid": Int($0.pid), "meta": $0.meta, "cols": $0.cols, "rows": $0.rows] }
    }

    public func pids() -> [String: pid_t] {
        lock.lock(); defer { lock.unlock() }
        return Dictionary(uniqueKeysWithValues: tabs.values.map { ($0.id, $0.pid) })
    }

    /// Modes in force, then the ring, and its end offset. Pending bytes are
    /// included (and dropped from the queue); bytes already in flight are told apart by the offset.
    public func replay(id: String) -> Data? { replayUpTo(id: id)?.data }

    public func replayUpTo(id: String) -> (data: Data, upTo: Int)? {
        guard let tab = tab(id) else { return nil }
        return io.sync {
            tab.pending.removeAll(keepingCapacity: true)
            // pending bytes never reach onData now, so no sent() will resume a tab paused on them
            if let lim = self.flowLimit, tab.paused, !tab.closed, tab.unsent <= lim / 4 {
                tab.paused = false; tab.source?.resume()
            }
            let first = tab.total - tab.ring.count
            var start = first
            // on the alternate screen: only what was drawn there since it was entered
            if let alt = tab.modes.altFrom, alt > first { start = alt }
            var out = Data(tab.modes.prefix().utf8)
            out.append(tab.ring[(tab.ring.startIndex + (start - first))...])
            return (out, tab.total)
        }
    }

    public var count: Int { lock.lock(); defer { lock.unlock() }; return tabs.count }
}

/// The DEC private modes a program sets (ESC [ ? n h / l), followed across
/// reads, so a replay can restore the ones that scrolled out of the ring.
struct ModeScan {
    private var state = 0          // 0 text, 1 ESC, 2 ESC [, 3 ESC [ ? params
    private var num = 0
    private var nums: [Int] = []
    private(set) var on: [Int: Bool] = [:]
    /// the byte (in `total` terms) after the latest switch to the alternate screen, while it is on
    private(set) var altFrom: Int?
    static let kept: [Int] = [1, 7, 12, 25, 47, 66, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1047, 1049, 2004]

    mutating func scan(_ b: [UInt8], _ n: Int, at base: Int) {
        for i in 0..<n {
            let c = b[i]
            switch state {
            case 0: if c == 0x1b { state = 1 }
            case 1: state = c == 0x5b ? 2 : (c == 0x1b ? 1 : 0)
            case 2: if c == 0x3f { state = 3; num = 0; nums = [] } else { state = c == 0x1b ? 1 : 0 }
            default:
                if c >= 0x30 && c <= 0x39 { num = min(num * 10 + Int(c - 0x30), 100000) }
                else if c == 0x3b { nums.append(num); num = 0 }
                else if c == 0x68 || c == 0x6c {
                    nums.append(num)
                    let set = c == 0x68
                    for m in nums where Self.kept.contains(m) {
                        on[m] = set
                        if m == 1049 || m == 1047 || m == 47 { altFrom = set ? base + i + 1 : nil }
                    }
                    state = 0
                } else { state = c == 0x1b ? 1 : 0 }
            }
        }
    }

    func prefix() -> String {
        var s = ""
        // the alternate screen first: the modes after it apply there
        if altFrom != nil { s += "\u{1b}[?1049h\u{1b}[H\u{1b}[2J" }
        for m in Self.kept.sorted() where m != 1049 && m != 1047 && m != 47 {
            guard let v = on[m] else { continue }
            s += "\u{1b}[?\(m)\(v ? "h" : "l")"
        }
        return s
    }
}
