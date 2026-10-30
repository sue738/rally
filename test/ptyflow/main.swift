// test/ptyflow/main.swift — compiled with app/Sources/PtyCore/PtyServer.swift by test/test.js (when swiftc is there).
// Flow control and replay: a tab under flowLimit whose output is replayed (a board coming back)
// must go on being read. `yes` writes without pause; the host reports each piece sent at once,
// as ptyd does. After each replay, output past it has to come. Exit 2: it stopped for good.
// Not a gap in the output: on a loaded machine (this is -Onone) reading goes quiet for a few
// hundred ms with no replay at all, while a tab paused for good never gives another byte.
import Foundation
let rounds = Int(CommandLine.arguments.dropFirst().first ?? "") ?? 100
let s = PtyServer()
s.flowLimit = 1 << 20
let q = DispatchQueue(label: "host")
let lk = NSLock()
var reached = 0 // the offset just past the latest output handed over
s.onData = { id, d, upTo in q.async { lk.lock(); reached = max(reached, upTo); lk.unlock(); s.sent(id: id, bytes: d.count) } }
let r = s.open(id: "t", argv: ["/usr/bin/yes", String(repeating: "y", count: 200)], cwd: "/tmp", env: ["PATH": "/usr/bin:/bin"], cols: 80, rows: 24, meta: "")
if let e = r.error { print("open failed: \(e)"); exit(1) }
var stalled = -1
for i in 0..<rounds {
    usleep(UInt32.random(in: 0...20000))
    let upTo = s.replayUpTo(id: "t")?.upTo ?? 0
    usleep(50_000)
    var waited = 0
    while waited < 5000 {
        lk.lock(); let got = reached; lk.unlock()
        if got > upTo { break }
        usleep(10_000); waited += 10
    }
    if waited >= 5000 { stalled = i; break }
}
s.closeAll()
print(stalled < 0 ? "ok: read on after \(rounds) replays" : "stalled after replay \(stalled)")
exit(stalled < 0 ? 0 : 2)
