import Cocoa
import CoreServices

/// Watches transcripts (FSEvents, file-level) and tells the page which files moved, so a card
/// that starts working leaves Your Turn at once instead of at the next 30 s refresh (filesMoved).
private var transcriptStream: FSEventStreamRef?
private var movedNames = Set<String>()
private var movedTimer: Timer?

extension AppDelegate {
    func watchTranscripts() {
        if transcriptStream != nil { return }
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let ak = Env.get("HOME") ?? (home + "/.rally")
        let dirs = [home + "/.claude/projects", home + "/.codex/sessions", ak + "/antigravity"].filter { FileManager.default.fileExists(atPath: $0) }
        guard !dirs.isEmpty else { return }
        var ctx = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let cb: FSEventStreamCallback = { _, info, n, paths, _, _ in
            guard let info = info else { return }
            let me = Unmanaged<AppDelegate>.fromOpaque(info).takeUnretainedValue()
            let ps = unsafeBitCast(paths, to: NSArray.self) as? [String] ?? []
            for p in ps.prefix(n) where p.hasSuffix(".jsonl") || p.hasSuffix(".log") { movedNames.insert((p as NSString).lastPathComponent) }
            me.flushMoved()
        }
        let flags = UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagUseCFTypes)
        guard let s = FSEventStreamCreate(nil, cb, &ctx, dirs as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags) else { return }
        FSEventStreamSetDispatchQueue(s, DispatchQueue.main)
        FSEventStreamStart(s)
        transcriptStream = s
    }
    /// at most one message a second
    func flushMoved() {
        if movedTimer != nil || movedNames.isEmpty { return }
        movedTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in
            movedTimer = nil
            let names = Array(movedNames.prefix(200)); movedNames.removeAll()
            guard let data = try? JSONSerialization.data(withJSONObject: names), let js = String(data: data, encoding: .utf8) else { return }
            self?.call("window.__kanban.filesMoved&&window.__kanban.filesMoved(\(js))")
        }
    }
}
