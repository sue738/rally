// rally-ptyd <socket> — owns the app's terminals so they survive a quit or an update.
// Started detached (setsid); talks over a 0600 unix socket to same-uid peers only,
// one app at a time (a new connection replaces the old). Exits when idle with no
// app, or at once if its socket is removed or replaced (a selftest's scratch home).
// Protocol: one JSON object per line, both ways (v1).
//   app → host  {op:hello,v} {op:list} {op:open,id,argv,cwd,env,cols,rows,meta}
//               {op:in,id,b64} {op:size,id,cols,rows,redraw} {op:close,id}
//               {op:closeall} {op:meta,id,meta} {op:replay,id}
//   host → app  {ev:hello,v,pid,tabs} {ev:list,tabs} {ev:opened,id,pid}
//               {ev:data,id,b64[,replay]} {ev:exit,id,code[,err]} {ev:closedall}
import Foundation
import Darwin
import PtyCore

let VERSION = 1
let args = CommandLine.arguments
guard args.count >= 2, args[1].hasPrefix("/") else { FileHandle.standardError.write("usage: rally-ptyd <socket>\n".data(using: .utf8)!); exit(2) }
let sockPath = args[1]
signal(SIGPIPE, SIG_IGN)
signal(SIGHUP, SIG_IGN)
umask(0o077)

func say(_ s: String) {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    FileHandle.standardError.write("\(f.string(from: Date())) ptyd[\(getpid())] \(s)\n".data(using: .utf8)!)
}

func sockaddrFor(_ path: String) -> sockaddr_un? {
    var a = sockaddr_un()
    a.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: a.sun_path) else { return nil }
    withUnsafeMutableBytes(of: &a.sun_path) { p in for (i, b) in bytes.enumerated() { p[i] = b }; p[bytes.count] = 0 }
    return a
}

