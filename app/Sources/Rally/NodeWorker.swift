import Foundation

/// A long-lived `rally worker` (bin/rally.js): the app's `state` and `history` without a new Node process each time. Scanning
/// keeps its cache in memory there and its list of transcripts up to date from file-system events (lib/scan.js), which is most
/// of a refresh's CPU. Nothing depends on it: `run` answers nil whenever the worker is not there, is still warming up, or does
/// not answer in time, and the caller runs the command as a process, as before.
///
/// Protocol: a line of JSON on its stdin, {"id": n, "argv": [...]}; an answer line "<id> <exit code> <output>" on its stdout.
final class NodeWorker {
    private let node: String
    private let script: String
    private let lock = NSLock()
    private var proc: Process?
    private var input: FileHandle?
    private var buf = Data()
    private var waiting: [Int: DispatchSemaphore] = [:]
    private var answers: [Int: (String, Int32)] = [:]
    private var nextId = 0
    private var ready = false                      // answered its first request: from then on it is used
    private var started: [Date] = []               // starts in the last minute: a worker that keeps dying is given up on
    private var givenUp = false
    var log: (([String: Any]) -> Void)?

    init(node: String, script: String) {
        self.node = node
        self.script = script
    }

    /// The command's output and exit code, or nil (use a process).
    func run(_ args: [String], timeout: TimeInterval) -> (String, Int32)? {
        lock.lock()
        if givenUp { lock.unlock(); return nil }
        if proc == nil || proc?.isRunning != true {
            if !startLocked() { lock.unlock(); return nil }
        }
        // a worker that has not answered yet is warming up: its first answer is slower than a process's (cold caches)
        if !ready { lock.unlock(); return nil }
        let r = sendLocked(args, timeout: timeout)
        return r
    }

    // lock held on entry; released here
    private func sendLocked(_ args: [String], timeout: TimeInterval) -> (String, Int32)? {
        nextId += 1
        let id = nextId
        let sem = DispatchSemaphore(value: 0)
        waiting[id] = sem
        let req: [String: Any] = ["id": id, "argv": args]
        guard let d = try? JSONSerialization.data(withJSONObject: req), let h = input else { waiting[id] = nil; lock.unlock(); return nil }
        do { try h.write(contentsOf: d + Data([0x0a])) } catch { waiting[id] = nil; stopLocked(); lock.unlock(); return nil }
        lock.unlock()
        if sem.wait(timeout: .now() + timeout) == .timedOut {
            lock.lock(); waiting[id] = nil; answers[id] = nil; stopLocked(); lock.unlock()
            log?(["ev": "worker-timeout", "cmd": args.first ?? "", "s": Int(timeout)])
            return nil
        }
        lock.lock(); let a = answers.removeValue(forKey: id); lock.unlock()
        return a
    }

    /// Starts it and asks for one state in the background, so it is warm before the first real use.
    private func startLocked() -> Bool {
        let now = Date()
        started = started.filter { now.timeIntervalSince($0) < 60 }
        if started.count >= 3 { givenUp = true; log?(["ev": "worker-given-up"]); return false }
        started.append(now)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        // a small young generation: the same work with less garbage kept around
        p.arguments = ["--max-semi-space-size=4", script, "worker"]
        let inp = Pipe(), out = Pipe()
        p.standardInput = inp
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        buf = Data()
        ready = false
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self = self else { return }
            if d.isEmpty { h.readabilityHandler = nil; self.ended(); return }
            self.feed(d)
        }
        p.terminationHandler = { [weak self] _ in self?.ended() }
        do { try p.run() } catch { log?(["ev": "worker-start-failed", "err": String(describing: error)]); return false }
        proc = p
        input = inp.fileHandleForWriting
        log?(["ev": "worker-start", "pid": Int(p.processIdentifier)])
        // the warm-up: a state, not waited for here (its answer marks the worker ready)
        nextId += 1
        let id = nextId
        let req: [String: Any] = ["id": id, "argv": ["state", "--hours", "24"]]
        if let d = try? JSONSerialization.data(withJSONObject: req) { try? input?.write(contentsOf: d + Data([0x0a])) }
        warmId = id
        return true
    }
    private var warmId = -1

    private func feed(_ d: Data) {
        lock.lock()
        buf.append(d)
        while let nl = buf.firstIndex(of: 0x0a) {
            let line = buf.subdata(in: buf.startIndex..<nl)
            buf.removeSubrange(buf.startIndex...nl)
            // "<id> <code> <output>"
            guard let s1 = line.firstIndex(of: 0x20), let s2 = line[(s1 + 1)...].firstIndex(of: 0x20),
                  let id = Int(String(decoding: line[line.startIndex..<s1], as: UTF8.self)),
                  let code = Int32(String(decoding: line[(s1 + 1)..<s2], as: UTF8.self)) else { continue }
            let out = String(decoding: line[(s2 + 1)...], as: UTF8.self)
            if id == warmId { ready = (code == 0); warmId = -1; continue }
            answers[id] = (out, code)
            waiting.removeValue(forKey: id)?.signal()
        }
        lock.unlock()
    }

    /// The process is gone: everyone waiting is let go with no answer (they run a process instead).
    private func ended() {
        lock.lock()
        ready = false
        proc = nil
        input = nil
        let all = waiting
        waiting = [:]
        lock.unlock()
        for (_, s) in all { s.signal() }
    }

    private func stopLocked() {
        let p = proc
        proc = nil
        input = nil
        ready = false
        if let p = p, p.isRunning { p.terminate() }
        let all = waiting
        waiting = [:]
        for (_, s) in all { s.signal() }
    }

    func stop() { lock.lock(); stopLocked(); lock.unlock() }
}
