// Rally.app — the rally page in a window, with no server.
// The page loads from the bundle (file://) and asks for state over a WebKit message; the app runs
// `node rally.js <command>` once and hands the JSON back. Nothing listens on any port.
import AppKit
import WebKit
import ServiceManagement
import Carbon.HIToolbox
import UserNotifications

/// The header is the window's title bar. The page says when the pointer is over a bare part of it (headerBare);
/// a press there is handled here, in the mouse-down itself, where the real event is: a drag moves the window,
/// a double click zooms it. (Asked from the page after the press, the event was already gone: drags often failed.)
final class BoardWebView: WKWebView {
    var headerBare = false
    /// ⌘+ ⌘= ⌘- ⌘0 (+1, -1, 0): taken here, before the page and the menu, so they work whatever the page does with the key.
    /// ⌘= is ⌘+ without Shift, the one most hands press; a hidden menu item would not take it.
    var onZoom: ((Int) -> Void)?
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let m = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if m == .command || m == [.command, .shift], let k = event.charactersIgnoringModifiers {
            if k == "=" || k == "+" { onZoom?(1); return true }
            if m == .command, k == "-" { onZoom?(-1); return true }
            if m == .command, k == "0" { onZoom?(0); return true }
        }
        return super.performKeyEquivalent(with: event)
    }
    // dragging an inactive window by its title bar works on the first press, as it does in any title bar
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { headerBare || super.acceptsFirstMouse(for: event) }
    override func mouseDown(with event: NSEvent) {
        if headerBare, event.type == .leftMouseDown {
            if event.clickCount == 2 { window?.zoom(nil) } else { window?.performDrag(with: event) }
            return
        }
        super.mouseDown(with: event)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSMenuDelegate, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSTextField!
    var node: String?
    var script: String?
    /// The bundled board. The bridge answers this page and nothing else.
    var pageURL: URL?
    // Separate queues so a slow refresh, a blocked terminal command or a model call never holds up a click.
    let queue = DispatchQueue(label: "rally.node")            // state refreshes
    let actQueue = DispatchQueue(label: "rally.act")          // what a person just pressed
    let slowQueue = DispatchQueue(label: "rally.slow", attributes: .concurrent)
    let attachQueue = DispatchQueue(label: "rally.attach")
    let shellQueue = DispatchQueue(label: "rally.shell")      // the terminal strip
    let histQueue = DispatchQueue(label: "rally.history")
    let filesQueue = DispatchQueue(label: "rally.files")      // `@` completion, typed against
    // the strip's panes, each its own shell: the running command, a ⌃C for it, and its own queue
    var shellProcs: [Int: Process] = [:]
    var shellStops: [Int: Bool] = [:]
    // typing while a command runs goes to its stdin, echoed as a terminal would (not after a password prompt)
    var shellIns: [Int: FileHandle] = [:]
    var shellEchoes: [Int: (Data) -> Void] = [:]
    var shellTyped: [Int: Int] = [:]
    var shellQueues: [Int: DispatchQueue] = [:]
    let shellLock = NSLock()
    var sendQueues: [String: DispatchQueue] = [:]
    let sendLock = NSLock()
    func sendQueueFor(_ key: String) -> DispatchQueue {
        sendLock.lock(); defer { sendLock.unlock() }
        if key.hasPrefix("run:") { return DispatchQueue(label: "rally.send.run") }
        if let q = sendQueues[key] { return q }
        let q = DispatchQueue(label: "rally.send.\(key)")
        sendQueues[key] = q
        return q
    }
    func shellQueueFor(_ pane: Int) -> DispatchQueue {
        shellLock.lock(); defer { shellLock.unlock() }
        if let q = shellQueues[pane] { return q }
        let q = pane == 0 ? shellQueue : DispatchQueue(label: "rally.shell.\(pane)")
        shellQueues[pane] = q
        return q
    }
    // terminals whose session is still being started in the background (ptyopen → bgopen), by id
    var ptyStarting = Set<String>()
    lazy var pty = PtyHost(send: { [weak self] js in self?.call(js) }, log: { [weak self] l in self?.logLine(l) })
    // Main-thread bookkeeping: one state run in flight plus one waiting, one history read per session.
    var stateRunning = false
    var statePending: (hours: Int, enrich: Bool, watch: Bool)?
    var historyInFlight = Set<String>()
    var reloadsSinceFinish = 0
    // The board stays running with its window closed, so ⌥⌘K or a relaunch brings it straight back.
    var hotKeyRef: EventHotKeyRef?
    var loginItem: NSMenuItem?
    let selftesting = Env.get("SELFTEST") != nil
    /// The selftest stays out of your way: no Dock icon, an invisible window, never brought forward,
    /// so your keys and pointer are untouched. RALLY_SELFTEST_FOREGROUND=1 shows it.
    var selftestHidden: Bool { selftesting && Env.get("SELFTEST_FOREGROUND") != "1" }
    func front() {
        if selftestHidden { window.makeKey(); return }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    // Under selftest nothing reaches Notification Center or the Dock: what would be posted is kept here.
    var notified: [[String: String]] = []
    var badgeShown = ""
    var notifyAsked = false

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(selftestHidden ? .accessory : .regular)
        if selftesting { armSelftestWatchdog() }
        buildMenu()
        logLine(["ev": "datadir", "migrate": DataDir.result])
        watchActive()
        // RALLY_SELFTEST_SIZE=390x844 renders the page at phone width (the narrow layout).
        let size = (Env.get("SELFTEST_SIZE") ?? "").split(separator: "x").compactMap { Double($0) }
        let w = size.count == 2 ? size[0] : 1280, hgt = size.count == 2 ? size[1] : 820
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: hgt),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Rally"
        // the title bar is the page's header: no title text, the traffic lights sit at the header's left
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.center()
        // A forced size must not be autosaved, or every later launch comes up at that size.
        if size.count == 2 {
            window.setContentSize(NSSize(width: w, height: hgt)); window.center()
        } else if !selftesting {
            window.setFrameAutosaveName("rally.main")
            // a frame saved on a display that is no longer attached opens nowhere to be seen
            if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(window.frame) }) { window.center() }
        }
        // A programmatic NSWindow is released on close by default, leaving `window` dangling
        // (reopening crashed). The board outlives its window.
        window.isReleasedWhenClosed = false
        let cfg = WKWebViewConfiguration()
        // The selftest's localStorage must not leak into the board you use.
        if selftesting { cfg.websiteDataStore = .nonPersistent() }
        // A hidden selftest page keeps its timers at full speed (private WKPreferences, set only where they exist).
        if selftesting {
            for k in ["hiddenPageDOMTimerThrottlingEnabled", "hiddenPageDOMTimerThrottlingAutoIncreases", "pageVisibilityBasedProcessSuppressionEnabled"]
            where cfg.preferences.responds(to: NSSelectorFromString("_set" + k.prefix(1).uppercased() + k.dropFirst() + ":")) { cfg.preferences.setValue(false, forKey: k) }
        }
        cfg.userContentController.add(self, name: "kanban")
        // tells the page its header is the title bar (css: :root.winchrome), and when full screen takes the lights away (.winfull)
        cfg.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('winchrome')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // the page's language (00-a-i18n.js reads localStorage 'lang'): the one picked in the app, when the page has none yet
        if let lang = Lang.stored { cfg.userContentController.addUserScript(WKUserScript(source: "try{if(!localStorage.getItem('lang'))localStorage.setItem('lang','\(lang)')}catch(e){}", injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        // the scenarios start from a board with no panel open (the page opens the top card otherwise)
        if selftesting { cfg.userContentController.addUserScript(WKUserScript(source: "window.__akSelftest=true", injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        // macOS may count the selftest window occluded; WebKit then runs no requestAnimationFrame and
        // xterm never draws. While hidden, a frame is a timer instead. RALLY_SELFTEST_OFFSCREEN=1 forces it.
        if selftesting { cfg.userContentController.addUserScript(WKUserScript(source: """
            (()=>{const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window),p=new Map();let n=0;
            const run=(id,cb)=>ts=>{if(p.get(id)&&p.get(id).cb===cb){p.delete(id);cb(ts)}};
            const arm=(id,cb)=>{const e={cb};if(document.hidden)e.t=setTimeout(()=>run(id,cb)(performance.now()),16);else e.r=raf(run(id,cb));p.set(id,e)};
            window.requestAnimationFrame=cb=>{const id=++n;arm(id,cb);return id};
            window.cancelAnimationFrame=id=>{const e=p.get(id);if(!e)return;p.delete(id);if(e.t!==undefined)clearTimeout(e.t);if(e.r!==undefined)caf(e.r)};
            document.addEventListener('visibilitychange',()=>{if(!document.hidden)return;for(const [id,e] of [...p]){if(e.r!==undefined){caf(e.r);arm(id,e.cb)}}});})();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false)) }
        web = BoardWebView(frame: window.contentView!.bounds, configuration: cfg)
        // the page's size (⌘+ ⌘- ⌘0) comes back as you left it; a selftest keeps its own
        if !selftesting, let z = UserDefaults.standard.object(forKey: "pageZoom") as? Double { web.pageZoom = CGFloat(min(max(z, zoomSteps.first!), zoomSteps.last!)) }
        (web as? BoardWebView)?.onZoom = { [weak self] d in if d > 0 { self?.zoomIn() } else if d < 0 { self?.zoomOut() } else { self?.zoomReset() } }
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        window.contentView!.addSubview(web)
        // AppKit puts the window's buttons back where it likes on every resize and focus change
        for name in [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification, NSWindow.didExitFullScreenNotification] {
            NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in DispatchQueue.main.async { self?.placeLights() } }
        }
        DispatchQueue.main.async { self.placeLights() }
        for (name, on) in [(NSWindow.willEnterFullScreenNotification, true), (NSWindow.didExitFullScreenNotification, false)] {
            NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                self?.web.evaluateJavaScript("document.documentElement.classList.toggle('winfull',\(on))", completionHandler: nil)
            }
        }
        status = NSTextField(labelWithString: "")
        status.frame = NSRect(x: 16, y: 16, width: 900, height: 120)
        status.maximumNumberOfLines = 6
        status.textColor = .secondaryLabelColor
        status.isHidden = true
        window.contentView!.addSubview(status)
        if selftestHidden {
            // on screen as far as WebKit knows, invisible to you
            window.alphaValue = 0
            // an alpha-0 window still takes clicks; the scenarios use window.sendEvent, which this leaves alone
            window.ignoresMouseEvents = true
            // OFFSCREEN never orders the window in (a window placed off every screen still counts visible)
            if Env.get("SELFTEST_OFFSCREEN") != "1" { window.orderFrontRegardless(); window.makeKey() }
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }

        script = scriptPath()
        node = nodePath()
        if script == nil { fail("rally.js not found in the app bundle (build.sh copies it)") }
        if node == nil { fail("node not found — this build has no bundled node; install Node ≥ 22.13 (brew install node)") }
        if !selftesting {
            registerHotKey(); refreshLoginItem(); UNUserNotificationCenter.current().delegate = self
            // a permission prompt's banner answers it: 許可 / 拒否, as the board's own buttons do
            let allow = UNNotificationAction(identifier: "ak-allow", title: L("許可", "Allow"), options: [])
            let deny = UNNotificationAction(identifier: "ak-deny", title: L("拒否", "Deny"), options: [.destructive])
            UNUserNotificationCenter.current().setNotificationCategories([UNNotificationCategory(identifier: "ak-perm", actions: [allow, deny], intentIdentifiers: [], options: [])])
        }
        loadPage()
        watchPermDir()
        watchTranscripts()
        if !selftesting { installPermHookShim() }
    }

    /// settings.json's PermissionRequest hook names ~/.rally/bin/permhook, a shim that runs this
    /// bundle's node and lib/permhook.js. Rewritten at every launch so an update or a move follows.
    func installPermHookShim() {
        DispatchQueue.global(qos: .utility).async {
            let (out, code) = self.runNode(["perm", "--shim"], timeout: 20)
            let hook = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any]
            self.logLine(["ev": "permshim", "ok": code == 0, "hook": (hook?["hook"] as? String) ?? "?", "changed": (hook?["changed"] as? Bool) ?? false])
        }
    }

    /// A held permission prompt (lib/perm.js) is a file in <home>/perm: re-read the board as one comes or goes.
    var permSource: DispatchSourceFileSystemObject?
    func watchPermDir() {
        let home = Env.get("HOME") ?? (NSHomeDirectory() + "/.rally")
        let d = home + "/perm"
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let fd = open(d, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: .main)
        src.setEventHandler { [weak self] in self?.call("window.__kanban.permChanged&&window.__kanban.permChanged()") }
        src.setCancelHandler { close(fd) }
        src.resume()
        permSource = src
    }

    /// The terminals live in rally-ptyd (Pty.swift): quitting only detaches, the next launch draws them again.
    /// In-process ptys (host could not start) end with the app; a selftest leaves nothing (except with KEEPPTY).
    func applicationWillTerminate(_ notification: Notification) {
        worker?.stop()
        if pty.local != nil || (selftesting && Env.get("SELFTEST_KEEPPTY") != "1") { pty.closeAll() }
        pty.detach()
    }
    /// Only for in-process terminals: quitting would end their Claude sessions, so ask.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let running = pty.localSessions()
        if selftesting || running.isEmpty { return .terminateNow }
        let a = NSAlert()
        a.messageText = L("このアプリの中で動いている Claude セッションが \(running.count) 本あります", "\(running.count) Claude sessions are running inside this app")
        a.informativeText = L("終了すると止まります(端末のホストを起動できなかったため、アプリが直接動かしています)。", "Quitting stops them (the terminal host could not start, so the app runs them itself).") + "\n\n" + running.prefix(8).map { "・" + $0 }.joined(separator: "\n")
        a.addButton(withTitle: L("続ける", "Keep running"))
        a.addButton(withTitle: L("終了する", "Quit"))
        return a.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }
    // Closing the window parks the board; under selftest it quits, so no process is left behind.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { selftesting }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showBoard()
        return true
    }

    // LaunchServices can deliver reopen *before* applicationDidFinishLaunching on a cold `open -a`,
    // with `window` still nil; the launch path shows the window itself.
    func showBoard() {
        guard let window else { return }
        front()
        web?.evaluateJavaScript("load && load()", completionHandler: nil) // refresh on the way in
    }

    @objc func toggleBoard() {
        guard let window else { return }
        if window.isVisible && NSApp.isActive { NSApp.hide(nil) } else { showBoard() }
    }

    /// ⌥⌘K from anywhere. RegisterEventHotKey is system-wide and needs no
    /// Accessibility permission (a global NSEvent monitor would).
    func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let installed = InstallEventHandler(GetApplicationEventTarget(), { _, _, userData -> OSStatus in
            guard let userData else { return OSStatus(eventNotHandledErr) }
            let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { me.toggleBoard() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let id = EventHotKeyID(signature: OSType(0x414B_4E42), id: 1) // 'AKNB'
        let registered = RegisterEventHotKey(UInt32(kVK_ANSI_K), UInt32(optionKey | cmdKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
        // fails with eventHotKeyExistsErr when another app holds ⌥⌘K
        if installed != noErr || registered != noErr {
            logLine(["ev": "hotkey-failed", "install": Int(installed), "register": Int(registered)])
        }
    }

    // MARK: start at login

    @objc func toggleLoginItem() {
        let svc = SMAppService.mainApp
        do {
            switch svc.status {
            case .enabled: try svc.unregister()
            // switched off in System Settings: only the person can turn it on there
            case .requiresApproval: SMAppService.openSystemSettingsLoginItems()
            default:
                try svc.register()
                if svc.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            }
        } catch {
            status.stringValue = "start at login: \(error.localizedDescription)"
            status.isHidden = false
        }
        logLine(["ev": "login-item", "status": Int(svc.status.rawValue)])
        refreshLoginItem()
    }

    func refreshLoginItem() {
        switch SMAppService.mainApp.status {
        case .enabled: loginItem?.state = .on
        case .requiresApproval: loginItem?.state = .mixed    // waiting on System Settings
        default: loginItem?.state = .off
        }
    }

    func menuWillOpen(_ menu: NSMenu) { if !selftesting { refreshLoginItem() } }

    // MARK: menu

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        let show = app.addItem(withTitle: "Show Board", action: #selector(toggleBoard), keyEquivalent: "k")
        show.keyEquivalentModifierMask = [.option, .command]
        app.addItem(withTitle: "Keyboard Shortcuts…", action: #selector(openKeyset), keyEquivalent: "")
        let login = app.addItem(withTitle: "Start at Login", action: #selector(toggleLoginItem), keyEquivalent: "")
        loginItem = login
        app.addItem(NSMenuItem.separator())
        app.addItem(withTitle: "Quit Rally", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.delegate = self
        appItem.submenu = app
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        viewItem.submenu = view
        NSApp.mainMenu = main
    }

    // MARK: page size

    /// The steps ⌘+ and ⌘- move through; 1.0 is the page as designed.
    var zoomSteps: [Double] { [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.7, 2.0, 2.5, 3.0] }
    func setZoom(_ z: Double) {
        let c = min(max(z, zoomSteps.first!), zoomSteps.last!)
        web.pageZoom = CGFloat(c)
        if !selftesting { UserDefaults.standard.set(c, forKey: "pageZoom") }
        call("typeof flash==='function'&&flash('\(L("画面の大きさ", "Zoom")) \(Int((c * 100).rounded()))%')")
    }
    @objc func zoomIn() { let z = Double(web.pageZoom); setZoom(zoomSteps.first(where: { $0 > z + 0.001 }) ?? zoomSteps.last!) }
    @objc func zoomOut() { let z = Double(web.pageZoom); setZoom(zoomSteps.last(where: { $0 < z - 0.001 }) ?? zoomSteps.first!) }
    @objc func zoomReset() { setZoom(1.0) }

    @objc func openKeyset() {
        showBoard()
        call("document.dispatchEvent(new CustomEvent('ak-keys'))")
    }

    @objc func reload() { if isBoardPage(web.url) { web.reload() } else { loadPage() } }


    // MARK: locating things

    func scriptPath() -> String? {
        if let p = Env.get("JS"), FileManager.default.fileExists(atPath: p) { return p }
        if let r = Bundle.main.resourcePath {
            let p = r + "/js/bin/rally.js"
            if FileManager.default.fileExists(atPath: p) { return p }
        }
        return nil
    }

    /// The bundled node, else an installed one: GUI apps get a bare PATH, so try the usual places, then the login shell.
    func nodePath() -> String? {
        if let p = Env.get("NODE"), FileManager.default.isExecutableFile(atPath: p) { return p }
        if let r = Bundle.main.resourcePath, FileManager.default.isExecutableFile(atPath: r + "/node/bin/node") { return r + "/node/bin/node" }
        for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", NSHomeDirectory() + "/.nodebrew/current/bin/node"] {
            if FileManager.default.isExecutableFile(atPath: c) { return c }
        }
        let p = Process(); p.launchPath = "/bin/zsh"; p.arguments = ["-lc", "command -v node"]
        let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        p.waitUntilExit()
        let s = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? nil : s
    }


    // MARK: page

    /// Whether `u` is the bundled board (any #fragment or ?query allowed).
    /// Everything the bridge can do — the shell included — hangs on this.
    func isBoardPage(_ u: URL?) -> Bool {
        guard let u, u.isFileURL, let p = pageURL else { return false }
        return Self.samePath(u, p)
    }

    static func samePath(_ a: URL, _ b: URL) -> Bool { canonical(a) == canonical(b) }

    /// realpath(3) when the file exists, else the standardized path (resolvingSymlinksInPath
    /// strips /private only from paths that exist, so a dir and a missing file under it disagree).
    static func canonical(_ u: URL) -> String {
        let p = u.standardizedFileURL.path
        guard let r = realpath(p, nil) else { return p }
        defer { free(r) }
        return String(cString: r)
    }

    static func commonAncestor(_ a: URL, _ b: URL) -> URL {
        let x = URL(fileURLWithPath: canonical(a)).pathComponents, y = URL(fileURLWithPath: canonical(b)).pathComponents
        var n = 0
        while n < min(x.count, y.count) && x[n] == y[n] { n += 1 }
        return URL(fileURLWithPath: n <= 1 ? "/" : NSString.path(withComponents: Array(x.prefix(n))), isDirectory: true)
    }

    /// The window only ever shows page.html: links go to the browser, files to their app,
    /// and a dropped .html file never gets the bridge.
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let mainFrame = action.targetFrame?.isMainFrame ?? true   // nil: a new window was asked for
        decisionHandler(Self.navigationPolicy(url: url, mainFrame: mainFrame, clicked: action.navigationType == .linkActivated,
                                              isBoard: isBoardPage(url), open: { self.openExternally($0) }))
    }

    static func navigationPolicy(url: URL, mainFrame: Bool, clicked: Bool, isBoard: Bool, open: (URL) -> Void) -> WKNavigationActionPolicy {
        if url.scheme == "http" || url.scheme == "https" { open(url); return .cancel }
        if isBoard && mainFrame { return .allow }
        // a clicked file link opens outside; a dropped file (not a click) is refused
        if url.isFileURL && clicked { open(url) }
        if !mainFrame && (url.absoluteString == "about:blank" || url.absoluteString == "about:srcdoc") { return .allow }
        return .cancel
    }

    /// Hand a URL to the Mac. Files are opened only when they are documents: the page can name
    /// any path and must not launch an app or a .command file — those are shown in Finder.
    var workspaceOpen: (URL) -> Void = { NSWorkspace.shared.open($0) }         // replaced in tests
    var workspaceReveal: (URL) -> Void = { NSWorkspace.shared.activateFileViewerSelecting([$0]) }
    func openExternally(_ url: URL) {
        if !url.isFileURL {
            workspaceOpen(url)
            logLine(["ev": "open-url", "url": url.absoluteString.prefix(200).description])
            return
        }
        let f = URL(fileURLWithPath: Self.canonical(url))
        guard FileManager.default.fileExists(atPath: f.path) else { return logLine(["ev": "open-file-refused", "path": f.path]) }
        if Self.safeToOpen(f) {
            workspaceOpen(f)
            logLine(["ev": "open-file", "path": f.path])
        } else {
            workspaceReveal(f)
            logLine(["ev": "open-file-revealed", "path": f.path])
        }
    }

    static func safeToOpen(_ f: URL) -> Bool {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: f.path, isDirectory: &isDir), !isDir.boolValue else { return false }
        if FileManager.default.isExecutableFile(atPath: f.path) { return false }
        let risky: Set<String> = ["app", "command", "terminal", "tool", "sh", "zsh", "bash", "csh", "pkg", "mpkg", "dmg",
                                  "scpt", "scptd", "applescript", "workflow", "action", "prefpane", "jar", "webloc",
                                  "inetloc", "fileloc", "url", "shortcut", "osax", "kext", "plugin", "bundle", "definition"]
        return !risky.contains(f.pathExtension.lowercased())
    }

    /// The header is 36px tall and the window's own buttons sit 14pt from the top: this moves them to its
    /// middle, inside the 28pt title bar so they stay clickable. (An empty NSToolbar would do it too, but its
    /// view takes every click in the top 38pt, header buttons included.)
    func placeLights() {
        guard let w = window, !w.styleMask.contains(.fullScreen) else { return }
        for t in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let b = w.standardWindowButton(t), let sv = b.superview else { continue }
            b.setFrameOrigin(NSPoint(x: b.frame.origin.x, y: (sv.frame.height - b.frame.height) / 2 - 4))
        }
    }

    func loadPage() {
        guard let r = Bundle.main.resourcePath else { return fail("no resource path") }
        let page = URL(fileURLWithPath: r + "/page.html")
        pageURL = page
        guard FileManager.default.fileExists(atPath: page.path) else { return fail("page.html not found in the app bundle (build.sh writes it)") }
        // Read access covers ~/.rally (cached transcript images) and the page itself: with page.html
        // outside it, WebKit loaded file:// pages without asking decidePolicyFor.
        let home = FileManager.default.homeDirectoryForCurrentUser
        web.loadFileURL(page, allowingReadAccessTo: Self.commonAncestor(page.deletingLastPathComponent(), home))
    }

    /// The long-lived `rally worker` for state and history (NodeWorker.swift); RALLY_WORKER=0 leaves it out.
    var workerAnswers = 0                         // answers that came from it (the selftest checks it is used)
    lazy var worker: NodeWorker? = {
        guard Env.get("WORKER") != "0", let node = node, let script = script else { return nil }
        let w = NodeWorker(node: node, script: script)
        w.log = { [weak self] f in self?.logLine(f) }
        return w
    }()
    /// state and history through the worker once it is warm; as a process per command otherwise, or whenever it does not answer
    func runNodeFast(_ args: [String], timeout: TimeInterval = 60) -> (String, Int32) {
        if ["state", "history"].contains(args.first ?? ""), let w = worker {
            let started = Date()
            if let r = w.run(args, timeout: min(timeout, 30)) {
                DispatchQueue.main.async { self.workerAnswers += 1 }
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                if ms >= 1500 { logLine(["ev": "node", "cmd": args.first ?? "", "ms": ms, "via": "worker"]) }   // only the slow ones
                return r.1 == 0 ? (r.0, 0) : (Self.failureText(out: r.0, err: "", code: r.1), r.1)
            }
        }
        return runNode(args, timeout: timeout)
    }

    func runNode(_ args: [String], timeout: TimeInterval = 60) -> (String, Int32) {
        let started = Date()
        defer {
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            if ms >= 1500 || !["state", "history", "pr"].contains(args.first ?? "") { logLine(["ev": "node", "cmd": args.first ?? "", "ms": ms]) }
        }
        guard let node = node, let script = script else { return ("node or rally.js not found", -1) }
        let r = Self.runProcess(node, [script] + args, timeout: timeout)
        if r.timedOut {
            logLine(["ev": "node-timeout", "cmd": args.first ?? "", "s": Int(timeout)])
            return (L("\(Int(timeout))秒で応答がないので止めました", "Stopped: no answer in \(Int(timeout)) seconds"), -1)
        }
        if r.code != 0 { return (Self.failureText(out: r.out, err: r.err, code: r.code), r.code) }
        return (r.out, 0)
    }

    /// Both pipes are drained at once, or a child filling stderr (64KB) blocks and so does the app.
    /// A child that never exits is terminated, then killed.
    static func runProcess(_ exe: String, _ args: [String], timeout: TimeInterval) -> (out: String, err: String, code: Int32, timedOut: Bool) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.standardInput = FileHandle.nullDevice
        let out = Pipe(), err = Pipe()
        p.standardOutput = out; p.standardError = err
        let exited = DispatchSemaphore(value: 0)
        p.terminationHandler = { _ in exited.signal() }
        let lock = NSLock()
        var odata = Data(), edata = Data()
        let readers = DispatchGroup()
        for (h, isOut) in [(out.fileHandleForReading, true), (err.fileHandleForReading, false)] {
            readers.enter()
            DispatchQueue.global().async {
                // chunk by chunk: EOF may never come (a grandchild inherited the pipe)
                while true {
                    let d = h.availableData
                    if d.isEmpty { break }
                    lock.lock(); if isOut { odata.append(d) } else { edata.append(d) }; lock.unlock()
                }
                readers.leave()
            }
        }
        do { try p.run() } catch {
            try? out.fileHandleForWriting.close(); try? err.fileHandleForWriting.close()
            return ("", error.localizedDescription, -1, false)
        }
        var timedOut = false
        if exited.wait(timeout: .now() + timeout) == .timedOut {
            timedOut = true
            p.terminate()
            if exited.wait(timeout: .now() + 2) == .timedOut { kill(p.processIdentifier, SIGKILL); exited.wait() }
        }
        _ = readers.wait(timeout: .now() + 2)
        lock.lock(); let o = odata, e = edata; lock.unlock()
        return (String(decoding: o, as: UTF8.self), String(decoding: e, as: UTF8.self), p.terminationStatus, timedOut)
    }

    /// The CLI reports a refusal as {"error": …} on stdout with exit 1 and nothing on stderr.
    static func failureText(out: String, err: String, code: Int32) -> String {
        if let j = try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any],
           let e = j["error"] as? String, !e.isEmpty { return e }
        let e = err.trimmingCharacters(in: .whitespacesAndNewlines)
        if !e.isEmpty { return e }
        let o = out.trimmingCharacters(in: .whitespacesAndNewlines)
        if !o.isEmpty { return o }
        return "exit \(code)"
    }

    /// The terminal strip's shell: one process per command, its cwd kept between commands, output capped.
    var shellCwds: [Int: String] = [:]
    func cwdOf(_ pane: Int) -> String {
        shellLock.lock(); defer { shellLock.unlock() }
        return shellCwds[pane] ?? FileManager.default.homeDirectoryForCurrentUser.path
    }
    func setCwd(_ pane: Int, _ dir: String) { shellLock.lock(); shellCwds[pane] = dir; shellLock.unlock() }
    func runShell(_ rawCmd: String, rc: Bool = false, pane: Int = 0) -> (String, Int32, String) {
        let MAXOUT = 200_000
        var cmd = rawCmd
        if let node = node, let script = script, cmd == "ak" || cmd.hasPrefix("ak ") {
            cmd = "'\(node)' '\(script)'" + String(cmd.dropFirst(2))
        }
        var env = ProcessInfo.processInfo.environment
        let login = env["SHELL"] ?? ""
        let sh = (login.hasSuffix("/zsh") || login.hasSuffix("/bash")) && FileManager.default.isExecutableFile(atPath: login) ? login : "/bin/zsh"
        let p = Process()
        p.launchPath = sh
        // The shell prints where `cd` left it. Newlines, not `;`: a typed `#` would comment out the rest.
        // `builtin cd`: your rc may alias cd.
        let dirArg = "'" + cwdOf(pane).replacingOccurrences(of: "'", with: "'\\''") + "'"
        let body = "builtin cd \(dirArg) 2>/dev/null\n{\n\(cmd)\n} 2>&1\n__ak=$?\nprintf '\\034%s' \"$PWD\"\nexit $__ak"
        // -i reads your .zshrc/.bashrc, which a login shell alone does not (a toggle in the strip)
        p.arguments = [rc ? "-ilc" : "-lc", body]
        let out = Pipe()
        p.standardOutput = out; p.standardError = out
        // stdin is a pipe the line writes into (⌃D ends it); programs that need a real tty go to a ＋シェル pane
        let inPipe = Pipe()
        p.standardInput = inPipe
        env["PATH"] = [env["HOME"].map { $0 + "/.local/bin" } ?? "", "/opt/homebrew/bin", "/usr/local/bin", env["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")
        // dumb keeps programs from drawing, but rc prompt tools refuse it; with rc, escapes are stripped instead
        env["TERM"] = rc ? "xterm-256color" : "dumb"; env["NO_COLOR"] = "1"; env["CLICOLOR"] = "0"
        // as for a ＋シェル pane: no env of a Claude session the app was started from, nor its BROWSER=true
        for k in env.keys where k == "CLAUDECODE" || k.hasPrefix("CLAUDE_CODE_") || k == "CLAUDE_JOB_DIR" || k.hasPrefix("CLAUDE_SESSION") { env.removeValue(forKey: k) }
        if env["BROWSER"] == "true" { env.removeValue(forKey: "BROWSER") }
        p.environment = env
        // Read on the pipe's own thread: `availableData` blocks, so a loop could not check the clock,
        // and `x &` keeps the pipe open after exit.
        let lock = NSLock()
        var data = Data()
        let h = out.fileHandleForReading
        h.readabilityHandler = { fh in
            let chunk = fh.availableData
            lock.lock(); if data.count <= MAXOUT { data.append(chunk) }; lock.unlock()
        }
        do { try p.run() } catch { h.readabilityHandler = nil; return (L("(実行できません: \(error.localizedDescription))", "(cannot run: \(error.localizedDescription))"), -1, cwdOf(pane)) }
        var deadline = Date().addingTimeInterval(120)
        var timedOut = false
        let inH = inPipe.fileHandleForWriting
        // no SIGPIPE for a late line; per descriptor, since SIG_IGN app-wide would be inherited by every command
        _ = fcntl(inH.fileDescriptor, F_SETNOSIGPIPE, 1)
        shellLock.lock(); shellProcs[pane] = p; shellStops[pane] = false; shellIns[pane] = inH
        shellEchoes[pane] = { d in lock.lock(); if data.count <= MAXOUT { data.append(d) }; lock.unlock() }
        shellLock.unlock()
        defer {
            shellLock.lock(); shellProcs[pane] = nil; shellIns[pane] = nil; shellEchoes[pane] = nil; shellLock.unlock()
            try? inH.close()
        }
        var sent = 0, lastSend = Date.distantPast, lastIn = 0
        while p.isRunning {
            if Date() >= deadline { timedOut = true; p.terminate(); break }
            shellLock.lock(); let stop = shellStops[pane] ?? false; shellLock.unlock()
            if stop { p.interrupt(); usleep(300_000); if p.isRunning { p.terminate() }; break }
            lock.lock(); let n = data.count; let fresh = n != sent && Date().timeIntervalSince(lastSend) >= 0.15
            let tail = fresh ? data.suffix(48_000) : Data(); let cut = n > 48_000; lock.unlock()
            if fresh {
                sent = n; lastSend = Date()
                var t = String(decoding: tail, as: UTF8.self)
                if rc { t = Self.cleanInteractive(t) }
                if let r = t.range(of: "\u{1c}", options: .backwards) { t = String(t[..<r.lowerBound]) }
                if cut, let nl = t.firstIndex(of: "\n") { t = "…" + String(t[nl...]) }
                if let d = try? JSONSerialization.data(withJSONObject: ["out": t, "pane": pane] as [String: Any]), let j = String(data: d, encoding: .utf8) {
                    call("window.__kanban.shellPart&&window.__kanban.shellPart(\(j))")
                }
            }
            shellLock.lock(); let typed = shellTyped[pane] ?? 0; shellLock.unlock()
            if typed != lastIn { lastIn = typed; deadline = Date().addingTimeInterval(120) }
            usleep(50_000)
        }
        p.waitUntilExit()
        usleep(100_000)                       // let the last chunk land
        h.readabilityHandler = nil
        lock.lock(); let got = data; lock.unlock()
        // String(decoding:) tolerates a multi-byte character cut in half; String(data:) returns nil
        var text = String(decoding: got.prefix(MAXOUT + 4096), as: UTF8.self)
        if rc { text = Self.cleanInteractive(text) }
        if let r = text.range(of: "\u{1c}", options: .backwards) {
            let dir = String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !dir.isEmpty { setCwd(pane, dir) }
            text = String(text[..<r.lowerBound])
        }
        if got.count > MAXOUT { text += L("\n…(出力が長いので途中で切りました)", "\n…(output too long, cut here)") }
        if timedOut { text += L("\n…(120秒で止めました)", "\n…(stopped after 120 seconds)") }
        return (text, p.terminationStatus, cwdOf(pane))
    }

    /// An interactive shell with no tty: strip the rc's escape sequences and the no-line-editor/job-control noise.
    static func cleanInteractive(_ s: String) -> String {
        var t = s
        for pat in ["\u{1b}\\][^\u{07}\u{1b}]*(\u{07}|\u{1b}\\\\)", "\u{1b}\\[[0-?]*[ -/]*[@-~]", "\u{1b}[@-Z\\\\-_]"] {
            t = t.replacingOccurrences(of: pat, with: "", options: .regularExpression)
        }
        let noise = ["can't change option: zle", "cannot set terminal process group", "no job control in this shell"]
        return t.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { line in !noise.contains { line.contains($0) } }
            .joined(separator: "\n")
    }

    /// <input type=file> in a WKWebView opens nothing unless the app shows the panel itself.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    /// Write one attachment, its name rebuilt from scratch: the page can say anything, and this writes into ~.
    func saveAttachment(name: String, base64: String) -> (String?, String?) {
        let MAXB = 20 * 1024 * 1024
        guard let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]), !data.isEmpty else { return (nil, L("空のファイルです", "The file is empty")) }
        if data.count > MAXB { return (nil, L("大きすぎます(上限20MB)", "Too large (limit 20MB)")) }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dir = Env.get("ATTACHMENTS") ?? (home + "/.rally/attachments")
        var base = (name as NSString).lastPathComponent
        base = String(base.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "." || $0 == "-" || $0 == "_" ? Character($0) : "_" })
        while base.hasPrefix(".") { base.removeFirst() }
        if base.isEmpty { base = "file" }
        if base.count > 60 { base = String(base.suffix(60)) }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-").prefix(19)
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            // two pastes in one second share a name: never overwrite, count up
            for n in 0..<1000 {
                let file = dir + "/" + stamp + (n == 0 ? "" : "-\(n)") + "-" + base
                do {
                    try data.write(to: URL(fileURLWithPath: file), options: .withoutOverwriting)
                    return (file, nil)
                } catch CocoaError.fileWriteFileExists { continue }
            }
            return (nil, L("保存先の名前が尽きました", "Ran out of names to save under"))
        } catch { return (nil, error.localizedDescription) }
    }

    /// Report a one-shot's result back to the page, so a refused action never leaves a button spinning.
    func ack(_ op: String, _ r: (String, Int32)) {
        let (out, code) = r
        var obj: [String: Any] = ["op": op]
        if code != 0 { obj["error"] = String(out.prefix(300)) }
        else if let j = try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any], let e = j["error"] as? String { obj["error"] = e }
        if let d = try? JSONSerialization.data(withJSONObject: obj), let j = String(data: d, encoding: .utf8) {
            call("window.__kanban.ack(\(j))")
        }
    }

    /// ~/.rally/app.log: one JSON line per thing the app does, capped. Called from many queues, so
    /// writes are serialized (logQueue), each a single O_APPEND write (seek-then-write let two share an offset).
    static let logQueue = DispatchQueue(label: "rally.applog")
    func logLine(_ fields: [String: Any]) {
        var obj = fields
        obj["t"] = ISO8601DateFormatter().string(from: Date())
        guard let d = try? JSONSerialization.data(withJSONObject: obj), var line = String(data: d, encoding: .utf8) else { return }
        line += "\n"
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dir = Env.get("HOME") ?? (home + "/.rally")
        let f = dir + "/app.log"
        Self.logQueue.sync {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let fd = open(f, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0o644)
            guard fd >= 0 else { return }
            let bytes = Array(line.utf8)
            _ = bytes.withUnsafeBufferPointer { Darwin.write(fd, $0.baseAddress, $0.count) }
            Darwin.close(fd)
            // full: the old one is kept as app.log.1 (one generation), not cut down to its last lines
            if let size = try? FileManager.default.attributesOfItem(atPath: f)[.size] as? Int, size > 2_000_000 {
                try? FileManager.default.removeItem(atPath: f + ".1")
                try? FileManager.default.moveItem(atPath: f, toPath: f + ".1")
            }
        }
    }

    func sendPrompt(_ cwd: String, pane: Int = 0) {
        let (out, code) = runNode(["gitinfo", "--cwd", cwd])
        guard code == 0, !out.isEmpty, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil else { return }
        call("window.__kanban.prompt(Object.assign(\(out),{pane:\(pane)}))")
    }

    /// A value as a JavaScript literal: JSON is a JS expression (hand escaping missed \r).
    static func jsLiteral(_ v: Any) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]),
              let s = String(data: d, encoding: .utf8) else { return "null" }
        return s
    }

    func call(_ js: String) {
        DispatchQueue.main.async {
            self.web.evaluateJavaScript(js) { _, err in
                if let e = err { self.logLine(["ev": "call-failed", "js": String(js.prefix(60)), "err": String(describing: e).prefix(200).description]) }
            }
        }
    }

    /// Messages from the page: {type:'state', hours, enrich} | {type:'history', agent, session, hours} | {type:'run'|'reply'|'queue'|'label'|'wip'|'done'|'shell'|'attach', …}
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        // Only the board itself, in the top frame: nothing else in this web view may reach the shell.
        guard message.frameInfo.isMainFrame, isBoardPage(message.webView?.url) else {
            logLine(["ev": "bridge-refused", "type": type, "url": (message.webView?.url?.absoluteString ?? "").prefix(200).description])
            return
        }
        handle(body, type: type)
    }

    func handle(_ body: [String: Any], type: String) {
        // what you pressed, not the terminals' traffic (per-key/resize lines would flood the capped log)
        // nor the panel's own polls (history, pr every few seconds): they were most of the log and pushed a week out in 12 hours
        if !["state", "badge", "ptyin", "ptysize", "ptymeta", "selftestsample", "history", "pr"].contains(type) {
            logLine(["ev": "page", "type": type,
                     "session": (body["session"] as? String)?.prefix(8).description ?? "",
                     "agent": body["agent"] as? String ?? "",
                     "chars": (body["text"] as? String)?.count ?? 0])
        }
        if type == "log" {                      // the page's own errors
            logLine(["ev": "page-error", "msg": String(((body["text"] as? String) ?? "").prefix(300))])
            return
        }
        switch type {
        case "lang":
            // picked on the page (⚙): kept for the app's own words, and node started from now on speaks it too
            guard let v = body["lang"] as? String, v == "ja" || v == "en" else { return }
            if !selftesting { UserDefaults.standard.set(v, forKey: "lang") }
            Lang.export()
            worker?.stop()                        // the next state starts a worker with the new RALLY_LANG
        case "state":
            let hours = max(1, min(720, (body["hours"] as? Int) ?? 24))
            requestState(hours: hours, enrich: (body["enrich"] as? Bool) == true, watch: (body["watch"] as? Bool) == true)
        case "history":
            let hours = max(1, min(720, (body["hours"] as? Int) ?? 24))
            let agent = (body["agent"] as? String) ?? ""
            let session = (body["session"] as? String) ?? ""
            // the open panel polls: never queue a second read behind a slow one
            let key = agent + ":" + session
            if historyInFlight.contains(key) { return }
            historyInFlight.insert(key)
            histQueue.async {
                defer { DispatchQueue.main.async { self.historyInFlight.remove(key) } }
                let (out, code) = self.runNodeFast(["history", "--as", agent, "--session", session, "--hours", String(hours)])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil {
                    self.call("window.__kanban.history(\(out))")
                } else {
                    // through JSON, never a hand-built JS string (a quote in stderr was a SyntaxError)
                    let obj: [String: Any] = ["agent": agent, "session": session, "turns": [],
                                              "error": L("履歴を読み取れませんでした: ", "Could not read the history: ") + String(out.prefix(200))]
                    if let d = try? JSONSerialization.data(withJSONObject: obj), let j = String(data: d, encoding: .utf8) {
                        self.call("window.__kanban.history(\(j))")
                    }
                }
            }
        case "changes":
            let agent = (body["agent"] as? String) ?? "", session = (body["session"] as? String) ?? ""
            filesQueue.async {
                let (out, code) = self.runNode(["changes", "--as", agent, "--session", session])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil {
                    self.call("window.__kanban.changes(\(out))")
                } else if let d = try? JSONSerialization.data(withJSONObject: ["agent": agent, "session": session, "files": [], "error": L("変更を読めませんでした", "Could not read the changes")]),
                          let j = String(data: d, encoding: .utf8) {
                    self.call("window.__kanban.changes(\(j))")
                }
            }
        case "view":
            let path = (body["path"] as? String) ?? ""
            filesQueue.async {
                let (out, code) = self.runNode(["view", "--cwd", path])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil {
                    self.call("window.__kanban.viewed(\(out))")
                } else if let d = try? JSONSerialization.data(withJSONObject: ["path": path, "error": L("開けませんでした", "Could not open it")]),
                          let j = String(data: d, encoding: .utf8) {
                    self.call("window.__kanban.viewed(\(j))")
                }
            }
        case "files":
            let dir = (body["dir"] as? String) ?? ""
            filesQueue.async {
                let (out, code) = self.runNode(["files", "--cwd", dir])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil {
                    self.call("window.__kanban.files(\(out))")
                } else if let d = try? JSONSerialization.data(withJSONObject: ["dir": dir, "files": [], "error": L("一覧を取れませんでした", "Could not list them")]),
                          let j = String(data: d, encoding: .utf8) {
                    self.call("window.__kanban.files(\(j))")
                }
            }
        case "queue":
            var args = ["queue", "--as", (body["agent"] as? String) ?? "", "--session", (body["session"] as? String) ?? ""]
            // 今の作業後に送る: one held message (its key) taken back, typed by the page, or sent now
            if let k = body["key"] as? String, !k.isEmpty { args += ["--key", k] }
            if (body["now"] as? Bool) == true {
                args.append("--now")
                if (body["typeInto"] as? Bool) == true, !selftesting { args.append("--type") }
            }
            else if (body["cancel"] as? Bool) == true {
                args.append("--cancel")
                if (body["plain"] as? Bool) == true { args.append("--plain") }
                if (body["delivered"] as? Bool) == true { args.append("--delivered") }
            }
            else if (body["retry"] as? Bool) == true { args.append("--retry") }
            else if (body["edit"] as? Bool) == true { args += ["--edit", "--text", (body["text"] as? String) ?? ""] }
            else {
                args += ["--text", (body["text"] as? String) ?? ""]
                if let m = body["model"] as? String, !m.isEmpty { args += ["--model", m] }
            }
            actQueue.async { self.ack("queue", self.runNode(args)) }
        case "wip":
            // 棚卸し: read the tail of one session and cache what is still open
            var args = ["wip", "--as", (body["agent"] as? String) ?? "", "--session", (body["session"] as? String) ?? ""]
            if let d = body["drop"] as? String { args += ["--drop", d] }
            slowQueue.async { self.ack("wip", self.runNode(args)) }
        case "done":
            // 完了 pressed: record it, and (unless unticked) ask the session to write down what it learned
            var args = ["done", "--as", (body["agent"] as? String) ?? "", "--session", (body["session"] as? String) ?? ""]
            if (body["undo"] as? Bool) == true { args.append("--cancel") }
            else if (body["park"] as? Bool) == true { args.append("--park") }
            else if (body["memory"] as? Bool) == true { args.append("--memory") }
            if let d = body["dir"] as? String, !d.isEmpty { args += ["--cwd", d] }
            actQueue.async { self.ack("done", self.runNode(args)) }
        case "prompt":                       // the strip asking where it is
            // a new pane starts where the one it was split from is
            let cwd = (body["cwd"] as? String) ?? "", pane = (body["pane"] as? Int) ?? 0
            if !cwd.isEmpty, FileManager.default.fileExists(atPath: cwd) { shellLock.lock(); if shellCwds[pane] == nil { shellCwds[pane] = cwd }; shellLock.unlock() }
            shellQueueFor(pane).async { self.sendPrompt(self.cwdOf(pane), pane: pane) }
        case "complete":
            // Tab in the footer terminal's line: bash's compgen in that pane's folder — files (a / on folders), and
            // command names for the first word. Read-only: nothing the person typed is run, the word is an argument.
            let pane = (body["pane"] as? Int) ?? 0
            let word = String(((body["word"] as? String) ?? "").prefix(400))
            let first = (body["first"] as? Bool) ?? false
            let seq = (body["seq"] as? Int) ?? 0
            filesQueue.async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/bash")
                let script = "w=\"$1\"; case \"$w\" in \"~\"*) w=\"$HOME${w#\\~}\";; esac; { if [ \"$2\" = 1 ] && [[ \"$w\" != */* ]]; then compgen -c -- \"$w\"; fi; compgen -f -- \"$w\" | while IFS= read -r f; do if [ -d \"$f\" ]; then echo \"$f/\"; else echo \"$f\"; fi; done; } | awk '!s[$0]++' | head -200"
                p.arguments = ["--noprofile", "--norc", "-c", script, "_", word, first ? "1" : "0"]
                p.currentDirectoryURL = URL(fileURLWithPath: self.cwdOf(pane))
                let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
                var items: [String] = []
                if (try? p.run()) != nil {
                    let d = out.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
                    items = String(decoding: d, as: UTF8.self).split(separator: "\n").map(String.init)
                }
                let obj: [String: Any] = ["pane": pane, "seq": seq, "word": word, "items": items, "home": FileManager.default.homeDirectoryForCurrentUser.path]
                if let d = try? JSONSerialization.data(withJSONObject: obj), let j = String(data: d, encoding: .utf8) { self.call("window.__kanban.completed&&window.__kanban.completed(\(j))") }
            }
        case "shell":
            // The footer terminal: one command per Enter through the login shell, only what the person typed.
            // Only inside the app: a browser has no bridge to reach it.
            let cmd = (body["cmd"] as? String) ?? ""
            let rc = (body["rc"] as? Bool) ?? false
            let pane = (body["pane"] as? Int) ?? 0
            if cmd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
            shellQueueFor(pane).async {
                let (out, code, cwd) = self.runShell(cmd, rc: rc, pane: pane)
                self.sendPrompt(cwd, pane: pane)
                var obj: [String: Any] = ["out": out, "code": Int(code), "cwd": cwd, "pane": pane]
                if let d = try? JSONSerialization.data(withJSONObject: obj), let j = String(data: d, encoding: .utf8) {
                    self.call("window.__kanban.shellOut(\(j))")
                } else {
                    obj = [:]
                    self.call("window.__kanban.shellOut({out:'\(L("(出力を渡せませんでした)", "(could not pass the output)"))',code:1,pane:\(pane)})")
                }
            }
        case "shellstop":
            let pane = (body["pane"] as? Int) ?? 0
            shellLock.lock(); if shellProcs[pane] != nil { shellStops[pane] = true }; shellLock.unlock()
        case "shellin":
            // a line typed while a command runs: to its stdin (eof: ⌃D, its input ends)
            let pane = (body["pane"] as? Int) ?? 0
            let text = (body["text"] as? String) ?? ""
            let echo = (body["echo"] as? Bool) ?? true
            let eof = (body["eof"] as? Bool) ?? false
            shellLock.lock(); let inH = shellIns[pane]; let show = shellEchoes[pane]; if inH != nil { shellTyped[pane] = (shellTyped[pane] ?? 0) + 1 }; shellLock.unlock()
            guard let h = inH else { return }
            if eof { try? h.close(); shellLock.lock(); shellIns[pane] = nil; shellLock.unlock(); return }
            let d = Data((text + "\n").utf8)
            show?(echo ? d : Data("\n".utf8))
            // off the main thread: a pipe whose reader is not reading blocks the writer
            shellQueueFor(pane == 0 ? -1 : -1 - pane).async { try? h.write(contentsOf: d) }
        case "shellclose":
            let pane = (body["pane"] as? Int) ?? 0
            if pane != 0 { shellLock.lock(); shellCwds[pane] = nil; shellLock.unlock() }
        case "ptyowner":
            let pid = (body["pid"] as? Int) ?? 0
            let session = (body["session"] as? String) ?? ""
            // from the page: pid_t(exactly:) so a value past Int32 cannot trap
            let owner = pid > 1 ? pid_t(exactly: pid).flatMap { pty.owner(of: $0) } : nil
            call("window.__kanban.ptyOwner(\(PtyHost.js(session)),\(PtyHost.js(owner ?? "")))")
        case "ptyopen":
            // a real terminal in the strip; what runs is decided in PtyHost.command
            let id = (body["id"] as? String) ?? ""
            guard id.range(of: "^[A-Za-z0-9_-]{1,40}$", options: .regularExpression) != nil else { return }
            let env = ProcessInfo.processInfo.environment
            let login = env["SHELL"] ?? ""
            let sh = (login.hasSuffix("/zsh") || login.hasSuffix("/bash")) && FileManager.default.isExecutableFile(atPath: login) ? login : "/bin/zsh"
            let kind = (body["kind"] as? String) ?? "", session = (body["session"] as? String) ?? "", mode = (body["mode"] as? String) ?? ""
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let cwd = (body["cwd"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? home
            var extra = ["TERM": "xterm-256color", "COLORTERM": "truecolor", "TERM_PROGRAM": "Rally",
                         "PATH": [home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", env["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")]
            if (env["LANG"] ?? "").isEmpty { extra["LANG"] = "ja_JP.UTF-8" }
            let cols = (body["cols"] as? Int) ?? 80, rows = (body["rows"] as? Int) ?? 24
            let meta = (body["meta"] as? String) ?? ""
            let start: (String, String, String) -> Void = { [weak self] k, sess, m in
                guard let self = self else { return }
                let (argv, err) = PtyHost.command(kind: k, session: sess, shell: sh, mode: m)
                if let err = err { return self.call("window.__kanban.ptyExit(\(PtyHost.js(id)),-1,\(PtyHost.js(err)))") }
                if let e = self.pty.open(id: id, argv: argv, cwd: cwd, cols: cols, rows: rows, env: extra, meta: meta) {
                    self.call("window.__kanban.ptyExit(\(PtyHost.js(id)),-1,\(PtyHost.js(e)))")
                }
            }
            // A stopped session is opened in the background and attached to (lib/bgopen.js), so quitting
            // only detaches. Direct `claude --resume` when Claude will not background it, or a mode is asked.
            if kind == "resume" && (body["direct"] as? Bool) != true && mode.isEmpty {
                guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return call("window.__kanban.ptyExit(\(PtyHost.js(id)),-1,\(PtyHost.js(L("セッションIDが不正です", "Invalid session id"))))") }
                var args = ["bgopen", "--session", session, "--cwd", cwd]
                if let km = body["keepMode"] as? String, ["auto", "acceptEdits", "plan"].contains(km) { args += ["--mode", km] }
                ptyStarting.insert(id)
                sendQueueFor(session).async {
                    let (out, _) = self.runNode(args, timeout: 45)
                    let j = (try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any]) ?? ["error": String(out.prefix(200))]
                    self.logLine(["ev": "bgopen", "session": session, "out": String(out.prefix(300))])
                    DispatchQueue.main.async {
                        let cancelled = !self.ptyStarting.contains(id); self.ptyStarting.remove(id)
                        if let short = j["short"] as? String, short.range(of: "^[0-9a-f]{6,12}$", options: .regularExpression) != nil {
                            let how = (j["how"] as? String) ?? ""
                            // closed while it was starting: a session started only for it goes back to stopped
                            if cancelled { if how == "started" { self.actQueue.async { _ = self.runNode(["bgstop", "--session", session]) } }; return self.call("window.__kanban.ptyExit(\(PtyHost.js(id)),0)") }
                            self.call("window.__kanban.ptyKind(\(PtyHost.js(id)),'attach',\(PtyHost.js(short)),\(PtyHost.js(how)))")
                            start("attach", short, "")
                        } else if (j["direct"] as? Bool) == true {
                            if cancelled { return self.call("window.__kanban.ptyExit(\(PtyHost.js(id)),0)") }
                            self.call("window.__kanban.ptyKind(\(PtyHost.js(id)),'resume','',\(PtyHost.js((j["why"] as? String) ?? "")))")
                            start("resume", session, "")
                        } else {
                            self.call("window.__kanban.ptyExit(\(PtyHost.js(id)),-1,\(PtyHost.js((j["error"] as? String) ?? L("開けませんでした", "Could not open it"))))")
                        }
                    }
                }
                return
            }
            start(kind, session, mode)
        case "ptylist":
            pty.list { [weak self] tabs in
                guard let d = try? JSONSerialization.data(withJSONObject: tabs), let j = String(data: d, encoding: .utf8) else { return }
                self?.call("window.__kanban.ptyRestore&&window.__kanban.ptyRestore(\(j))")
            }
        case "ptyreplay":
            pty.replay(id: (body["id"] as? String) ?? "", cols: (body["cols"] as? Int) ?? 0, rows: (body["rows"] as? Int) ?? 0)
        case "ptymeta":
            pty.setMeta(id: (body["id"] as? String) ?? "", meta: String(((body["meta"] as? String) ?? "").prefix(2000)))
        case "bgstop":
            // a background session opened only to be looked at, let go: stopped again (idle only; lib/bgopen.js)
            let session = (body["session"] as? String) ?? ""
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return }
            var args = ["bgstop", "--session", session]
            if (body["force"] as? Bool) == true { args.append("--force") }
            if selftesting { notified.append(["key": "bgstop", "title": session, "body": (body["force"] as? Bool) == true ? "force" : ""]) }
            sendQueueFor(session).async {
                let (out, _) = self.runNode(args)
                self.call("window.__kanban.bgStopped&&window.__kanban.bgStopped(\(PtyHost.js(session)),\((try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil ? out : "{}"))")
            }
        case "bgtask":
            // 裏で実行中's 止める (lib/bgtasks.js): node re-checks each process (parent, command line) before signalling
            let session = (body["session"] as? String) ?? ""
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil,
                  let raw = body["tasks"] as? [[String: Any]], !raw.isEmpty, raw.count <= 50 else { return }
            var tasks: [[String: Any]] = []
            for t in raw {
                guard let pid = t["pid"] as? Int, let ppid = t["ppid"] as? Int, pid > 1, ppid > 1,
                      let sig = t["sig"] as? String, sig.range(of: "^[0-9a-f]{16}$", options: .regularExpression) != nil else { return }
                tasks.append(["pid": pid, "ppid": ppid, "sig": sig])
            }
            guard let d = try? JSONSerialization.data(withJSONObject: tasks), let list = String(data: d, encoding: .utf8) else { return }
            logLine(["ev": "bgtask", "session": String(session.prefix(8)), "tasks": list])
            if selftesting {
                notified.append(["key": "bgtask", "title": session, "body": list])
                return call("window.__kanban.bgTasksDone&&window.__kanban.bgTasksDone(\(PtyHost.js(session)),{\"ok\":true,\"results\":[]})")
            }
            actQueue.async {
                let (out, _) = self.runNode(["bgtasks", "--stop", list], timeout: 30)
                self.logLine(["ev": "bgtask-done", "session": String(session.prefix(8)), "out": String(out.prefix(300))])
                self.call("window.__kanban.bgTasksDone&&window.__kanban.bgTasksDone(\(PtyHost.js(session)),\((try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil ? out : "{}"))")
            }
        case "bgauto":
            // the automatic stop of wait loops left looping (lib/bgtasks.js reap), on or off
            let on = (body["on"] as? Bool) == true
            if selftesting { notified.append(["key": "bgauto", "title": on ? "on" : "off", "body": ""]); return }
            actQueue.async { _ = self.runNode(["bgtasks", on ? "--on" : "--off"]) }
        case "takeover":
            // ここで開き直す: close another terminal's idle claude of this session (lib/takeover.js); the page resumes it on {ok}
            let session = (body["session"] as? String) ?? ""
            guard session.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return }
            if selftesting { notified.append(["key": "takeover", "title": session, "body": ""]) }
            sendQueueFor(session).async {
                let (out, _) = self.runNode(["takeover", "--session", session])
                self.logLine(["ev": "takeover", "session": session, "out": String(out.prefix(300))])
                self.call("window.__kanban.tookOver&&window.__kanban.tookOver(\(PtyHost.js(session)),\((try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil ? out : "{}"))")
            }
        case "selftestshot":
            guard selftesting, let dir = Env.get("SELFTEST"), let name = body["name"] as? String,
                  name.range(of: "^[A-Za-z0-9_-]{1,40}$", options: .regularExpression) != nil else { return }
            Task { @MainActor in await self.snapshot(to: dir + "/" + name + ".png") }
        case "selftestsample":
            // selftest/soak.js: one line of <report dir>/samples.jsonl, with the pids selftest.sh's sampler measures
            guard selftesting, let dir = Env.get("SELFTEST"), var s = body["sample"] as? [String: Any] else { return }
            s["apppid"] = Int(getpid())
            let sel = NSSelectorFromString("_webProcessIdentifier")
            if web.responds(to: sel), let n = web.value(forKey: "_webProcessIdentifier") as? NSNumber { s["webpid"] = n.intValue }
            guard let d = try? JSONSerialization.data(withJSONObject: s), var line = String(data: d, encoding: .utf8) else { return }
            line += "\n"
            let fd = open(dir + "/samples.jsonl", O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0o644)
            if fd >= 0 { let b = Array(line.utf8); _ = b.withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) }; close(fd) }
        case "selftesttype":
            // real key events through the web view's text system (a JS KeyboardEvent skips it)
            guard selftesting, let text = body["text"] as? String else { return }
            let cb = (body["cb"] as? String) ?? ""
            let gap = (body["gap"] as? Double) ?? 0.03
            Task { @MainActor in
                for ch in text { await self.osChar(ch, gap: gap) }
                if cb.range(of: "^[A-Za-z0-9_]{1,40}$", options: .regularExpression) != nil { self.call("window.\(cb)&&window.\(cb)()") }
            }
        case "selftestime":
            guard selftesting else { return }
            let cb = (body["cb"] as? String) ?? ""
            Task { @MainActor in
                let r = self.selftestIme(body)
                if cb.range(of: "^[A-Za-z0-9_]{1,40}$", options: .regularExpression) != nil,
                   let d = try? JSONSerialization.data(withJSONObject: r), let s = String(data: d, encoding: .utf8) {
                    self.call("window.\(cb)&&window.\(cb)(\(s))")
                }
            }
        case "ptyin":
            pty.write(id: (body["id"] as? String) ?? "", data: (body["data"] as? String) ?? "")
        case "ptysize":
            pty.resize(id: (body["id"] as? String) ?? "", cols: (body["cols"] as? Int) ?? 0, rows: (body["rows"] as? Int) ?? 0)
        case "ptyclose":
            let id = (body["id"] as? String) ?? ""
            // still being started (lib/bgopen.js): it is not opened when that returns
            if ptyStarting.remove(id) != nil { return }
            pty.close(id: id)
        case "open":
            // a file under the board's own directory only, never an arbitrary path
            let raw = (body["path"] as? String) ?? ""
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let root = Env.get("HOME") ?? (home + "/.rally")
            if !raw.isEmpty, Self.isInside(URL(fileURLWithPath: raw), URL(fileURLWithPath: root)),
               FileManager.default.fileExists(atPath: raw) {
                openExternally(URL(fileURLWithPath: raw))
            } else {
                logLine(["ev": "open-file-refused", "path": raw])
            }
        case "notifyperm":
            if selftesting { notified.append(["key": "notifyperm", "title": "", "body": ""]); return }
            askNotify()
        case "badge":
            let n = max(0, (body["n"] as? Int) ?? 0)
            let label = n > 0 ? String(n) : ""
            if label == badgeShown { break }
            badgeShown = label
            if !selftesting {
                NSApp.dockTile.badgeLabel = n > 0 ? label : nil
                logLine(["ev": "badge", "n": n, "shown": NSApp.dockTile.badgeLabel ?? ""])
            }
        case "notify":
            let key = String(((body["key"] as? String) ?? "").prefix(200))
            let title = String(((body["title"] as? String) ?? "rally").prefix(200))
            let text = String(((body["body"] as? String) ?? "").prefix(400))
            let perm = (body["perm"] as? String) ?? ""
            let permId = perm.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil ? perm : ""
            if selftesting { notified.append(["key": key, "title": title, "body": text, "perm": permId]); return }
            notify(key: key, title: title, body: text, perm: permId)
        case "asks":
            // the cards held on a permission prompt, for the menu bar (shown only while there are some)
            let items = ((body["items"] as? [[String: Any]]) ?? []).prefix(20).compactMap { d -> (String, String)? in
                guard let k = d["key"] as? String, let t = d["title"] as? String else { return nil }
                return (String(k.prefix(200)), String(t.prefix(80)))
            }
            if selftesting { notified.append(["key": "asks", "title": String(items.count), "body": ""]); return }
            setAsks(Array(items))
        case "hdrbare":
            (web as? BoardWebView)?.headerBare = (body["bare"] as? Bool) ?? false
        case "openurl":
            // https on claude.ai or github.com only
            let raw = (body["url"] as? String) ?? ""
            if let u = URL(string: raw), u.scheme == "https", let h = u.host, ["claude.ai", "github.com"].contains(h) {
                NSWorkspace.shared.open(u)
            } else {
                logLine(["ev": "openurl-refused", "url": String(raw.prefix(200))])
            }
        case "openeditor":
            // a session's folder in an editor: an existing directory, never a file to run
            let raw = (body["path"] as? String) ?? ""
            var isDir: ObjCBool = false
            let u = URL(fileURLWithPath: raw).standardizedFileURL
            guard raw.hasPrefix("/"), FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir), isDir.boolValue, u.path != NSHomeDirectory() else {
                logLine(["ev": "openeditor-refused", "path": String(raw.prefix(300))]); return
            }
            let ids = [Env.get("EDITOR") ?? "", "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed"].filter { !$0.isEmpty }
            if selftesting { notified.append(["key": "openeditor", "title": u.path, "body": ""]); return }
            if let appURL = ids.lazy.compactMap({ NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }).first {
                NSWorkspace.shared.open([u], withApplicationAt: appURL, configuration: NSWorkspace.OpenConfiguration())
            } else {
                NSWorkspace.shared.activateFileViewerSelecting([u])     // no editor: at least the folder
            }
        case "reveal":
            // a file a session wrote: shown in Finder, never opened or run
            let raw = (body["path"] as? String) ?? ""
            let u = URL(fileURLWithPath: raw).standardizedFileURL
            if raw.hasPrefix("/"), FileManager.default.fileExists(atPath: u.path) {
                NSWorkspace.shared.activateFileViewerSelecting([u])
            } else {
                logLine(["ev": "reveal-refused", "path": String(raw.prefix(300))])
            }
        case "attach":
            // a pasted/dropped file, as base64, saved to ~/.rally/attachments (the dispatch grants it with --add-dir)
            let name = (body["name"] as? String) ?? "file"
            let token = (body["token"] as? String) ?? ""
            let b64 = (body["data"] as? String) ?? ""
            attachQueue.async {
                let res = self.saveAttachment(name: name, base64: b64)
                var obj: [String: Any] = ["token": token]
                if let p = res.0 { obj["path"] = p; obj["name"] = (p as NSString).lastPathComponent }
                else { obj["error"] = res.1 ?? L("保存できません", "Could not save") }
                if let d = try? JSONSerialization.data(withJSONObject: obj), let j = String(data: d, encoding: .utf8) {
                    self.call("window.__kanban.attached(\(j))")
                }
            }
        case "pr":
            let args = ["pr", "--as", (body["agent"] as? String) ?? "", "--session", (body["session"] as? String) ?? ""]
            DispatchQueue.global(qos: .userInitiated).async {
                let (out, code) = self.runNode(args)
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil { self.call("window.__kanban.pr(\(out))") }
            }
        case "prmerge":
            // マージして片付け / 片付け: gh merges, the worktree goes, the card is closed (lib/pr.js finish)
            let agent = (body["agent"] as? String) ?? "", session = (body["session"] as? String) ?? ""
            guard ["claude", "codex"].contains(agent), session.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$", options: .regularExpression) != nil else { return ack("prmerge", ("bad request", 1)) }
            var args = ["prmerge", "--as", agent, "--session", session]
            if (body["merge"] as? Bool) == true { args.append("--merge") }
            if selftesting { notified.append(["key": "prmerge", "title": session, "body": args.joined(separator: " ")]); return }
            DispatchQueue.global(qos: .userInitiated).async {
                let (out, _) = self.runNode(args)
                if (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil { self.call("window.__kanban.prFinished(\(out))") }
                else { self.ack("prmerge", (out, 1)) }
            }
        case "keylog":
            // the page's opt-in key record (lib/ui/js/44-keylog.js): mode 0600, rotated
            guard !selftesting, let lines = body["lines"] as? [String], !lines.isEmpty else { return }
            let dir = NSHomeDirectory() + "/.rally", path = dir + "/keylog.jsonl"
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            if let at = try? FileManager.default.attributesOfItem(atPath: path), let n = at[.size] as? Int, n > 4_000_000 {
                try? FileManager.default.removeItem(atPath: dir + "/keylog.1.jsonl")
                try? FileManager.default.moveItem(atPath: path, toPath: dir + "/keylog.1.jsonl")
            }
            let stamp = "{\"batch\":\(Int((body["at"] as? Double) ?? Date().timeIntervalSince1970 * 1000))}\n"
            let data = (stamp + lines.joined(separator: "\n") + "\n").data(using: .utf8)!
            let fd = open(path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0o600)
            if fd >= 0 { _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }; close(fd) }
        case "copy":
            // a code block's copy button (the page's clipboard API is not dependable here)
            let text = (body["text"] as? String) ?? ""
            if selftesting { notified.append(["key": "copy", "title": "", "body": text]); return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        case "wtsetup":
            // what a new worktree of this directory lacks, and the two changes to it (lib/wtsetup.js)
            let dir = (body["dir"] as? String) ?? ""
            guard dir.hasPrefix("/") || dir.hasPrefix("~") else { return }
            var args = ["wtsetup", "--cwd", (dir as NSString).expandingTildeInPath]
            if let inc = body["include"] as? [String] { args += ["--include", inc.filter { !$0.contains(",") }.joined(separator: ",")] }
            else if let cmd = body["setup"] as? String { args += ["--setup", cmd] }
            DispatchQueue.global(qos: .userInitiated).async {
                let (out, code) = self.runNode(args)
                guard code == 0, var j = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any] else { return }
                j["dir"] = dir
                if let d = try? JSONSerialization.data(withJSONObject: j), let t = String(data: d, encoding: .utf8) { self.call("window.__kanban.wtsetup(\(t))") }
            }
        case "perm":
            // answer a permission prompt the hook is holding for the board (lib/perm.js)
            let id = (body["id"] as? String) ?? "", decision = (body["decision"] as? String) ?? ""
            guard id.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil, decision.range(of: "^(allow|deny|pass|answer|automode|rule|always|always:[0-3])$", options: .regularExpression) != nil else { return ack("perm", ("bad request", 1)) }
            // a question (AskUserQuestion) is answered with what was chosen: question text → answer
            var args = ["perm", "--id", id, "--answer", decision]
            if decision == "answer" {
                guard let a = body["answers"] as? [String: String], let d = try? JSONSerialization.data(withJSONObject: a), let t = String(data: d, encoding: .utf8) else { return ack("perm", ("bad request", 1)) }
                args += ["--answers", t]
            } else if let t = body["text"] as? String, !t.isEmpty {
                // the rule as edited (rule), what to tell Claude (deny)
                args += ["--text", t]
            }
            if selftesting { notified.append(["key": "perm", "title": id, "body": decision]) }
            actQueue.async { self.ack("perm", self.runNode(args)) }
        case "stop":
            let session = (body["session"] as? String) ?? ""
            guard (body["agent"] as? String) == "claude" else { return ack("stop", (L("claude のセッションだけです", "Claude sessions only"), 1)) }
            if selftesting { notified.append(["key": "stop", "title": session, "body": ""]); return }
            actQueue.async { self.ack("stop", self.runNode(["stop", "--session", session])) }
        case "startterm":
            var args = ["startterm", "--as", "claude", "--cwd", (body["dir"] as? String) ?? "", "--text", (body["text"] as? String) ?? ""]
            if let m = body["model"] as? String, !m.isEmpty { args += ["--model", m] }
            if (body["worktree"] as? Bool) == true { args.append("--worktree") }
            if selftesting { notified.append(["key": "startterm", "title": (body["dir"] as? String) ?? "", "body": (body["text"] as? String) ?? ""]); return }
            actQueue.async { self.ack("startterm", self.runNode(args)) }
        case "attachterm":
            let short = (body["session"] as? String) ?? ""
            guard short.range(of: "^[0-9a-f]{6,12}$", options: .regularExpression) != nil else { return ack("attachterm", ("bad session id", 1)) }
            if selftesting { notified.append(["key": "attachterm", "title": short, "body": ""]); return }
            actQueue.async { self.ack("attachterm", self.runNode(["attachterm", "--session", short])) }
        case "jobact":
            // one change to a launchd job (lib/jobs.js act); the selftest never touches launchd
            let action = (body["action"] as? String) ?? "", label = (body["label"] as? String) ?? ""
            if selftesting { notified.append(["key": "jobact", "title": label, "body": action]); ack("jobact", ("{}", 0)); return }
            filesQueue.async {
                self.ack("jobact", self.runNode(["jobs", "--do", action, "--id", label]))
                let (out, code) = self.runNode(["jobs"])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil { self.call("window.__kanban.jobs(\(out))") }
            }
        case "jobs":
            filesQueue.async {
                let (out, code) = self.runNode(["jobs"])
                self.call("window.__kanban.jobs(\(code == 0 && (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil ? out : "{\"jobs\":[],\"error\":\"\(L("読めませんでした", "Could not read them"))\"}"))")
            }
        case "search":
            let q = String(((body["q"] as? String) ?? "").prefix(200))
            let hours = max(1, min(720, (body["hours"] as? Int) ?? 24))
            filesQueue.async {
                let (out, code) = self.runNode(["search", "--text", q, "--hours", String(hours)])
                if code == 0, (try? JSONSerialization.jsonObject(with: Data(out.utf8))) != nil { self.call("window.__kanban.searched(\(out))") }
                else if let d = try? JSONSerialization.data(withJSONObject: ["q": q, "hits": [String: String]()]), let j = String(data: d, encoding: .utf8) { self.call("window.__kanban.searched(\(j))") }
            }
        case "typeterm":
            let args = ["typeterm", "--as", "claude", "--session", (body["session"] as? String) ?? "", "--cwd", (body["cwd"] as? String) ?? "", "--text", (body["text"] as? String) ?? ""]
            if selftesting { notified.append(["key": "typeterm", "title": (body["session"] as? String) ?? "", "body": (body["text"] as? String) ?? ""]); return }
            actQueue.async { self.ack("typeterm", self.runNode(args)) }
        case "focusterm":
            let agent = (body["agent"] as? String) ?? ""
            guard agent == "claude" else { return ack("focusterm", (L("claude のセッションだけです", "Claude sessions only"), 1)) }
            let args = ["focusterm", "--as", agent, "--session", (body["session"] as? String) ?? "", "--cwd", (body["cwd"] as? String) ?? ""]
            if selftesting { notified.append(["key": "focusterm", "title": args.joined(separator: " "), "body": ""]); return }
            actQueue.async { self.ack("focusterm", self.runNode(args)) }
        case "delete":
            let agent = (body["agent"] as? String) ?? ""
            guard Self.AGENTS.contains(agent) else { return ack("delete", ("agent must be one of \(Self.AGENTS.joined(separator: ", "))", 1)) }
            let args = ["rm", "--as", agent, "--session", (body["session"] as? String) ?? ""]
            actQueue.async { self.ack("delete", self.runNode(args)) }
        case "label":
            var args = ["label", "--as", (body["agent"] as? String) ?? "", "--session", (body["session"] as? String) ?? "",
                        "--color", (body["color"] as? String) ?? ""]
            // only a label the page sent: a colour change must not clear a title you typed
            if let l = body["label"] as? String { args += ["--text", l] }
            actQueue.async { self.ack("label", self.runNode(args)) }
        case "run", "reply":
            let token = (body["token"] as? String) ?? ""
            let card = (body["card"] as? String) ?? ""
            var args = [type, "--as", (body["agent"] as? String) ?? "", "--text", (body["text"] as? String) ?? ""]
            if let m = body["model"] as? String, !m.isEmpty { args += ["--model", m] }
            if type == "run", let d = body["dir"] as? String, !d.isEmpty { args += ["--cwd", d] }
            if type == "run", (body["chrome"] as? Bool) == true { args.append("--chrome") }
            if type == "run", let pm = body["mode"] as? String, !pm.isEmpty { args += ["--mode", pm] }
            if let ef = body["effort"] as? String, ["low", "medium", "high", "xhigh", "max", "ultra"].contains(ef) { args += ["--effort", ef] }
            if type == "run", (body["worktree"] as? Bool) == true { args.append("--worktree") }
            if type == "run", let f = body["fork"] as? String, !f.isEmpty { args += ["--fork", f] }
            for f in (body["attachments"] as? [String]) ?? [] where !f.isEmpty { args += ["--attach", f] }
            if type == "reply", let s = body["session"] as? String { args += ["--session", s] }
            if type == "reply", (body["typeInto"] as? Bool) == true, !selftesting { args.append("--type") }
            // 今の作業後に送る: held while the session is at work, delivered when it is idle (lib/queue.js)
            if type == "reply", (body["whenFree"] as? Bool) == true { args.append("--when-free") }
            if type == "reply", (body["ours"] as? Bool) == true { args.append("--ours") }
            // codex cannot resume without the session's directory
            if type == "reply", let d = body["dir"] as? String, !d.isEmpty { args += ["--cwd", d] }
            let closeOnDone = (body["closeOnDone"] as? Bool) == true
            // a queue per session: nothing else holds a send up, and one session's messages stay in order
            let asked = Date()
            sendQueueFor(type == "reply" ? ((body["session"] as? String) ?? "") : "run:" + token).async {
                let waited = Int(Date().timeIntervalSince(asked) * 1000)
                let (out, _) = self.runNode(args)
                var obj: [String: Any] = [:]
                if let j = try? JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any] { obj = j }
                else { obj = ["error": String(out.prefix(300))] }
                if closeOnDone { obj["closeOnDone"] = true }
                self.logLine(["ev": "dispatch", "type": type, "waited_ms": waited, "out": String(out.prefix(300))])
                obj["token"] = token
                if !card.isEmpty { obj["card"] = card }
                if let data = try? JSONSerialization.data(withJSONObject: obj), let js = String(data: data, encoding: .utf8) {
                    self.call("window.__kanban.dispatched(\(js))")
                }
            }
        default:
            break
        }
    }

    static let AGENTS = ["claude", "codex"]

    /// Whether `f` is `root` or below it, after resolving `..` and symlinks (a plain prefix test would not).
    static func isInside(_ f: URL, _ root: URL) -> Bool {
        let a = canonical(f), r = canonical(root)
        return a.hasPrefix(r.hasSuffix("/") ? r : r + "/")
    }

    /// One state run at a time and at most one waiting: many things ask, and queued runs would pile up.
    func requestState(hours: Int, enrich: Bool, watch: Bool = false) {
        if stateRunning {
            let p = statePending
            statePending = (hours, enrich || (p?.enrich ?? false), watch)   // the newest range is what the page shows now
            return
        }
        stateRunning = true
        queue.async {
            var args = ["state", "--hours", String(hours)]
            if enrich { args.append("--enrich") }
            // the page is on screen: permission prompts may wait for it (lib/perm.js)
            if watch { args.append("--watch") }
            // a wait loop left looping after its turn may be stopped (lib/bgtasks.js; the setting decides)
            if !self.selftesting { args.append("--reap") }
            let (out, code) = self.runNodeFast(args)
            var parseError: String? = nil
            if code == 0 {
                do { _ = try JSONSerialization.jsonObject(with: Data(out.utf8)) }
                catch { parseError = String(describing: error).prefix(200).description }
            }
            if code == 0, parseError == nil {
                self.call("window.__kanban.state(\(out))")
            } else {
                // say so: a lone surrogate makes Foundation refuse the whole document
                self.logLine(["ev": "state-failed", "code": Int(code), "parse": parseError ?? "", "head": String(out.prefix(120))])
                let msg = "exit \(code): " + String((parseError ?? out).prefix(300))
                self.call("window.__kanban.error(\(Self.jsLiteral(msg)))")
            }
            DispatchQueue.main.async {
                self.stateRunning = false
                if let p = self.statePending { self.statePending = nil; self.requestState(hours: p.hours, enrich: p.enrich, watch: p.watch) }
            }
        }
    }

    func fail(_ msg: String) {
        status.isHidden = false
        status.stringValue = msg
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("page failed to load: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        logLine(["ev": "webcontent-terminated"])
        reloadBoard()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let ns = error as NSError
        // our own .cancel in decidePolicyFor lands here too
        if (ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled) || (ns.domain == "WebKitErrorDomain" && ns.code == 102) { return }
        logLine(["ev": "provisional-failed", "err": String(describing: error).prefix(200).description])
        if isBoardPage(webView.url) { return }
        reloadBoard()
    }

    func reloadBoard() {
        reloadsSinceFinish += 1
        if reloadsSinceFinish > 3 { return fail("the board page keeps failing to load; see ~/.rally/app.log") }
        loadPage()
    }

    // Stored properties for the extensions (Selftest.swift, Notifications.swift), which cannot hold them.
    var lastPointer = "none"
    /// how far the self-test got, for its watchdog (read off the main thread, hence the lock)
    static let selftestStageLock = NSLock()
    static var selftestStageText = "launched"
    var watchingActive = false
    var statusItem: NSStatusItem?
    var asksShown: [(String, String)] = []
}

// Started from inside a Claude session, the app would pass its markers to every claude it starts,
// and each would take itself for that session's child (transcript not saved). Dropped at launch.
for k in ProcessInfo.processInfo.environment.keys where k == "CLAUDECODE" || k.hasPrefix("CLAUDE_CODE_") || k == "CLAUDE_JOB_DIR" || k.hasPrefix("CLAUDE_SESSION") { unsetenv(k) }
// …and its BROWSER=true, which makes every "open in the browser" do nothing
if ProcessInfo.processInfo.environment["BROWSER"] == "true" { unsetenv("BROWSER") }
// ~/.agentkanban becomes ~/.rally before anything reads either (DataDir.swift)
DataDir.migrate()
// node started from the app speaks the app's language (lib/i18n.js reads RALLY_LANG)
Lang.export()
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