func answering(_ path: String) -> Bool {
    guard var a = sockaddrFor(path) else { return false }
    let s = socket(AF_UNIX, SOCK_STREAM, 0); if s < 0 { return false }
    defer { close(s) }
    return withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } } == 0
}
if answering(sockPath) { say("another host answers on \(sockPath)"); exit(0) }
unlink(sockPath)
guard var addr = sockaddrFor(sockPath) else { say("socket path too long"); exit(2) }
let lfd = socket(AF_UNIX, SOCK_STREAM, 0)
guard lfd >= 0 else { say("socket: \(errno)"); exit(1) }
_ = fcntl(lfd, F_SETFD, FD_CLOEXEC)
let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(lfd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
guard bound == 0 else { say("bind: \(errno)"); exit(1) }
chmod(sockPath, 0o600)
guard listen(lfd, 4) == 0 else { say("listen: \(errno)"); exit(1) }
var st = stat()
stat(sockPath, &st)
let sockIno = st.st_ino
say("listening on \(sockPath)")

let server = PtyServer()
let q = DispatchQueue(label: "rally.ptyd")
var client: Int32 = -1
var clientSrc: DispatchSourceRead?
var inbuf = Data()
var lastClient = Date()
/// per tab, the offset a replay reached: queued data before it was already replayed
var replayedTo: [String: Int] = [:]

func emit(_ obj: [String: Any]) {
    guard client >= 0, var d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    d.append(0x0a)
    let ok = d.withUnsafeBytes { p -> Bool in
        var off = 0
        while off < p.count {
            let n = Darwin.write(client, p.baseAddress! + off, p.count - off)
            if n > 0 { off += n; continue }
            if n < 0 && errno == EINTR { continue }
            return false
        }
        return true
    }
    if !ok { say("write to the app failed (\(errno)): dropped"); dropClient() }
}

func dropClient() {
    clientSrc?.cancel(); clientSrc = nil
    if client >= 0 { close(client) }
    client = -1; inbuf.removeAll(); lastClient = Date()
}

// bound what queues here for the app
server.flowLimit = 1 << 20
server.onData = { id, data, end in q.async {
    defer { server.sent(id: id, bytes: data.count) }
    var d = data
    if let upTo = replayedTo[id] {
        if end <= upTo { return }
        replayedTo[id] = nil
        let start = end - d.count
        if start < upTo { d = d.subdata(in: (d.startIndex + (upTo - start))..<d.endIndex) }
    }
    emit(["ev": "data", "id": id, "b64": d.base64EncodedString()])
} }
server.onExit = { id, code in q.async { say("exit \(id) \(code)"); replayedTo[id] = nil; emit(["ev": "exit", "id": id, "code": Int(code)]) } }

func handle(_ m: [String: Any]) {
    let id = (m["id"] as? String) ?? ""
    switch (m["op"] as? String) ?? "" {
    case "hello":
        emit(["ev": "hello", "v": VERSION, "pid": Int(getpid()), "tabs": server.list()])
    case "list":
        emit(["ev": "list", "tabs": server.list()])
    case "open":
        let argv = (m["argv"] as? [String]) ?? []
        let env = (m["env"] as? [String: String]) ?? [:]
        let r = server.open(id: id, argv: argv, cwd: (m["cwd"] as? String) ?? NSHomeDirectory(), env: env,
                            cols: (m["cols"] as? Int) ?? 80, rows: (m["rows"] as? Int) ?? 24, meta: (m["meta"] as? String) ?? "")
        if let e = r.error { emit(["ev": "exit", "id": id, "code": -1, "err": e]) }
        else { say("open \(id) pid \(r.pid): \(argv.joined(separator: " "))"); emit(["ev": "opened", "id": id, "pid": Int(r.pid)]) }
    case "in":
        if let b = m["b64"] as? String, let d = Data(base64Encoded: b) { server.write(id: id, data: d) }
    case "size":
        server.resize(id: id, cols: (m["cols"] as? Int) ?? 0, rows: (m["rows"] as? Int) ?? 0, redraw: (m["redraw"] as? Bool) == true)
    case "close":
        server.close(id: id)
    case "closeall":
        server.closeAll()
        emit(["ev": "closedall"])
    case "meta":
        server.setMeta(id: id, meta: (m["meta"] as? String) ?? "")
    case "replay":
        if let r = server.replayUpTo(id: id) { replayedTo[id] = r.upTo; emit(["ev": "data", "id": id, "b64": r.data.base64EncodedString(), "replay": true]) }
        else { emit(["ev": "exit", "id": id, "code": -1]) }
    default:
        break
    }
}

func readable() {
    // one read per event (the socket stays blocking for writes)
    var buf = [UInt8](repeating: 0, count: 65536)
    let n = read(client, &buf, buf.count)
    if n > 0 { inbuf.append(buf, count: n) }
    else if n < 0 && (errno == EAGAIN || errno == EINTR) { return }
    else { say("the app went away"); dropClient(); return }
    while let nl = inbuf.firstIndex(of: 0x0a) {
        let line = inbuf.subdata(in: inbuf.startIndex..<nl)
        inbuf.removeSubrange(inbuf.startIndex...nl)
        if let m = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { handle(m) }
        if client < 0 { return }
    }
}

let acceptSrc = DispatchSource.makeReadSource(fileDescriptor: lfd, queue: q)
acceptSrc.setEventHandler {
    let fd = accept(lfd, nil, nil)
    guard fd >= 0 else { return }
    var uid: uid_t = 0, gid: gid_t = 0
    if getpeereid(fd, &uid, &gid) != 0 || uid != getuid() { close(fd); return }
    if client >= 0 { say("a new app connected: the previous connection is dropped"); dropClient() }
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    var one: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    var big: Int32 = 1 << 20
    setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &big, socklen_t(MemoryLayout<Int32>.size))
    // a stuck app must not stall the terminals: a write that times out drops it
    var tv = timeval(tv_sec: 5, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    client = fd
    let s = DispatchSource.makeReadSource(fileDescriptor: fd, queue: q)
    s.setEventHandler { readable() }
    clientSrc = s
    s.resume()
}
acceptSrc.resume()

let idle = DispatchSource.makeTimerSource(queue: q)
idle.schedule(deadline: .now() + 5, repeating: 5)
idle.setEventHandler {
    var s = stat()
    if stat(sockPath, &s) != 0 || s.st_ino != sockIno {
        say("the socket is gone: hanging up \(server.count) terminal(s)")
        server.closeAll(); exit(0)
    }
    if client < 0 && server.count == 0 && Date().timeIntervalSince(lastClient) > 30 {
        say("nothing left to keep"); unlink(sockPath); exit(0)
    }
}
idle.resume()
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: q)
term.setEventHandler { say("SIGTERM: hanging up \(server.count) terminal(s)"); server.closeAll(); unlink(sockPath); exit(0) }
term.resume()
dispatchMain()
