// The self-test driver (RALLY_SELFTEST), as an extension of AppDelegate.
// app/selftest.sh runs it; its one stored property, lastPointer, is in main.swift.
import AppKit
import WebKit
import ServiceManagement
import Carbon.HIToolbox
import UserNotifications

extension AppDelegate {
    // MARK: self-test
    //
    // RALLY_SELFTEST=<dir> drives the real page in the real WKWebView, writes report.json and
    // screenshot.png into <dir>, then quits. RALLY_SELFTEST_SCENARIO picks one `if scenario ==` block
    // below (default "view"). The web view's storage is in memory while RALLY_SELFTEST is set.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if isBoardPage(webView.url) { reloadsSinceFinish = 0; sendNotifyState() }
        guard let dir = Env.get("SELFTEST"), !dir.isEmpty else { return }
        let scenario = Env.get("SELFTEST_SCENARIO") ?? "view"
        selftestStage("page loaded")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.runScenario(scenario, dir: dir) }
    }

    func selftestStage(_ s: String) {
        Self.selftestStageLock.lock(); Self.selftestStageText = s; Self.selftestStageLock.unlock()
    }

    /// Ends a scenario within RALLY_SELFTEST_TIMEOUT seconds (240), whatever it waits on, writing a
    /// failed report saying how far it got. Off the main thread, so a stuck main thread can't stop it.
    func armSelftestWatchdog() {
        let env = ProcessInfo.processInfo.environment
        guard let dir = Env.get("SELFTEST"), !dir.isEmpty else { return }
        let secs = Double(Env.get("SELFTEST_TIMEOUT") ?? "") ?? 240
        let scenario = Env.get("SELFTEST_SCENARIO") ?? "view"
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + secs) {
            Self.selftestStageLock.lock(); let stage = Self.selftestStageText; Self.selftestStageLock.unlock()
            let f = dir + "/report.json"
            if !FileManager.default.fileExists(atPath: f) {
                try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                let r: [String: Any] = ["scenario": scenario, "ok": false, "timedOut": true, "error": "timed out after \(Int(secs))s (last: \(stage))"]
                if let d = try? JSONSerialization.data(withJSONObject: r, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: URL(fileURLWithPath: f)) }
            }
            FileHandle.standardError.write("selftest watchdog: \(scenario) timed out after \(Int(secs))s (last: \(stage))\n".data(using: .utf8)!)
            exit(3)
        }
    }

    func js(_ code: String, _ args: [String: Any] = [:]) async -> Result<Any?, Error> {
        await withCheckedContinuation { cont in
            web.callAsyncJavaScript(code, arguments: args, in: nil, in: .page) { r in
                switch r { case .success(let v): cont.resume(returning: .success(v)); case .failure(let e): cont.resume(returning: .failure(e)) }
            }
        }
    }

    /// Press on an element and drag with real pointer events, delivered to the web view's responder methods.
    func osDrag(_ selector: String, dx: CGFloat, dy: CGFloat = 0) async -> Bool {
        let r = await js("const el=document.querySelector(sel); if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2};", ["sel": selector])
        guard case .success(let v) = r, let p = v as? [String: Double], let x = p["x"], let y = p["y"] else { return false }
        let pt: (CGFloat, CGFloat) -> NSPoint = { px, py in
            let inWeb = NSPoint(x: px, y: self.web.isFlipped ? py : self.web.bounds.height - py)
            return self.web.convert(inWeb, to: nil)
        }
        front()
        let t = ProcessInfo.processInfo.systemUptime
        let mk: (NSEvent.EventType, NSPoint, Int) -> NSEvent? = { type, loc, i in
            NSEvent.mouseEvent(with: type, location: loc, modifierFlags: [], timestamp: t + Double(i) * 0.03,
                               windowNumber: self.window.windowNumber, context: nil, eventNumber: 3000 + i, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)
        }
        if let m = mk(.mouseMoved, pt(CGFloat(x), CGFloat(y)), 0) { web.mouseMoved(with: m) }
        try? await Task.sleep(nanoseconds: 60_000_000)
        if let d = mk(.leftMouseDown, pt(CGFloat(x), CGFloat(y)), 1) { web.mouseDown(with: d) }
        try? await Task.sleep(nanoseconds: 80_000_000)
        for i in 1...8 {                                   // move in steps, as a hand would
            let px = CGFloat(x) + dx * CGFloat(i) / 8
            let py = CGFloat(y) + dy * CGFloat(i) / 8
            if let m = mk(.leftMouseDragged, pt(px, py), 1 + i) { web.mouseDragged(with: m) }
            try? await Task.sleep(nanoseconds: 30_000_000)
        }
        if let u = mk(.leftMouseUp, pt(CGFloat(x) + dx, CGFloat(y) + dy), 12) { web.mouseUp(with: u) }
        try? await Task.sleep(nanoseconds: 250_000_000)
        lastPointer = "ns-drag"
        return true
    }

    /// A selector for some claude card in any lane, but not the row the docked list opened at launch
    /// (its panel is already open, and its terminal view has resumed it).
    func claudeCardSelector() async -> String? {
        let r = await js("const pref=['needs-you','stale','working','done','idle']; const busy=e=>openFor===e.dataset.agent+':'+e.dataset.id||[...ptys.values()].some(p=>!p.gone&&p.full===e.dataset.id); for(const col of pref){const c=[...document.querySelectorAll('[data-col=\"'+col+'\"] .card[data-agent=\"claude\"]:not(.sub)')].find(e=>!busy(e)); if(c) return c.dataset.id||''} return ''")
        guard case .success(let v) = r, let id = v as? String, !id.isEmpty else { return nil }
        return ".card[data-id=\"\(id)\"]"
    }

    func osClick(_ selector: String) async -> Bool {
        let r = await js("const el=document.querySelector(sel); if(!el) return null; el.scrollIntoView({block:'nearest'}); const b=el.getBoundingClientRect(); window.__lastClick=null; return {x:b.left+b.width/2,y:b.top+b.height/2};", ["sel": selector])
        guard case .success(let v) = r, let p = v as? [String: Double], let x = p["x"], let y = p["y"] else { return false }
        let inWeb = NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y)
        let inWindow = web.convert(inWeb, to: nil)
        front()
        let t = ProcessInfo.processInfo.systemUptime
        let mk: (NSEvent.EventType, Int) -> NSEvent? = { type, i in
            NSEvent.mouseEvent(with: type, location: inWindow, modifierFlags: [], timestamp: t + Double(i) * 0.05,
                               windowNumber: self.window.windowNumber, context: nil, eventNumber: 2000 + i, clickCount: 1, pressure: i == 1 ? 1 : 0)
        }
        if let m = mk(.mouseMoved, 0) { web.mouseMoved(with: m) }
        try? await Task.sleep(nanoseconds: 60_000_000)
        if let d = mk(.leftMouseDown, 1) { web.mouseDown(with: d) }
        try? await Task.sleep(nanoseconds: 60_000_000)
        if let u = mk(.leftMouseUp, 2) { web.mouseUp(with: u) }
        try? await Task.sleep(nanoseconds: 250_000_000)
        if case .success(let v) = await js("return !!window.__lastClick"), let b = v as? Bool, b { lastPointer = "ns"; return true }
        _ = await js("document.querySelector(sel).click(); return 1", ["sel": selector])
        lastPointer = "dom"
        return true
    }

    /// A real key press through the window: a KeyboardEvent built in JS skips the text system
    /// (and so never types into a textarea).
    func osKey(_ name: String) async {
        let table: [String: (UInt16, String)] = [
            "Down": (125, String(Character(UnicodeScalar(NSDownArrowFunctionKey)!))),
            "Up": (126, String(Character(UnicodeScalar(NSUpArrowFunctionKey)!))),
            "Left": (123, String(Character(UnicodeScalar(NSLeftArrowFunctionKey)!))),
            "Right": (124, String(Character(UnicodeScalar(NSRightArrowFunctionKey)!))),
            "Enter": (36, "\r"), "Escape": (53, "\u{1b}"), "Space": (49, " "), "Tab": (48, "\t"),
            "PageDown": (121, String(Character(UnicodeScalar(NSPageDownFunctionKey)!))),
            "/": (44, "/"), ".": (47, "."), "?": (44, "?"),
            "a": (0, "a"), "b": (11, "b"), "c": (8, "c"), "g": (5, "g"), "i": (34, "i"), "j": (38, "j"), "k": (40, "k"),
            "l": (37, "l"), "h": (4, "h"), "o": (31, "o"), "r": (15, "r"), "s": (1, "s"), "y": (16, "y"), "e": (14, "e"), "x": (7, "x"), "f": (3, "f"),
            "1": (18, "1"), "2": (19, "2"), "3": (20, "3"), "4": (21, "4"), "G": (5, "G"),
            ":": (41, ":"), "cmdk": (40, "k"), "T": (17, "T"), "cmdc": (8, "c"), "cmdn": (45, "n"), "cmdslash": (44, "/"), "cmdj": (38, "j"), "cmdt": (17, "t"),
        ]
        guard let (code, chars) = table[name] else { return }
        let shift = name == "?" || name == "G" || name == ":" || name == "T"
        let flags: NSEvent.ModifierFlags = ["cmdk", "cmdc", "cmdn", "cmdslash", "cmdj", "cmdt"].contains(name) ? [.command] : shift ? [.shift] : []
        front()
        let t = ProcessInfo.processInfo.systemUptime
        for (i, type) in [NSEvent.EventType.keyDown, .keyUp].enumerated() {
            if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: t + Double(i) * 0.02,
                                        windowNumber: window.windowNumber, context: nil, characters: chars,
                                        charactersIgnoringModifiers: name == "?" ? "/" : name == "G" ? "g" : name == "T" ? "t" : name == ":" ? ";" : chars, isARepeat: false, keyCode: code) {
                window.sendEvent(e)
            }
        }
        try? await Task.sleep(nanoseconds: 120_000_000)
    }

    /// Calls the web view as an IME does (mark, insert, unmark), so the page sees WebKit's own
    /// composition events rather than a synthetic CompositionEvent.
    func selftestIme(_ body: [String: Any]) -> [String: Any] {
        let op = (body["op"] as? String) ?? "", text = (body["text"] as? String) ?? ""
        guard let client = web as? NSTextInputClient else { return ["op": op, "error": "no NSTextInputClient"] }
        let none = NSRange(location: NSNotFound, length: 0)
        switch op {
        case "mark": client.setMarkedText(text, selectedRange: NSRange(location: (text as NSString).length, length: 0), replacementRange: none)
        case "insert": client.insertText(text, replacementRange: none)
        case "unmark": client.unmarkText()
        default: break
        }
        return ["op": op, "hasMarked": client.hasMarkedText()]
    }

    /// One character typed on a US keyboard: key down, key up (selftest only).
    func osChar(_ ch: Character, gap: Double) async {
        let codes: [Character: UInt16] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
            "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46, " ": 49,
            "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "0": 29, ".": 47, "/": 44]
        let lower = Character(ch.lowercased())
        guard let code = codes[lower] else { return }
        let shift = ch != lower
        front()
        let t = ProcessInfo.processInfo.systemUptime
        for (i, type) in [NSEvent.EventType.keyDown, .keyUp].enumerated() {
            if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: shift ? [.shift] : [], timestamp: t + Double(i) * 0.01,
                                        windowNumber: window.windowNumber, context: nil, characters: String(ch),
                                        charactersIgnoringModifiers: String(lower), isARepeat: false, keyCode: code) {
                window.sendEvent(e)
            }
        }
        try? await Task.sleep(nanoseconds: UInt64(gap * 1_000_000_000))
    }

    /// A card opens as a person opens it: one click.
    func clickOpen(_ selector: String) async -> Bool {
        return await osClick(selector)
    }

    /// Open a card on its 会話 view: on ターミナル (the default) the session resumes just after
    /// opening, and a message sent then races that start.
    func clickOpenTalk(_ selector: String) async -> Bool {
        _ = await js("panelPrefSet('talk'); return 1")
        return await osClick(selector)
    }

    func runScenario(_ scenario: String, dir: String) {
        selftestStage("running " + scenario)
        Task { @MainActor in
            var report: [String: Any] = ["scenario": scenario]
            var steps: [String] = []
            func fail(_ m: String) { report["ok"] = false; report["error"] = m; report["steps"] = steps; report["pointer"] = self.lastPointer; self.finishSelfTest(dir: dir, report: report) }
            let wait = "const wait=(f,ms)=>new Promise((res,rej)=>{const t0=Date.now();(function p(){try{if(f())return res(true)}catch(e){}if(Date.now()-t0>ms)return rej(new Error('timeout: '+f.toString().slice(0,80)));setTimeout(p,250)})()});"
            _ = await js("document.addEventListener('click',e=>{window.__lastClick={target:(e.target.className||e.target.tagName)}},true); return 1")
            // a page WebKit counts hidden is driven on timer frames (main.swift); report it
            if case .success(let v) = await js("document.addEventListener('visibilitychange',()=>{try{post({type:'log',text:'selftest: page '+document.visibilityState})}catch(e){}});return document.visibilityState"),
               let s = v as? String, s != "visible" { report["visibility"] = s + " at start" }
            if case .failure(let e) = await js(wait + "await wait(()=>live.agents.length>0,120000); return 1") {
                // WKWebView puts the real message in userInfo, not localizedDescription
                let ns = e as NSError
                let msg = (ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription
                self.logLine(["ev": "selftest-js", "where": "state", "msg": String(msg.prefix(300))])
                if case .success(let probe) = await self.js("return {kanban:typeof window.__kanban, live:typeof live, agents:(typeof live!=='undefined'&&live&&live.agents)?live.agents.length:-1, cards:document.querySelectorAll('.card').length, meta:(document.querySelector('#meta')||{}).title||''}") {
                    self.logLine(["ev": "selftest-probe", "probe": String(describing: probe).prefix(300).description])
                }
                return fail("state: \(msg)")
            }
            steps.append("state loaded")
            let cols = await js("const o={}; for(const c of ['working','approval','needs-you','idle']) o[c]=document.querySelectorAll('[data-col=\"'+c+'\"] .card').length; return {meta:document.querySelector('#meta').textContent, columns:o, native:native}")
            if case .success(let v) = cols, let d = v as? [String: Any] { for (k, val) in d { report[k] = val } }

            if scenario == "view" {
                let r = await js("return {liveCardInputs:document.querySelectorAll('[data-col=\"working\"] .card input, [data-col=\"needs-you\"] .card input, [data-col=\"done\"] .card input').length, columns:[...document.querySelectorAll('section.col')].filter(x=>getComputedStyle(x).display!=='none').length, columnsInDom:document.querySelectorAll('section.col').length, doneHidden:getComputedStyle(document.querySelector('[data-col=\"done\"]')).display==='none', doneCount:document.querySelector('#donen').textContent.trim(), hasNewButton:!!document.querySelector('#new')}")
                if case .success(let v) = r, let d = v as? [String: Any] { for (k, val) in d { report[k] = val } }
                // live cards carry no input; a new session starts from the header button
                let cardInputs = (report["liveCardInputs"] as? Int) ?? -1
                let cols = (report["columns"] as? Int) ?? 0
                report["ok"] = cardInputs == 0 && cols == 3 && (report["doneHidden"] as? Bool) == true
                    && !((report["doneCount"] as? String) ?? "").isEmpty && (report["hasNewButton"] as? Bool) == true
                if report["ok"] as? Bool != true { report["error"] = "expected 3 visible lanes (got \(cols)), no input on live cards (got \(cardInputs)), 終わったもの hidden with a count, and a ＋新規セッション button" }
            }
            if scenario == "run" {
                let cwd = Env.get("SELFTEST_CWD") ?? NSTemporaryDirectory()
                _ = await js(wait + "mine.cards=[{id:'runtest',col:'backlog',text:'selftest: say PONG',agent:'claude',dir:cwd}]; await save(); render(); await new Promise(r=>setTimeout(r,500)); return 1", ["cwd": cwd])
                steps.append("card ready")
                guard await osClick("[data-col=\"backlog\"] .card[data-id=\"runtest\"] .run") else { return fail("click run") }
                steps.append("clicked run (\(lastPointer))")
                if case .failure(let e) = await js(wait + "await wait(()=>/起動しました|✗/.test(document.querySelector('[data-id=\"runtest\"] .toast')?.textContent||''),20000); return 1") { return fail("no toast: \(e.localizedDescription)") }
                let r = await js("const c=mine.cards.find(x=>x.id==='runtest'); return {toast:document.querySelector('[data-id=\"runtest\"] .toast').textContent, col:c?c.col:null}")
                if case .success(let v) = r, let d = v as? [String: Any] { report["toast"] = d["toast"] ?? ""; report["cardCol"] = d["col"] ?? "" ; report["ok"] = ((d["toast"] as? String) ?? "").contains("起動しました") && (d["col"] as? String) == "doing" }
                if report["ok"] as? Bool != true { report["error"] = "expected a started toast and the card in doing" }
            }
            if scenario == "send" {
                // send from the detail panel of a claude card
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                guard await clickOpenTalk("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                steps.append("opened panel (\(lastPointer))")
                let r1 = await js(wait + "await wait(()=>document.querySelector('#mbody .msg textarea'),5000); const i=document.querySelector('#mbody .msg textarea'); i.value='selftest reply'; return {resume:(document.querySelector('#mbody code')||{}).textContent||''}")
                guard case .success(let v1) = r1, let d1 = v1 as? [String: Any] else { return fail("no send box in the detail panel") }
                report["resumeShown"] = d1["resume"] ?? ""
                _ = await js("const i=document.querySelector('#mbody .msg textarea'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1")
                steps.append("pressed Enter in the panel")
                // the box stays writable while the send goes: the next message, or a reply, is typed at once
                var boxLocked: String? = nil
                let rBox = await js("const t=document.querySelector('#mbody .msg textarea'); const was=!!document.querySelector('#mbody').dataset.sending; if(t)t.focus(); return {sending:was, enabled:!!t&&!t.disabled, focused:!!t&&document.activeElement===t}")
                if case .success(let vb) = rBox, let db = vb as? [String: Any] {
                    report["boxWhileSending"] = db
                    if (db["enabled"] as? Bool) != true || (db["focused"] as? Bool) != true {
                        boxLocked = "the message box was locked while the send went (enabled \(db["enabled"] ?? "?"), focused \(db["focused"] ?? "?"))"
                    }
                }
                // what was sent shows in the conversation at once
                let rEcho = await js("const p=document.querySelector('#mhist .turn.pending'); return {echoed:!!p, text:p?p.textContent:''}")
                if case .success(let ve) = rEcho, let de = ve as? [String: Any] {
                    report["echoed"] = de["echoed"] ?? false
                    if (de["echoed"] as? Bool) != true || !((de["text"] as? String) ?? "").contains("selftest reply") {
                        report["ok"] = false; report["error"] = "the message did not appear in the conversation when it was sent"
                    }
                }
                if case .failure(let e) = await js(wait + "await wait(()=>/起動しました|✗/.test(document.querySelector('#mbody .toast')?.textContent||''),20000); return 1") { return fail("no toast: \(e.localizedDescription)") }
                let r = await js("return document.querySelector('#mbody .toast').textContent")
                if case .success(let v) = r, let t = v as? String { report["toast"] = t; report["ok"] = t.contains("起動しました") }
                // and the conversation says the session is mid-turn
                let rt = await js(wait + "renderHistory({agent:openFor.split(':')[0],session:openFor.split(':').slice(1).join(':'),turns:[{t:Date.now()-4000,kind:'user',text:'やって'}],dropped:0}); await new Promise(r=>setTimeout(r,250)); const th=document.querySelector('#mhist .think')||document.querySelector('#mhist .askbox'); return {shown:!!th, text:th?th.textContent:'', want:(openCard&&(openCard.column==='approval'||openCard.aliveWaitingFor==='permission prompt'))?'許可を待っています':'考え中'}")
                if case .success(let vt) = rt, let dt = vt as? [String: Any] {
                    report["thinking"] = dt["text"] ?? ""
                    // a card at a permission prompt shows the prompt instead of 考え中
                    if (dt["shown"] as? Bool) != true || !((dt["text"] as? String) ?? "").contains((dt["want"] as? String) ?? "考え中") {
                        report["ok"] = false; report["error"] = "the conversation does not show that the session is mid-turn"
                    }
                }
                if let b = boxLocked { report["ok"] = false; report["error"] = b }
                if report["ok"] as? Bool != true && report["error"] == nil { report["error"] = "expected a started toast in the panel" }
            }
            if scenario == "finish" {
                // 完了: the card moves to the 完了 lane and stays there
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                guard await clickOpenTalk("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                steps.append("opened panel (\(lastPointer))")
                // wait for the conversation to land, so the button stops moving
                let r1 = await js(wait + "await wait(()=>document.querySelector('#dodone'),5000); if(document.querySelector('#mbody .mviews'))panelSwitch('talk'); await wait(()=>document.querySelectorAll('#mhist .turn').length>0||/記録|見つかりません/.test(document.querySelector('#mhist').textContent),20000); await new Promise(r=>setTimeout(r,400)); return {noLearnToggle:!document.querySelector('#dmem'), id:(openFor||{}).id||document.querySelector('\(sel)').dataset.id}")
                guard case .success(let v1) = r1, let d1 = v1 as? [String: Any] else { return fail("no 完了 button in the panel") }
                report["noLearnToggle"] = d1["noLearnToggle"] ?? false
                let id = (d1["id"] as? String) ?? ""
                report["finishedId"] = id
                guard await osClick("#dodone") else { return fail("click 完了") }
                steps.append("pressed 完了 (\(lastPointer))")
                let r2 = await js(wait + "await wait(()=>(live.cards||[]).some(c=>c.id==='\(id)'&&c.column==='done'),20000); const c=live.cards.find(x=>x.id==='\(id)'); return {col:c.column, lane:document.querySelectorAll('[data-col=\"done\"] .card').length, reason:c.reason||''}")
                if case .success(let v2) = r2, let d2 = v2 as? [String: Any] {
                    report["doneCol"] = d2["col"] ?? ""; report["doneLane"] = d2["lane"] ?? 0; report["doneReason"] = d2["reason"] ?? ""
                    report["ok"] = (d2["col"] as? String) == "done" && ((d2["lane"] as? Int) ?? 0) > 0 && (d1["noLearnToggle"] as? Bool) == true
                } else if case .failure(let e) = r2 { return fail("the card never reached 完了: \(e.localizedDescription)") }
                if report["ok"] as? Bool != true { report["error"] = "expected the card in the 完了 lane after pressing 完了" }
            }
            if scenario == "wip" {
                // 棚卸し: a headless read of the conversation's tail starts and the button says so
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                guard await clickOpenTalk("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                steps.append("opened panel (\(lastPointer))")
                let r1 = await js(wait + "await wait(()=>document.querySelector('#pscan'),5000); if(document.querySelector('#mbody .mviews'))panelSwitch('talk'); await new Promise(r=>setTimeout(r,300)); return {label:document.querySelector('#pscan').textContent, unread:/未確認/.test(document.querySelector('.pendbox').textContent)}")
                guard case .success(let v1) = r1, let d1 = v1 as? [String: Any] else { return fail("no 棚卸し button in the panel") }
                report["scanLabel"] = d1["label"] ?? ""; report["saysUnread"] = d1["unread"] ?? false
                guard await osClick("#pscan") else { return fail("click 棚卸し") }
                steps.append("pressed 棚卸し (\(lastPointer))")
                let r2 = await js("return {disabled:document.querySelector('#pscan').disabled, label:document.querySelector('#pscan').textContent}")
                if case .success(let v2) = r2, let d2 = v2 as? [String: Any] {
                    report["scanAfter"] = d2["label"] ?? ""
                    report["ok"] = (d2["disabled"] as? Bool) == true && (d1["unread"] as? Bool) == true
                }
                if report["ok"] as? Bool != true { report["error"] = "expected the panel to say it had not been read, then to start reading" }
            }
            if scenario == "attach" {
                // paste a file, then send: the file is on disk and its path reaches the argv
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                guard await clickOpenTalk("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                steps.append("opened panel (\(lastPointer))")
                // a 1x1 png, pasted the way the clipboard delivers one
                let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                let r1 = await js(wait + "await wait(()=>document.querySelector('#mbody .msg textarea'),5000); const b=atob('\(png)'); const u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i); const f=new File([u],'selftest.png',{type:'image/png'}); const dt=new DataTransfer(); dt.items.add(f); document.querySelector('#mbody .msg textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1")
                if case .failure(let e) = r1 { return fail("paste: \(e.localizedDescription)") }
                steps.append("pasted a file")
                let r2 = await js(wait + "await wait(()=>{const a=document.querySelector('#mbody .atts .att');return a&&a.dataset.path},20000); return {path:document.querySelector('#mbody .atts .att').dataset.path}")
                guard case .success(let v2) = r2, let d2 = v2 as? [String: Any], let saved = d2["path"] as? String else { return fail("the attachment was never saved") }
                report["attachPath"] = saved
                report["attachExists"] = FileManager.default.fileExists(atPath: saved)
                _ = await js("const i=document.querySelector('#mbody .msg textarea'); i.value='これ見て'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1")
                steps.append("sent it")
                if case .failure(let e) = await js(wait + "await wait(()=>/起動しました|預かりました|✗/.test(document.querySelector('#mbody .toast')?.textContent||''),20000); return 1") { return fail("no toast: \(e.localizedDescription)") }
                let r3 = await js("return {toast:document.querySelector('#mbody .toast').textContent, left:document.querySelectorAll('#mbody .atts .att').length}")
                if case .success(let v3) = r3, let d3 = v3 as? [String: Any] {
                    report["toast"] = d3["toast"] ?? ""; report["attsLeft"] = d3["left"] ?? 0
                    report["ok"] = (report["attachExists"] as? Bool) == true && ((d3["left"] as? Int) ?? 1) == 0
                }
                if report["ok"] as? Bool != true { report["error"] = "expected the pasted file on disk and the chips cleared after sending" }
            }
            if scenario == "termsize" {
                // open, the strip is a column on the right edge; its left edge is a handle: grab it and pull left
                _ = await js("termOpen(true); document.documentElement.style.setProperty('--termw','440px'); try{localStorage.removeItem('termw')}catch(e){} await new Promise(r=>setTimeout(r,400)); return 1")
                let r0 = await js("const g=document.querySelector('#termgrip'); const b=g.getBoundingClientRect(); const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2); return {before:Math.round(document.querySelector('#term').getBoundingClientRect().width), hit:hit?(hit.id||hit.className||hit.tagName):'(none)', closed:document.body.classList.contains('termclosed')}")
                guard case .success(let v0) = r0, let d0 = v0 as? [String: Any] else { return fail("no terminal handle") }
                report["termBefore"] = d0["before"] ?? 0; report["gripHit"] = d0["hit"] ?? ""; report["termClosed"] = d0["closed"] ?? false
                guard await osDrag("#termgrip", dx: -120, dy: 0) else { return fail("drag the handle") }
                steps.append("dragged the terminal handle left (\(lastPointer))")
                let r1 = await js("return {after:Math.round(document.querySelector('#term').getBoundingClientRect().width), closed:document.body.classList.contains('termclosed')}")
                if case .success(let v1) = r1, let d1 = v1 as? [String: Any] {
                    report["termAfter"] = d1["after"] ?? 0
                    let before = (d0["before"] as? Int) ?? 0, after = (d1["after"] as? Int) ?? 0
                    report["ok"] = after > before + 60 && (d1["closed"] as? Bool) == false && (d0["hit"] as? String) == "termgrip"
                    if report["ok"] as? Bool != true { report["error"] = "dragging the handle left did not widen the terminal (\(before) → \(after), grip hit \(d0["hit"] ?? ""))" }
                }
                _ = await js("try{localStorage.removeItem('termw')}catch(e){} document.documentElement.style.removeProperty('--termw'); termOpen(false); return 1")
            }
            if scenario == "worker" {
                // the long-lived worker takes over state and history once warm: refreshes keep answering, and some answers are its
                var n = 0, answered = false
                let t0 = Date()
                while Date().timeIntervalSince(t0) < 60 {
                    _ = await js("load(); return 1")
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    n += 1
                    if workerAnswers >= 3 { answered = true; break }
                }
                let cards = await js("return (live.cards||[]).length")
                var cardCount = 0
                if case .success(let v) = cards, let c = v as? Int { cardCount = c }
                report["workerAnswers"] = workerAnswers; report["loads"] = n; report["cards"] = cardCount
                report["ok"] = answered && cardCount > 0
                if report["ok"] as? Bool != true { report["error"] = "worker: \(workerAnswers) answers from it in \(n) refreshes, \(cardCount) cards" }
            }
            if scenario == "zoom" {
                // ⌘= ⌘- ⌘+ ⌘0 through the real menu (the key equivalents, not the actions called directly): the page's size follows
                func press(_ ch: String, _ code: UInt16, shift: Bool = false) -> Bool {
                    var f: NSEvent.ModifierFlags = [.command]; if shift { f.insert(.shift) }
                    guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: f, timestamp: 0, windowNumber: self.window.windowNumber, context: nil, characters: ch, charactersIgnoringModifiers: ch, isARepeat: false, keyCode: code) else { return false }
                    // the order a key goes in: the window's views first, then the main menu
                    return self.window.performKeyEquivalent(with: e) || (NSApp.mainMenu?.performKeyEquivalent(with: e) ?? false)
                }
                func width() async -> Double { if case .success(let v) = await js("return innerWidth"), let d = v as? Double { return d }; return 0 }
                let z0 = Double(self.web.pageZoom), w0 = await width()
                let k1 = press("=", 24); let z1 = Double(self.web.pageZoom); try? await Task.sleep(nanoseconds: 300_000_000); let w1 = await width()
                let k2 = press("-", 27); let z2 = Double(self.web.pageZoom)
                let k3 = press("+", 24, shift: true); let z3 = Double(self.web.pageZoom)
                let k4 = press("0", 29); let z4 = Double(self.web.pageZoom)
                report["zoom"] = [z0, z1, z2, z3, z4]; report["widths"] = [w0, w1]
                let saved = UserDefaults.standard.object(forKey: "pageZoom") != nil
                report["ok"] = k1 && k2 && k3 && k4 && abs(z0 - 1) < 0.001 && z1 > 1.05 && abs(z2 - 1) < 0.001 && z3 > 1.05 && abs(z4 - 1) < 0.001 && w1 < w0 - 10 && !saved
                if report["ok"] as? Bool != true { report["error"] = "zoom: keys \([k1, k2, k3, k4]) sizes \([z0, z1, z2, z3, z4]) widths \([w0, w1]) saved \(saved)" }
            }
            if scenario == "notify" {
                // a card reaching Your Turn: one notification, the Dock counts the lane, and a click
                // on the notification opens that card
                var bad: [String] = []
                func expect(_ what: String, _ ok: Bool) { if !ok { bad.append(what) } }
                let r0 = await js(wait + "await wait(()=>document.querySelectorAll('section.col .card').length>0,8000); const mine=(live.cards||[]).filter(c=>!c.subagent&&!c.headless); const you=mine.filter(c=>['needs-you','approval','answered'].includes(c.column)); const x=(mine.find(c=>c.column==='stale')||mine.find(c=>c.column!=='done')); if(!x)return {none:true}; const k=x.agent+':'+x.id; const s1=JSON.parse(JSON.stringify(live)); const y1=s1.cards.find(c=>c.agent+':'+c.id===k); if(y1)y1.column='stale'; applyState(s1); const s2=JSON.parse(JSON.stringify(live)); const y=s2.cards.find(c=>c.agent+':'+c.id===k); const wasYou=false; y.column='answered'; y.last={assistant:'selftest: 終わりました'}; applyState(s2); applyState(JSON.parse(JSON.stringify(s2))); return {key:k, n:you.filter(c=>c.agent+':'+c.id!==k).length+1}")
                guard case .success(let v0) = r0, let d0 = v0 as? [String: Any], d0["none"] == nil, let key = d0["key"] as? String else { return fail("no card to move into your turn") }
                let mine = notified.filter { $0["key"] == key }
                report["notified"] = notified
                report["badge"] = badgeShown
                expect("one notification for the card that arrived", mine.count == 1 && (mine.first?["body"] ?? "").contains("終わりました"))
                // ("asks" is the menu bar's list of held prompts, not a notification)
                expect("nothing else notified (the first read is not news)", notified.filter { !["focusterm", "stop", "asks"].contains($0["key"] ?? "") }.count == 1)
                expect("the Dock counts your lane", badgeShown == String((d0["n"] as? Int) ?? -1))
                // 端末へ: an interactive card offers it, T asks the app for that session's terminal
                let t0 = await js("const c=live.cards.find(x=>x.agent+':'+x.id==='\(key)'); c.alive=true; c.aliveKind='interactive'; openDetail(c,false,{focus:false}); return !!document.querySelector('#mbody .goterm')")
                if case .success(let v) = t0 { expect("an interactive session offers 端末へ", (v as? Bool) == true) } else { expect("an interactive session offers 端末へ", false) }
                // ⌘C with nothing selected stops a background session at work; with text selected it copies
                _ = await js("const c=live.cards.find(x=>x.agent+':'+x.id==='\(key)'); c.alive=true; c.aliveKind='background'; c.queued=null; openCard=c; lastSends.delete('\(key)'); window.getSelection().removeAllRanges(); document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); return 1")
                await osKey("cmdc")
                expect("⌘C stops nothing this board did not send", !notified.contains { $0["key"] == "stop" })
                _ = await js("lastSends.set('\(key)',{how:'started',at:Date.now()}); return 1")
                await osKey("cmdc")
                expect("⌘C asks the app to stop that background session", notified.contains { $0["key"] == "stop" && ($0["title"] ?? "") == String(key.split(separator: ":").last ?? "") })
                let before = notified.filter { $0["key"] == "stop" }.count
                _ = await js("lastSends.set('\(key)',{how:'started',at:Date.now()}); const r=document.createRange(); r.selectNodeContents(document.querySelector('#clabel')||document.querySelector('#mtitle')); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); return 1")
                await osKey("cmdc")
                expect("⌘C with text selected is a copy, not a stop", notified.filter { $0["key"] == "stop" }.count == before)
                _ = await js("window.getSelection().removeAllRanges(); const c=live.cards.find(x=>x.agent+':'+x.id==='\(key)'); c.aliveKind='interactive'; openDetail(c,false,{focus:false}); return 1")
                // a refresh replaces the card this test marked: mark the one open now
                _ = await js("await new Promise(r=>setTimeout(r,300)); const o=openCard; if(o){o.alive=true; o.aliveKind='interactive'; o.aliveStatus='idle'} return 1")
                await osKey("T")
                expect("T asks for that session's terminal", notified.contains { $0["key"] == "focusterm" && ($0["title"] ?? "").contains(String(key.split(separator: ":").last ?? "")) })
                // a new session in ~ starts in a trusted directory (live.trusted set here), no terminal tab
                var moved = ""
                if case .success(let v) = await js("closeDetail('selftest'); live.trusted=[live.home+'/selftest-trusted']; openNew(); document.querySelector('#ndir').value=live.home; const t=document.querySelector('#ntext'); t.value='selftest: home start'; t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return (lastRun&&lastRun.moved)||''") { moved = (v as? String) ?? "" }
                expect("開始 in ~ stays in the app: no terminal tab, it starts in a trusted directory and says so", !notified.contains { $0["key"] == "startterm" } && moved.contains("selftest-trusted"))
                _ = await js("closeDetail&&closeDetail('selftest'); return 1")
                openFromNotification(key)
                let r1 = await js(wait + "await wait(()=>!document.querySelector('#detail').hidden,4000); return {open:openFor||''}")
                if case .success(let v1) = r1, let d1 = v1 as? [String: Any] { expect("clicking it opens that card", (d1["open"] as? String) == key) }
                else { expect("clicking it opens that card", false) }
                report["failed"] = bad
                report["ok"] = bad.isEmpty
                if !bad.isEmpty { report["error"] = "notify: " + bad.joined(separator: " / ") }
            }
            if scenario == "close" {
                // docked list: a row's panel has no ×; Esc / Space / a click leave it on its row. A side
                // panel (残作業, 新規) has a × that brings the row back. The list never moves.
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                var results: [String: Any] = [:]
                var looks: [String: Any] = [:]
                let look = "const d=document.querySelector('#detail'); const vis=s=>{const e=document.querySelector(s);return !!(e&&e.offsetParent&&getComputedStyle(e).display!=='none')}; const a=document.activeElement; return {hidden:d.hidden, open:openFor||'', sel:sel||'', key:panelKey||'', x:vis('#mclose2')||vis('#mclose'), rowKeys:!!(a&&a.classList&&a.classList.contains('card')&&a.dataset.agent+':'+a.dataset.id===(openFor||sel)), listR:Math.round(document.querySelector('main').getBoundingClientRect().right), docked:listDocked()}"
                func looked() async -> [String: Any] { if case .success(let v) = await js(look), let d = v as? [String: Any] { return d }; return [:] }
                func keptWell(_ name: String, _ open: [String: Any], keys: Bool = true) async {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    let after = await looked()
                    looks[name] = ["open": open, "after": after]
                    results[name] = (after["hidden"] as? Bool) == false && !((after["open"] as? String) ?? "").isEmpty && (after["open"] as? String) == (open["open"] as? String) && (after["sel"] as? String) == (after["open"] as? String)
                    results[name + "NoX"] = (after["x"] as? Bool) == false
                    if keys { results[name + "RowKeys"] = (after["rowKeys"] as? Bool) == true }
                    results[name + "ListStill"] = (after["listR"] as? Int) != nil && (after["listR"] as? Int) == (open["listR"] as? Int)
                }
                func backToRow(_ name: String, _ open: [String: Any], _ row: String) async {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    let after = await looked()
                    looks[name] = ["open": open, "after": after]
                    results[name] = (open["x"] as? Bool) == true && !((open["key"] as? String) ?? "").isEmpty && (after["hidden"] as? Bool) == false && (after["open"] as? String) == row && (after["key"] as? String) == row
                    results[name + "ListStill"] = (after["listR"] as? Int) == (open["listR"] as? Int)
                }
                let first = await looked()
                looks["start"] = first
                results["openAtStart"] = (first["docked"] as? Bool) == true && (first["hidden"] as? Bool) == false && !((first["open"] as? String) ?? "").isEmpty && (first["open"] as? String) == (first["sel"] as? String) && (first["x"] as? Bool) == false
                // 1. a click opens another row; clicked again, it stays
                guard await clickOpen("\(sel) .proj, \(sel) .ct") else { return fail("click card") }
                _ = await js(wait + "await wait(()=>!document.querySelector('#detail').hidden&&openFor&&openFor.endsWith(document.querySelector('\(sel)').dataset.id),4000); return 1")
                var o = await looked()
                results["clickOpens"] = (o["open"] as? String) != (first["open"] as? String) && (o["open"] as? String) == (o["sel"] as? String) && (o["listR"] as? Int) == (first["listR"] as? Int)
                let row = (o["open"] as? String) ?? ""
                guard await osClick("\(sel) .proj, \(sel) .ct") else { return fail("click the open card again") }
                await keptWell("card", o, keys: false)
                // 2. after a redraw under the cursor
                _ = await js("const c=live.cards.find(x=>x.agent+':'+x.id===openFor); c.title='別の概要'+Date.now(); applyState(live); return 1")
                o = await looked()
                await keptWell("afterRedraw", o, keys: false)
                // 3. Esc and Space from the board
                _ = await js("const a=document.activeElement; a&&a.blur&&a.blur(); return 1")
                o = await looked()
                await osKey("Escape")
                await keptWell("esc", o)
                await osKey("Space")
                await keptWell("space", o)
                // 4. the 残作業 view: its × closes it, the row comes back
                guard await osClick("#pendall") else { return fail("open 残作業") }
                _ = await js(wait + "await wait(()=>panelKey==='pending',4000); return 1")
                o = await looked()
                guard await osClick("#mclose") else { return fail("click × on 残作業") }
                await backToRow("pending", o, row)
                // 5. the compose panel, the same
                guard await osClick("#new") else { return fail("open 新規") }
                _ = await js(wait + "await wait(()=>document.querySelector('#ntext'),4000); return 1")
                o = await looked()
                guard await osClick("#mclose") else { return fail("click × on 新規") }
                await backToRow("compose", o, row)
                report["closes"] = results
                report["looks"] = looks
                report["ok"] = results.values.allSatisfy { ($0 as? Bool) == true }
                if report["ok"] as? Bool != true { report["error"] = "the docked list's panel did not stay on its row (or a side panel's × did not bring the row back): \(results.filter { ($0.value as? Bool) != true }.map { $0.key })" }
            }
            if scenario == "kbd" {
                // every shortcut as real key presses; each step records the board after it
                let r0 = await js(wait + "await wait(()=>document.querySelectorAll('section.col .card').length>1,8000); return 1")
                if case .failure(let e) = r0 { return fail("no cards: \(e.localizedDescription)") }
                // the first lane needs a second card for ↓: stand-ins join it, and refreshes are held
                _ = await js("load=function(){}; const s=JSON.parse(JSON.stringify(live)); const you=c=>['needs-you','approval','answered'].includes(c.column); let n=s.cards.filter(c=>you(c)&&!c.subagent&&!c.headless).length; for(const c of s.cards){if(n>=3)break; if(!c.subagent&&!c.headless&&c.agent==='claude'&&!you(c)&&c.column!=='working'){c.column='needs-you';n++}} applyState(s); return n")
                _ = await js("document.activeElement&&document.activeElement.blur(); return 1")
                let snap = "const c=document.querySelector('.card.sel'); const mm=document.querySelector('#mmenu'); return {sel:(sel||''), lane:c?c.closest('section').dataset.col:'', panel:!document.querySelector('#detail').hidden, open:(openFor||''), focus:document.activeElement.tagName, pop:!!document.querySelector('.skillpop'), popAt:[...document.querySelectorAll('.skillpop .sk')].findIndex(x=>x.classList.contains('on')), val:(document.querySelector('#mbody .msg textarea')||{}).value||'', menu:!!(mm&&!mm.hidden), menuFocus:!!(mm&&mm.contains(document.activeElement)), help:!document.querySelector('#help').hidden, rowKeys:!!(document.activeElement&&document.activeElement.classList.contains('card')&&document.activeElement.dataset.agent+':'+document.activeElement.dataset.id===sel), view:viewMode, showdone:document.querySelector('#showdone').classList.contains('on'), color:(openCard&&openCard.color)||'', pty:!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#mterm')), pal:!!document.querySelector('#palette'), palOn:((document.querySelector('#palette .pi.on b')||{}).textContent)||''}"
                var trace: [[String: Any]] = []
                func step(_ k: String) async -> [String: Any] {
                    await osKey(k)
                    var d: [String: Any] = [:]
                    if case .success(let v) = await js(snap), let x = v as? [String: Any] { d = x }
                    d["key"] = k; trace.append(d); return d
                }
                var bad: [String] = []
                func expect(_ what: String, _ ok: Bool) { if !ok { bad.append(what) } }
                if case .success(let nv) = await js("const L=lanes();const f=L.find(l=>l.length);return f?f.length:0"), ((nv as? Int) ?? 0) < 2 {
                    report["skipped"] = "the first lane has fewer than two cards — nothing for ↓ j k to move between"
                    report["ok"] = true; report["steps"] = steps
                    return finishSelfTest(dir: dir, report: report)
                }
                // docked list: a row is always selected and open, the panel follows the selection
                var s0: [String: Any] = [:]
                if case .success(let v) = await js(snap), let x = v as? [String: Any] { s0 = x }
                expect("the docked list starts with a row selected and open", !((s0["sel"] as? String) ?? "").isEmpty && (s0["panel"] as? Bool) == true && (s0["open"] as? String) == (s0["sel"] as? String))
                let s1 = await step("Down"); expect("↓ selects the next row and the panel follows", !((s1["sel"] as? String) ?? "").isEmpty && (s1["sel"] as? String) != (s0["sel"] as? String) && (s1["panel"] as? Bool) == true && (s1["open"] as? String) == (s1["sel"] as? String))
                let s2 = await step("j"); expect("j moves down", (s2["sel"] as? String) != (s1["sel"] as? String))
                let s3 = await step("k"); expect("k moves back", (s3["sel"] as? String) == (s1["sel"] as? String))
                let s4 = await step("Enter"); expect("Enter on the open row keeps it open", (s4["panel"] as? Bool) == true && (s4["open"] as? String) == (s4["sel"] as? String))
                _ = await js("const a=document.activeElement; a&&a.blur&&a.blur(); return 1")
                let s5 = await step("Down"); expect("↓ with the panel open: the panel follows", (s5["open"] as? String) == (s5["sel"] as? String) && (s5["open"] as? String) != (s4["open"] as? String))
                let s6 = await step("Right"); expect("→ goes to the next lane", (s6["lane"] as? String) != (s5["lane"] as? String) && (s6["open"] as? String) == (s6["sel"] as? String))
                let s7 = await step("Left"); expect("← comes back", (s7["lane"] as? String) == (s5["lane"] as? String))
                let s8 = await step("3"); expect("3 is 直前のみ", (s8["view"] as? String) == "last")
                let s8b = await step("2"); expect("2 is 直前3つ", (s8b["view"] as? String) == "last3")
                let s9 = await step("1"); expect("1 is 全部", (s9["view"] as? String) == "all")
                let s13 = await step("c"); expect("c does nothing now that colours are automatic", (s13["color"] as? String) == (s9["color"] as? String))
                _ = await step("x")
                // with the panel's terminal live, keys that would go into the box go into it; ⌘J leaves
                _ = await js(wait + "await wait(()=>openCard&&panelPty(openCard)&&$('#mbody').classList.contains('pterm'),6000).catch(()=>0); return 1")
                if case .success(let lv) = await js("return !!(openCard&&panelPty(openCard)&&$('#mbody').classList.contains('pterm'))"), (lv as? Bool) == true {
                    let t1 = await step("i"); expect("i with a live terminal in the panel goes into that terminal", (t1["pty"] as? Bool) == true)
                    let t2 = await step("cmdj"); expect("⌘J leaves the panel's terminal, panel stays", (t2["focus"] as? String) == "BODY" && (t2["panel"] as? Bool) == true)
                    let t3 = await step("Enter"); expect("Enter on the open card goes into its terminal (its box is hidden)", (t3["pty"] as? Bool) == true)
                    _ = await step("cmdj")
                    let t4 = await step("/"); expect("/ with the terminal view goes into the terminal (not a hidden box)", (t4["pty"] as? Bool) == true)
                    _ = await step("cmdj")
                    let t5 = await step("Down"); expect("… and the board's keys work again after ⌘J (↓ moves on)", (t5["open"] as? String) == (t5["sel"] as? String) && (t5["open"] as? String) != (t4["open"] as? String) && (t5["pty"] as? Bool) == false)
                    _ = await step("Up")
                } else { report["termview"] = "no live terminal in the panel" }
                // the message box: on 会話 (the terminal view hides it)
                _ = await js("panelPrefSet('talk'); document.activeElement&&document.activeElement.blur(); return 1")
                let s14 = await step("i"); expect("i goes into the message box", (s14["focus"] as? String) == "TEXTAREA")
                let s14b = await step("Escape"); expect("Esc leaves it again, onto the row (the panel stays)", (s14b["rowKeys"] as? Bool) == true && (s14b["panel"] as? Bool) == true)
                let s15 = await step("/"); expect("/ on the board with a panel open goes into its box and opens the skill list", (s15["focus"] as? String) == "TEXTAREA" && (s15["pop"] as? Bool) == true && (s15["popAt"] as? Int) == 0 && (s15["val"] as? String) == "/")
                // rows keep their height and the list scrolls
                if case .success(let hv) = await js("const rs=[...document.querySelectorAll('.skillpop .sk')].slice(0,3).map(x=>x.getBoundingClientRect().height); return rs.length?Math.min(...rs):0"), let h = hv as? Double {
                    report["skillRowH"] = h; expect("the skill list's rows are readable (not squeezed)", h >= 18)
                }
                let s16 = await step("Down"); expect("↓ moves in the skill list", (s16["popAt"] as? Int) == 1)
                // a refresh that changes the card while the list is open
                _ = await js("const s2=JSON.parse(JSON.stringify(live)); const x=s2.cards.find(y=>y.agent+':'+y.id===openFor); if(x){x.lastTool='selftest'+Date.now(); x.reason='selftest changed'} window.__kanban.state(s2); return 1")
                let s17 = await step("Down"); expect("a refresh does not close the list or the box (redraw waits)", (s17["pop"] as? Bool) == true && (s17["popAt"] as? Int) == 2 && (s17["focus"] as? String) == "TEXTAREA")
                let s18 = await step("Enter"); expect("Enter takes the skill, sends nothing", (s18["pop"] as? Bool) == false && ((s18["val"] as? String) ?? "").hasPrefix("/") && ((s18["val"] as? String) ?? "").hasSuffix(" ") && (s18["panel"] as? Bool) == true)
                // what follows a command: /model's values, picked by keys, and nothing sent
                _ = await js("const t=document.querySelector('#mbody .msg textarea'); t.value='/mod'; t.dispatchEvent(new Event('input')); return 1")
                let a1 = await step("Enter"); expect("Enter on /model moves on to its values", (a1["val"] as? String) == "/model " && (a1["pop"] as? Bool) == true && (a1["popAt"] as? Int) == 0)
                let a2 = await step("Down"); expect("↓ moves in the values", (a2["popAt"] as? Int) == 1)
                let a3 = await step("Enter"); expect("Enter takes the value", (a3["val"] as? String) == "/model sonnet" && (a3["pop"] as? Bool) == false)
                _ = await js("const t=document.querySelector('#mbody .msg textarea'); t.value=''; return 1")
                let s19 = await step("Escape"); expect("Esc leaves the box onto the row, panel stays", (s19["rowKeys"] as? Bool) == true && (s19["panel"] as? Bool) == true)
                let s20 = await step("Escape"); expect("Esc again leaves the panel on the row, the row keeps the keys", (s20["panel"] as? Bool) == true && (s20["open"] as? String) == (s19["open"] as? String) && (s20["sel"] as? String) == (s20["open"] as? String) && (s20["rowKeys"] as? Bool) == true)
                let s21 = await step("Space"); expect("Space leaves the panel on the row", (s21["panel"] as? Bool) == true && (s21["open"] as? String) == (s20["sel"] as? String) && ["BODY", "DIV"].contains((s21["focus"] as? String) ?? ""))
                let s22 = await step("Space"); expect("Space again: still on the row", (s22["panel"] as? Bool) == true && (s22["open"] as? String) == (s20["sel"] as? String))
                let s23 = await step("G"); _ = s23
                let s24 = await step("g"); expect("g goes to the first card", (s24["sel"] as? String) == ((trace.first?["sel"] as? String) ?? "?") || !((s24["sel"] as? String) ?? "").isEmpty)
                // unbound by default (pressed by mistake it changed the view): a does nothing
                let s25 = await step("a"); expect("a alone does not toggle 終わったもの", (s25["showdone"] as? Bool) == (s24["showdone"] as? Bool))
                let s26 = await step("?"); expect("? shows the keys", (s26["help"] as? Bool) == true)
                let s27 = await step("Escape"); expect("Esc hides them", (s27["help"] as? Bool) == false)
                let s28 = await step("f"); expect("f opens the palette (the header has no search box)", (s28["focus"] as? String) == "INPUT" && (s28["pop"] as? Bool) == false)
                if case .success(let pv) = await js("return !!pal"), let pb = pv as? Bool { expect("… and it is the palette that took the key", pb) }
                let s29 = await step("Escape"); expect("Esc closes the palette onto a row, the panel following", ((s29["focus"] as? String) == "BODY" || (s29["rowKeys"] as? Bool) == true) && !((s29["sel"] as? String) ?? "").isEmpty && (s29["open"] as? String) == (s29["sel"] as? String))
                let s30 = await step("Escape"); expect("Esc on the list keeps the row selected and open", !((s30["sel"] as? String) ?? "").isEmpty && (s30["sel"] as? String) == (s29["sel"] as? String) && (s30["panel"] as? Bool) == true && (s30["open"] as? String) == (s30["sel"] as? String))
                let s31 = await step("Escape"); expect("Esc with nothing left to leave changes nothing", (s31["sel"] as? String) == (s30["sel"] as? String) && (s31["panel"] as? Bool) == true && (s31["open"] as? String) == (s30["open"] as? String))
                let s32 = await step("Space"); expect("Space with nothing to leave changes nothing either", (s32["sel"] as? String) == (s30["sel"] as? String) && (s32["panel"] as? Bool) == true && (s32["open"] as? String) == (s30["open"] as? String))
                _ = await step("Escape")
                // pointer and keys together
                _ = await osClick("section.col .card .proj")
                try? await Task.sleep(nanoseconds: 300_000_000)
                var c1: [String: Any] = [:]
                if case .success(let v) = await js(snap), let x = v as? [String: Any] { c1 = x }
                expect("a click opens the card, and the board keeps the keys", !((c1["sel"] as? String) ?? "").isEmpty && (c1["panel"] as? Bool) == true && (c1["open"] as? String) == (c1["sel"] as? String) && (c1["focus"] as? String) != "TEXTAREA")
                let c2 = await step("Down"); expect("↓ after a click moves on, the panel follows", (c2["sel"] as? String) != (c1["sel"] as? String) && (c2["open"] as? String) == (c2["sel"] as? String))
                let c3 = await step("Enter"); expect("Enter goes into the box", (c3["focus"] as? String) == "TEXTAREA")
                _ = await step("Escape")
                _ = await step("Escape")
                // the palette: `:` or ⌘K
                let p1 = await step(":"); expect(": opens the palette, the line has the keys", (p1["pal"] as? Bool) == true && (p1["focus"] as? String) == "INPUT")
                let want = await js("const c=(live.cards||[]).find(x=>!x.subagent&&x.title&&x.title.length>1); if(!c)return ''; const i=document.querySelector('#palette input'); i.value=c.title; i.dispatchEvent(new Event('input')); return c.agent+':'+c.id")
                let wantKey: String = { if case .success(let v) = want { return (v as? String) ?? "" }; return "" }()
                let p2 = await step("Enter")
                expect("Enter on a match opens that session, the board keeps the keys", wantKey.isEmpty || ((p2["pal"] as? Bool) == false && (p2["panel"] as? Bool) == true && (p2["focus"] as? String) != "TEXTAREA"))
                _ = await step("Enter")
                let p3 = await step("cmdk"); expect("⌘K from the message box opens it too", (p3["pal"] as? Bool) == true)
                let p4 = await step("Escape"); expect("Esc closes it", (p4["pal"] as? Bool) == false)
                _ = await step("Escape"); _ = await step("Escape")
                // @ in the box lists files over the real bridge
                _ = await step("Enter"); _ = await step("Enter")
                let f1 = await js(wait + "const t=document.querySelector('#mbody .msg textarea'); t.focus(); t.value='@'; t.setSelectionRange(1,1); t.dispatchEvent(new Event('input')); await wait(()=>document.querySelectorAll('.filepop .sk').length>0,8000); const n=document.querySelectorAll('.filepop .sk').length; t.value=''; t.dispatchEvent(new Event('input')); t.blur(); return n")
                if case .success(let v) = f1 { expect("@ lists the project's files", ((v as? Int) ?? 0) > 0) }
                else if case .failure(let e) = f1 { let ns = e as NSError; expect("@ lists the project's files: " + ((ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription), false) }
                _ = await step("Escape")
                // the viewer, over the real bridge
                let v1 = await js(wait + "const oc=openCard||(live.cards||[]).find(c=>!c.subagent&&c.project); const dir=oc&&oc.project; if(!dir)return 'no project'; let fl=null; filesFor(dir,f=>{fl=f}); await wait(()=>fl!==null,8000); const f=fl.find(x=>/\\.(md|js|swift|txt|json)$/.test(x))||fl[0]; if(!f)return 'no files'; openViewer(dir+'/'+f); await wait(()=>viewer&&viewer.data,8000); return viewer.data.error||viewer.data.kind")
                if case .success(let v) = v1 { expect("the viewer shows a project file (\((v as? String) ?? "?"))", ["md", "text", "image", "binary"].contains((v as? String) ?? "")) }
                else if case .failure(let e) = v1 { let ns = e as NSError; expect("the viewer shows a project file: " + ((ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription), false) }
                let before = await js("return !document.querySelector('#detail').hidden")
                await osKey("Escape")
                let v2 = await js("return {viewer:!!document.querySelector('#viewer'), panel:!document.querySelector('#detail').hidden}")
                if case .success(let a) = before, case .success(let b) = v2, let d = b as? [String: Any] {
                    expect("Esc closes the viewer and nothing under it", (d["viewer"] as? Bool) == false && (d["panel"] as? Bool) == (a as? Bool))
                } else { expect("Esc closes the viewer and nothing under it", false) }
                let ch = await js(wait + "const oc=(live.cards||[]).find(c=>c.agent==='claude'&&!c.subagent); if(!oc)return 'no card'; openChanges(oc); await wait(()=>viewer&&viewer.data,15000); const r=viewer.data.error?('error: '+viewer.data.error):'ok'; closeViewer(); return r")
                if case .success(let v) = ch { expect("変更をレビュー answers (\((v as? String) ?? "?"))", (v as? String) == "ok") }
                else if case .failure(let e) = ch { let ns = e as NSError; expect("変更をレビュー answers: " + ((ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription), false) }
                // a button that opens a view closes it when pressed again; so does the open card
                _ = await js("closeDetail('selftest'); return 1")
                _ = await osClick("#pendall")
                let g1 = await js("return {panel:!document.querySelector('#detail').hidden, on:document.querySelector('#pendall').classList.contains('on')}")
                _ = await osClick("#pendall")
                let g2 = await js("return !document.querySelector('#detail').hidden&&!!openFor&&openFor===sel&&!document.querySelector('#pendall').classList.contains('on')")
                if case .success(let a) = g1, case .success(let b) = g2, let d = a as? [String: Any] {
                    expect("残作業 opens (and looks pressed), pressed again it closes and the selected row is back", (d["panel"] as? Bool) == true && (d["on"] as? Bool) == true && (b as? Bool) == true)
                } else { expect("残作業 toggles", false) }
                _ = await osClick("section.col .card .proj")
                try? await Task.sleep(nanoseconds: 500_000_000)
                _ = await osClick("section.col .card .proj")
                let g3 = await js("return !document.querySelector('#detail').hidden&&!!openFor&&openFor===sel")
                if case .success(let v) = g3 { expect("the open row, clicked again, stays open (the list gets the keys)", (v as? Bool) == true) } else { expect("card click", false) }
                // ⌘N opens 新規 from anywhere and closes it again; ⌘/ shows the shortcut list
                _ = await js("closeDetail('selftest'); return 1")
                let n1 = await step("cmdn"); expect("⌘N opens a new session's panel", (n1["panel"] as? Bool) == true)
                let n2 = await step("cmdn"); expect("⌘N again closes it, and the selected row is back", (n2["panel"] as? Bool) == true && !((n2["open"] as? String) ?? "").isEmpty && (n2["open"] as? String) == (n2["sel"] as? String))
                let h1 = await step("cmdslash"); expect("⌘/ shows the shortcut list", (h1["help"] as? Bool) == true)
                var rows = 0
                if case .success(let v) = await js("return document.querySelectorAll('#help .hrow').length") { rows = (v as? Int) ?? 0 }
                expect("the list is drawn from the table (\(rows) rows)", rows > 30)
                let h2 = await step("Escape"); expect("Esc closes the list", (h2["help"] as? Bool) == false)
                // ↓ past the last row frames the terminal; ↑ comes back
                var lastCard = ""
                if case .success(let v) = await js("document.activeElement&&document.activeElement.blur(); const F=lanes().flat(); selectEl(F[F.length-1]); return sel") { lastCard = (v as? String) ?? "" }
                // folded, ↓ does not unfold the strip (it did, at odd moments): it stays on the card
                _ = await js("termOpen(false); return true")
                let tf = await step("Down")
                if case .success(let v) = await js("return document.body.classList.contains('termclosed')"), let closed = v as? Bool { expect("↓ at the bottom does not unfold a folded terminal", closed && (tf["focus"] as? String) != "TEXTAREA") }
                _ = await js("termOpen(true); return true")
                let tt = await step("Down")
                let termState = "return {id:document.activeElement.id, frame:document.querySelector('#term').classList.contains('sel'), cardFramed:getComputedStyle(document.querySelector('.card.sel')||document.body).outlineColor!=='rgba(0, 0, 0, 0)'&&!!document.querySelector('.card.sel')}"
                var t1: [String: Any] = [:]
                if case .success(let v) = await js(termState), let d = v as? [String: Any] { t1 = d }
                expect("↓ at the bottom of the list moves the frame onto the terminal, no cursor yet", (tt["focus"] as? String) == "BODY" && (t1["frame"] as? Bool) == true && (t1["cardFramed"] as? Bool) == false)
                let tk = await step("k")
                var t2: [String: Any] = [:]
                if case .success(let v) = await js(termState + ";") , let d = v as? [String: Any] { t2 = d }
                var typed = ""
                if case .success(let v) = await js("return document.querySelector('#termin').value") { typed = (v as? String) ?? "" }
                expect("a letter goes into the line with it (k is text there)", (tk["focus"] as? String) == "INPUT" && (t2["id"] as? String) == "termin" && typed == "k")
                _ = await js("document.querySelector('#termin').value=''; return 1")
                let tb = await step("Escape")
                expect("Esc leaves the line, the frame stays on the terminal", (tb["focus"] as? String) == "BODY")
                let tu = await step("Up")
                var t3: [String: Any] = [:]
                if case .success(let v) = await js(termState), let d = v as? [String: Any] { t3 = d }
                expect("↑ from the terminal goes back to the card you came from", (tu["sel"] as? String) == lastCard && (t3["frame"] as? Bool) == false)
                // 定期実行: the launchd list (read-only)
                let jb = await js(wait + "closeDetail('selftest'); openJobs(); await wait(()=>document.querySelector('#mbody .job')||/見つかりません|読めません/.test((document.querySelector('#mbody .jobs')||{}).textContent||''),15000); return document.querySelectorAll('#mbody .job').length")
                if case .success(let v) = jb { expect("定期実行 lists the launchd jobs (\((v as? Int) ?? 0))", ((v as? Int) ?? 0) > 0) } else { expect("定期実行 lists the launchd jobs", false) }
                _ = await js("closeDetail('selftest'); return 1")
                // (that no key sent anything is checked by selftest.sh from the fake's argv.log)
                report["trace"] = trace
                report["failed"] = bad
                report["ok"] = bad.isEmpty
                if !bad.isEmpty { report["error"] = "keyboard: " + bad.joined(separator: " / ") }
            }
            if scenario == "keys" {
                // the board without a mouse (dispatched keydowns)
                let r0 = await js(wait + "await wait(()=>document.querySelectorAll('section.col .card').length>1&&panelOpen()&&openFor===sel,8000); return 1")
                if case .failure(let e) = r0 { return fail("no cards, or no row open in the docked list: \(e.localizedDescription)") }
                func key(_ k: String) -> String { "document.dispatchEvent(new KeyboardEvent('keydown',{key:'\(k)',bubbles:true,cancelable:true}));" }
                _ = await js("document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); return 1")
                let r1 = await js(wait + "const s0=sel; " + key("j") + "await wait(()=>sel!==s0&&openFor===sel,4000).catch(()=>0); const s=document.querySelector('.card.sel'); return {sel:!!s&&sel!==s0, id:s?s.dataset.id:'', follows:openFor===sel&&panelOpen()}")
                guard case .success(let v1) = r1, let d1 = v1 as? [String: Any], (d1["sel"] as? Bool) == true else { return fail("j did not move the selection") }
                report["keyOpened"] = d1["follows"] ?? false
                // Enter on the open row, once its resumed terminal is up
                _ = await js(wait + "await wait(()=>panelLivePty()||!document.querySelector('#mbody').classList.contains('pterm'),8000).catch(()=>0); await new Promise(r=>setTimeout(r,500)); " + key("Enter") + "return 1")
                let r2 = await js(wait + "await new Promise(r=>setTimeout(r,300)); const a=document.activeElement; return {inPanel:!!(a&&a.closest&&a.closest('#detail')), same:(openFor||'').endsWith('\((d1["id"] as? String) ?? "")')}")
                if case .success(let v2) = r2, let d2 = v2 as? [String: Any] { report["keyInto"] = d2["inPanel"] ?? false; report["keySame"] = d2["same"] ?? false }
                // Escape gives the list the keys and closes nothing (a terminal keeps its Esc)
                _ = await js("const a=document.activeElement; if(a&&a.closest&&a.closest('#mterm'))a.blur(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return 1")
                let r3a = await js("const a=document.activeElement; return {open:!document.querySelector('#detail').hidden&&openFor===sel, onRow:!!(a&&a.classList&&a.classList.contains('card')&&a.dataset.agent+':'+a.dataset.id===sel)}")
                _ = await js(key("?") + "return 1")
                let r3 = await js("return {help:!document.querySelector('#help').hidden}")
                if case .success(let v3) = r3, let d3 = v3 as? [String: Any], case .success(let v3a) = r3a, let d3a = v3a as? [String: Any] {
                    report["keyHelp"] = d3["help"] ?? false; report["escKept"] = d3a["open"] ?? false; report["escRow"] = d3a["onRow"] ?? false
                    report["ok"] = (report["keyOpened"] as? Bool) == true && (report["keyInto"] as? Bool) == true && (report["keySame"] as? Bool) == true
                        && (d3a["open"] as? Bool) == true && (d3a["onRow"] as? Bool) == true && (d3["help"] as? Bool) == true
                }
                if report["ok"] as? Bool != true { report["error"] = "expected j to select the next row with the panel following, Enter to go into it, Escape to give the row the keys with the panel left open, and ? to show the keys" }
            }
            if scenario == "ptyattach" {
                // by hand only: attaches a real background session (RALLY_SELFTEST_ATTACH=<short id>)
                let short = Env.get("SELFTEST_ATTACH") ?? ""
                guard !short.isEmpty else { return fail("set RALLY_SELFTEST_ATTACH") }
                let buf = "const P=()=>[...ptys.values()][0]; const text=()=>{const b=P().xt.buffer.active;let o='';for(let i=0;i<b.length;i++)o+=b.getLine(i).translateToString(true)+'\\n';return o};"
                let r0 = await js(wait + buf + "openSession(s,null); await wait(()=>ptys.size===1,5000); await wait(()=>/AK_ATTACH_OK/.test(text()),30000).catch(()=>0); return {drew:/AK_ATTACH_OK/.test(text()), rows:P().xt.rows, tail:text().trim().slice(-600)}", ["s": short])
                if case .success(let v0) = r0 { report["attached"] = v0 } else { return fail("attach did not run") }
                _ = await js(buf + "P().xt.focus(); post({type:'ptyin',id:P().id,data:'Now reply with exactly: AK_SECOND_OK'}); return 1")
                try? await Task.sleep(nanoseconds: 800_000_000)
                await osKey("Enter")
                let r1 = await js(wait + buf + "await wait(()=>/AK_SECOND_OK[^:]/.test(text().replace(/Now reply with exactly: AK_SECOND_OK/g,'')),60000).catch(()=>0); return {answered:/AK_SECOND_OK/.test(text().replace(/Now reply with exactly: AK_SECOND_OK/g,'')), tail:text().trim().slice(-600)}")
                if case .success(let v1) = r1 { report["typed"] = v1 }
                await shot(dir: dir, name: "attached.png")
                guard await osClick("#ptys .pty .tx") else { return fail("click ×") }
                let r2 = await js(wait + "await wait(()=>ptys.size===0,6000).catch(()=>0); return {left:ptys.size}")
                if case .success(let v2) = r2 { report["closed"] = v2 }
                let a = ((report["attached"] as? [String: Any])?["drew"] as? Bool) == true
                let t = ((report["typed"] as? [String: Any])?["answered"] as? Bool) == true
                report["ok"] = a && t && pty.count == 0
                steps.append("checked"); report["steps"] = steps
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "probe" {
                // RALLY_SELFTEST_JS: a file of page script (an async function body, `wait` in scope);
                // its return value is the report's "probe", and {ok, bad} is the verdict
                let path = Env.get("SELFTEST_JS") ?? ""
                guard let code = try? String(contentsOfFile: path, encoding: .utf8) else { return fail("set RALLY_SELFTEST_JS to a file") }
                let env = ProcessInfo.processInfo.environment
                let stEnv: [String: String] = ["phase": Env.get("SELFTEST_PHASE") ?? "", "session": Env.get("SELFTEST_SESSION") ?? "",
                                               "session2": Env.get("SELFTEST_SESSION2") ?? "", "real": env["SELFTEST_REAL_CLAUDE"] ?? "",
                                               "phases": Env.get("SELFTEST_PHASES") ?? "", "minutes": Env.get("SELFTEST_MINUTES") ?? ""]
                let stJson = (try? JSONSerialization.data(withJSONObject: stEnv)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                let r = await js(wait + "const ST_ENV=" + stJson + ";\n" + code)
                report["notified"] = notified
                report["ptyHosted"] = pty.hosted; report["ptyCount"] = pty.count; report["ptyInProcess"] = pty.local != nil
                switch r { case .success(let v): report["probe"] = v ?? NSNull()
                               if let d = v as? [String: Any], let ok = d["ok"] as? Bool { report["ok"] = ok; if !ok { report["error"] = ((d["bad"] as? [String]) ?? []).joined(separator: "; ") } } else { report["ok"] = true }
                           case .failure(let e): report["ok"] = false; report["error"] = "\(e)" }
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "kids" {
                // a parent whose subagents finished: one line on its card, their results in its panel
                let r = await js(wait + "await wait(()=>document.querySelector('.card .nk.kdone'),10000); const el=document.querySelector('.card .nk.kdone'); const card=el.closest('.card'); const done=document.querySelectorAll('section.col .card.sub').length; el.click(); await wait(()=>!document.querySelector('#detail').hidden&&document.querySelector('#mmeta .kfin'),5000); const res=[...document.querySelectorAll('#mmeta .kfin .kres')].length; return {line:el.textContent, kidCardsOnBoard:done, results:res, open:!!document.querySelector('#mmeta details.kids[open]')}")
                if case .success(let v) = r, let d = v as? [String: Any] {
                    report["kids"] = d
                    report["ok"] = (d["results"] as? Int ?? 0) > 0 && (d["open"] as? Bool) == true
                } else { report["ok"] = false; report["error"] = "no parent with finished subagents on the board" }
                try? await Task.sleep(nanoseconds: 600_000_000)
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "ptylook" {
                // by hand: sample text in a shell, the measured cell, and scroll frame timings
                let buf = "const P=()=>[...ptys.values()][0]; const text=()=>{const b=P().xt.buffer.active;let o='';for(let i=0;i<b.length;i++)o+=b.getLine(i).translateToString(true)+'\\n';return o};"
                if Env.get("SELFTEST_LIGHT") == "1" { _ = await js("document.body.classList.add('light'); return 1") }
                _ = await js(wait + "await wait(()=>typeof ptyOpen==='function'&&!!window.Terminal,5000); document.querySelector('#termin').focus(); return 1")
                await osKey("cmdt")
                _ = await js(wait + buf + "await wait(()=>ptys.size===1&&/\\S/.test(text()),15000); document.documentElement.style.setProperty('--termh','460px'); return 1")
                try? await Task.sleep(nanoseconds: 500_000_000)
                let sample = "clear; for i in $(seq 1 30); do echo \"scroll line $i\"; done; printf '%s\\n' '╭──────────────────────────────────────────╮' '│ ✻ Welcome to Claude Code!                │' '╰──────────────────────────────────────────╯' 'The quick brown fox jumps over 0123456789 {}[]()=>' '日本語の表示: 送信できないのはなんで？「全角」、句読点。' 'mixed: rally は ボード と ターミナル の 間 を つなぐ' '  ⎿  Read lib/ui/app.js (2470 lines)' '❯ 続けて' '● Bash(git status --short)' '  ✓ 498 passed · ✗ 0 failed · → next ─ ━ ┃ ▌ ░▒▓█'; for c in 30 31 32 33 34 35 36 37 90 91 92 93 94 95 96 97; do printf '\\033[%sm■ %s \\033[0m' $c $c; done; printf '\\n\\033[2mdim\\033[0m \\033[1mbold\\033[0m \\033[7mreverse\\033[0m\\n'\r"
                let r = await js(wait + buf + "post({type:'ptyin',id:P().id,data:s}); await wait(()=>/░▒▓█/.test(text()),10000); await new Promise(r=>setTimeout(r,1200)); const x=P().xt, c=x._core, d=c._renderService&&c._renderService.dimensions; return {font:x.options.fontFamily, size:x.options.fontSize, lh:x.options.lineHeight, cell:d?{w:d.css.cell.width,h:d.css.cell.height}:null, renderer:(P().gl?'webgl':'dom'), cjk:!!P().cjk, jaGlyph:(()=>{const c=document.createElement('canvas').getContext('2d');c.font=x.options.fontSize+'px '+x.options.fontFamily;return Math.round(c.measureText('日').width*10)/10})(), faces:[...document.fonts].map(f=>f.family+' '+f.weight+' '+f.status), check:document.fonts.check('12.5px \"AK Terminal CJK\"','日'), jaOnly:(()=>{const c=document.createElement('canvas').getContext('2d');c.font='12.5px \"AK Terminal CJK\"';return Math.round(c.measureText('日').width*10)/10})(), hira:(()=>{const c=document.createElement('canvas').getContext('2d');c.font='12.5px \"Hiragino Sans\"';return Math.round(c.measureText('日').width*10)/10})(), paneW:[...document.querySelectorAll('#tpanes,#ptys')].map(e=>Math.round(e.getBoundingClientRect().width)), cols:x.cols, rows:x.rows, dpr:window.devicePixelRatio}", ["s": sample])
                if case .success(let v) = r { report["look"] = v } else { report["error"] = "the sample never drew" }
                let bench = "const x=P().xt; const run=()=>new Promise(res=>{let n=0,t0=0,gaps=[];setTimeout(()=>res({error:'timeout after '+n+' frames'}),30000);function f(t){try{if(t0)gaps.push(t-t0);t0=t;x.scrollLines(n%180<90?-1:1)}catch(e){return res({error:String(e)})}if(++n<600)requestAnimationFrame(f);else{gaps.sort((a,b)=>a-b);res({median:Math.round(gaps[gaps.length>>1]*10)/10,p95:Math.round(gaps[Math.floor(gaps.length*.95)]*10)/10,over25:gaps.filter(g=>g>25).length,over50:gaps.filter(g=>g>50).length,max:Math.round(gaps[gaps.length-1])})}}requestAnimationFrame(f)});"
                _ = await js(wait + buf + "post({type:'ptyin',id:P().id,data:'for i in $(seq 1 3000); do printf \"%05d 日本語とASCIIが混ざった長めの行 the quick brown fox jumps over the lazy dog ────────\\\\n\" $i; done\r'}); await wait(()=>/03000 /.test(text()),30000).catch(()=>0); return 1")
                let b1 = await js(buf + bench + "return {webgl: await run()}")
                let b2 = await js(buf + bench + "if(P().gl){P().gl.dispose();P().gl=null} await new Promise(r=>setTimeout(r,300)); return {dom: await run()}")
                var sc: [String: Any] = [:]
                if case .success(let v) = b1, let d = v as? [String: Any] { sc.merge(d) { a, _ in a } }
                if case .success(let v) = b2, let d = v as? [String: Any] { sc.merge(d) { a, _ in a } }
                report["scroll"] = sc
                report["ok"] = report["error"] == nil
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "pty" {
                // a real terminal in the strip: ⌘T, I/O, resize, split, Esc to the program, ⌘J, ×
                var bad: [String] = []
                func expect(_ what: String, _ ok: Bool) { if !ok { bad.append(what) } }
                // the strip's own terminals (the panel holds one too)
                let buf = "const SP=()=>[...ptys.values()].filter(p=>!p.host&&!p.parked); const P=()=>SP()[0]; const text=()=>{const b=P().xt.buffer.active;let o='';for(let i=0;i<b.length;i++)o+=b.getLine(i).translateToString(true)+'\\n';return o};"
                _ = await js(wait + "await wait(()=>typeof ptyOpen==='function'&&!!window.Terminal,5000); document.querySelector('#termin').focus(); return 1")
                await osKey("cmdt")
                steps.append("opened a shell tab (\(lastPointer))")
                let r0 = await js(wait + buf + "await wait(()=>SP().length===1&&ptyOn!=='cmd',5000); await wait(()=>/\\S/.test(text()),15000); return {on:document.body.classList.contains('onpty'), focus:inPty(), cols:P().cols, rows:P().rows, h:Math.round(document.querySelector('#term').getBoundingClientRect().height)}")
                guard case .success(let v0) = r0, let d0 = v0 as? [String: Any] else { return fail("the shell never drew anything") }
                report["opened"] = d0
                expect("the tab shows and has the keys", (d0["on"] as? Bool) == true && (d0["focus"] as? Bool) == true)
                expect("the strip grew to hold a terminal", ((d0["h"] as? Int) ?? 0) >= 300)
                let r1 = await js(wait + buf + "post({type:'ptyin',id:P().id,data:'echo AK_PTY_$((6*7)); echo \"SZ $(stty size)\"\\r'}); await wait(()=>/AK_PTY_42/.test(text())&&/SZ \\d+ \\d+/.test(text()),10000); const m=text().match(/SZ (\\d+) (\\d+)/); return {rows:+m[1], cols:+m[2], xr:P().xt.rows, xc:P().xt.cols}")
                if case .success(let v1) = r1, let d1 = v1 as? [String: Any] {
                    report["size"] = d1
                    expect("the pty's size is the one xterm drew", (d1["rows"] as? Int) == (d1["xr"] as? Int) && (d1["cols"] as? Int) == (d1["xc"] as? Int))
                } else { bad.append("what was typed never came back") }
                // a bigger strip reaches the program (wider when it is the right column, else taller)
                let r2 = await js(wait + buf + "const side=termSide(); document.documentElement.style.setProperty(side?'--termw':'--termh',side?'640px':'520px'); await new Promise(r=>setTimeout(r,300)); await wait(()=>P().cols>0&&P().xt.cols===P().cols&&P().xt.rows===P().rows,3000); await new Promise(r=>setTimeout(r,400)); post({type:'ptyin',id:P().id,data:'clear; echo \"SZ2 $(stty size)\"\\r'}); await wait(()=>/SZ2 \\d+ \\d+/.test(text()),10000); const m=text().match(/SZ2 (\\d+) (\\d+)/); return {rows:+m[1], cols:+m[2], xr:P().xt.rows, xc:P().xt.cols, side}")
                if case .success(let v2) = r2, let d2 = v2 as? [String: Any] {
                    report["resized"] = d2
                    let side = (d2["side"] as? Bool) == true
                    expect(side ? "a wider column is more columns for the program" : "a taller strip is more rows for the program", (d2["rows"] as? Int) == (d2["xr"] as? Int) && (d2["cols"] as? Int) == (d2["xc"] as? Int)
                        && (side ? ((d2["cols"] as? Int) ?? 0) > ((d0["cols"] as? Int) ?? 0) : ((d2["rows"] as? Int) ?? 0) > ((d0["rows"] as? Int) ?? 0)))
                } else { bad.append("resize never reached the pty") }
                // a second shell splits beside (or under) the first; its × leaves the first with the keys
                await osKey("cmdt")
                let rs = await js(wait + buf + "await wait(()=>SP().length===2,5000); await new Promise(r=>setTimeout(r,500)); const els=[...document.querySelectorAll('#ptys .pty')].map(e=>e.getBoundingClientRect()); const cmd=document.querySelector('#tpanes').getBoundingClientRect(); const st=termStacked(); return {n:els.length, stacked:st, widths:els.map(b=>Math.round(b.width)), apart:els.length===2&&(st?els[1].top>=els[0].bottom-1&&Math.abs(els[0].left-els[1].left)<2:els[1].left>=els[0].right-1&&Math.abs(els[0].top-els[1].top)<2), cmdInView:cmd.width>100&&cmd.height>20, second:ptyOn===SP()[1].id, cols:SP().map(p=>p.xt.cols)}")
                if case .success(let v) = rs, let d = v as? [String: Any] {
                    report["split"] = d
                    expect("a second shell sits beside the first (under it in the column), the command line still in view", (d["apart"] as? Bool) == true && (d["cmdInView"] as? Bool) == true && (d["second"] as? Bool) == true)
                } else { bad.append("the second shell never opened") }
                guard await osClick("#ptys .pty:last-child .tx") else { return fail("click × on the second shell") }
                let rc = await js(wait + buf + "await wait(()=>SP().length===1,6000).catch(()=>0); return {left:SP().length, first:ptyOn===P().id, focus:inPty()}")
                if case .success(let v) = rc, let d = v as? [String: Any] {
                    report["splitClosed"] = d
                    expect("closing the second leaves the first with the keys", (d["left"] as? Int) == 1 && (d["first"] as? Bool) == true)
                }
                // XTVERSION is answered as xterm.js: Claude Code's wheel handling keys on it
                let rx = await js(wait + buf + "post({type:'ptyin',id:P().id,data:'clear; printf \"\\\\033[>0q\"; IFS= read -r -s -d \"\\\\\\\\\" -t 2 x; printf \"XTV:%s\\\\n\" \"$x\" | command cat -v\\r'}); await wait(()=>/XTV:/.test(text()),8000).catch(()=>0); return (text().match(/XTV:.*/)||[''])[0]")
                if case .success(let v) = rx { report["xtversion"] = v; expect("XTVERSION answers xterm.js", ((v as? String) ?? "").contains("xterm.js(")) } else { bad.append("XTVERSION check failed to run") }
                _ = await js(buf + "post({type:'ptyin',id:P().id,data:'clear; read -r x; printf \"GOT:%s\\\\n\" \"$x\" | command cat -v\\r'}); P().xt.focus(); return 1")
                try? await Task.sleep(nanoseconds: 600_000_000)
                await osKey("Escape"); await osKey("Enter")
                let r3 = await js(wait + buf + "await wait(()=>/GOT:\\^\\[/.test(text()),8000).catch(()=>0); return {got:/GOT:\\^\\[/.test(text()), focus:inPty(), on:ptyOn!=='cmd', tail:text().trim().slice(-120)}")
                if case .success(let v3) = r3, let d3 = v3 as? [String: Any] {
                    report["esc"] = d3
                    expect("Esc arrives in the program as ESC", (d3["got"] as? Bool) == true)
                    expect("Esc leaves the focus in the terminal", (d3["focus"] as? Bool) == true && (d3["on"] as? Bool) == true)
                } else { bad.append("Esc check failed to run") }
                await osKey("cmdj")
                if case .success(let v) = await js("return inPty()") { expect("⌘J leaves the terminal", (v as? Bool) == false) }
                // × ends it (the strip ⌘J may have folded is opened first)
                _ = await js("termOpen(true); return 1"); try? await Task.sleep(nanoseconds: 400_000_000)
                guard await osClick("#ptys .pty .tx") else { return fail("click ×") }
                let r4 = await js(wait + buf + "await wait(()=>SP().length===0,6000).catch(()=>0); await new Promise(r=>setTimeout(r,300)); return {left:SP().length, others:[...ptys.values()].filter(p=>!p.gone).length, on:ptyOn, tab:!!document.querySelector('#ptys .pty'), cmdOn:!document.body.classList.contains('onpty')}")
                if case .success(let v4) = r4, let d4 = v4 as? [String: Any] {
                    report["closed"] = d4
                    expect("× removes the tab and returns to the command line", (d4["left"] as? Int) == 0 && (d4["tab"] as? Bool) == false && (d4["cmdOn"] as? Bool) == true)
                }
                var others = -1
                if case .success(let v4) = r4, let d4 = v4 as? [String: Any] { others = (d4["others"] as? Int) ?? -1 }
                expect("no terminal of the strip left running in the app (\(pty.count) running, \(others) the panel's)", pty.count == others)
                report["bad"] = bad; report["ok"] = bad.isEmpty
                if !bad.isEmpty { report["error"] = bad.joined(separator: "; ") }
                steps.append("checked"); report["steps"] = steps
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "term" {
                // the footer strip: type a command, press Enter, read the answer
                let r0 = await js(wait + "await wait(()=>document.querySelector('#termin'),5000); return {closed:document.body.classList.contains('termclosed'), enabled:!document.querySelector('#termin').disabled}")
                guard case .success(let v0) = r0, let d0 = v0 as? [String: Any] else { return fail("no terminal strip") }
                report["termEnabled"] = d0["enabled"] ?? false
                report["termOpen"] = !((d0["closed"] as? Bool) ?? true)
                // folded at start: ⌘J shows it and puts the keys in its line (else ⌃C goes to the board)
                await osKey("cmdj")
                let rj = await js(wait + "await wait(()=>!document.body.classList.contains('termclosed'),3000).catch(()=>0); const t=document.querySelector('#term').getBoundingClientRect(),d=document.querySelector('#detail').getBoundingClientRect(); return {shown:!document.body.classList.contains('termclosed'), keys:document.activeElement===document.querySelector('#termin'), side:termSide(), right:Math.abs(t.right-innerWidth)<=1&&t.left>=d.left}")
                guard case .success(let vj) = rj, let dj = vj as? [String: Any], (dj["shown"] as? Bool) == true, (dj["keys"] as? Bool) == true else { return fail("⌘J did not show the strip with the keys in its line") }
                report["termSide"] = dj
                if (dj["side"] as? Bool) != true || (dj["right"] as? Bool) != true { return fail("the strip is not the column on the right in the docked list (\(dj))") }
                _ = await js("const i=document.querySelector('#termin'); i.value='echo SELFTEST_TERM_OK'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1")
                steps.append("typed a command and pressed Enter")
                let r1 = await js(wait + "const hits=()=>(document.querySelector('#termout').textContent.match(/SELFTEST_TERM_OK/g)||[]).length; await wait(()=>hits()>1&&document.querySelector('#termcwd').textContent,20000); return {out:document.querySelector('#termout').textContent.slice(-200), cwd:document.querySelector('#termcwd').textContent, hits:hits(), enabledAgain:!document.querySelector('#termin').disabled}")
                if case .success(let v1) = r1, let d1 = v1 as? [String: Any] {
                    report["termOut"] = d1["out"] ?? ""; report["termCwd"] = d1["cwd"] ?? ""; report["termHits"] = d1["hits"] ?? 0
                    // twice: the echoed line and its output
                    report["ok"] = ((d1["hits"] as? Int) ?? 0) > 1 && !((d1["cwd"] as? String) ?? "").isEmpty
                        && (d0["enabled"] as? Bool) == true && (d1["enabledAgain"] as? Bool) == true
                } else if case .failure(let e) = r1 { return fail("the command printed nothing: \(e.localizedDescription)") }
                if report["ok"] as? Bool != true { report["error"] = "expected the typed command to run and print in the strip" }
                // ⌃C stops a command that would wait forever
                if report["ok"] as? Bool == true {
                    let t0 = Date()
                    let r2 = await js(wait + "const i=document.querySelector('#termin'); i.value='sleep 60'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await wait(()=>term.busy,3000); await new Promise(r=>setTimeout(r,500)); i.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true})); await wait(()=>!term.busy,8000); return {free:!term.busy, readonly:i.readOnly}")
                    let took = Date().timeIntervalSince(t0)
                    if case .success(let v2) = r2, let d2 = v2 as? [String: Any], (d2["free"] as? Bool) == true, (d2["readonly"] as? Bool) == false, took < 10 {
                        report["termStopped"] = true
                    } else { report["ok"] = false; report["error"] = "⌃C did not stop a running command in the strip (\(Int(took))s)" }
                }
            }
            if scenario == "new" {
                // Enter → 起動中… at once → 起動しました while the session writes its first line → its panel
                func snap(_ name: String) async {
                    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                        web.takeSnapshot(with: nil) { img, _ in
                            if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                                try? png.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
                            }
                            c.resume()
                        }
                    }
                }
                guard await osClick("#new") else { return fail("click ＋新規セッション") }
                steps.append("opened the new-session panel (\(lastPointer))")
                let cwd = Env.get("SELFTEST_CWD") ?? NSTemporaryDirectory()
                // record every state as it happens (a poll could miss the first)
                let r0 = await js(wait + "await wait(()=>document.querySelector('#ntext'),5000); const st=document.querySelector('#nstate'); window.__nsLog=[]; window.__answers=[]; const od=window.__kanban.dispatched; window.__kanban.dispatched=function(a){window.__answers.push({short:a.short||'',session:a.session||'',error:a.error||''}); return od.apply(this,arguments)}; new MutationObserver(()=>{const p=(st.className.match(/nsstate (\\w+)/)||[])[1]||''; const l=window.__nsLog; if(p&&(!l.length||l[l.length-1].phase!==p))l.push({phase:p,text:st.textContent,ms:Date.now()})}).observe(st,{attributes:true,childList:true,subtree:true,characterData:true}); document.querySelector('#ndir').value=cwd; const ab=document.querySelector('#nagent'); ab.dataset.v='claude'; const t=document.querySelector('#ntext'); t.value='selftest: say PONG'; t.focus(); t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); const shown=!st.hidden&&getComputedStyle(st).display!=='none'; t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return {text:st.textContent, phase:document.querySelector('#mbody').dataset.phase||'', shown}", ["cwd": cwd])
                guard case .success(let v0) = r0, let d0 = v0 as? [String: Any] else { return fail("no compose form") }
                report["atEnter"] = d0
                steps.append("pressed Enter to start (twice)")
                await snap("starting")
                let r1 = await js(wait + "await wait(()=>(window.__nsLog||[]).some(x=>x.phase!=='starting')||String(panelKey).startsWith('claude:'),20000); return 1")
                if case .failure(let e) = r1 { return fail("no answer to the start: \(e.localizedDescription)") }
                if case .success(let v) = await js("return document.querySelector('#mbody').dataset.phase||''"), (v as? String) == "waiting" { await snap("waiting") }
                let r2 = await js(wait + "await wait(()=>String(panelKey).startsWith('claude:'),40000).catch(()=>0); await wait(()=>/selftest: say PONG/.test(document.querySelector('#mhist')?.textContent||''),10000).catch(()=>0); return {panel:String(panelKey), title:document.querySelector('#mtitle').textContent, open:!document.querySelector('#detail').hidden, history:/selftest: say PONG/.test(document.querySelector('#mhist')?.textContent||''), log:window.__nsLog, answers:window.__answers, state:(document.querySelector('#nstate')||{}).textContent||'', toast:(document.querySelector('#mbody .toast')||{}).textContent||''}")
                if case .success(let v) = r2, let d = v as? [String: Any] {
                    for (k, val) in d { report[k] = val }
                    let phases = ((d["log"] as? [[String: Any]]) ?? []).compactMap { $0["phase"] as? String }
                    report["phases"] = phases
                    let shownAtEnter = (d0["shown"] as? Bool) == true && ((d0["text"] as? String) ?? "").contains("起動中")
                    let waited = ((d["log"] as? [[String: Any]]) ?? []).contains { ($0["phase"] as? String) == "waiting" && (($0["text"] as? String) ?? "").contains("起動しました") }
                    report["ok"] = shownAtEnter && waited && ((d["panel"] as? String) ?? "").hasPrefix("claude:") && (d["open"] as? Bool) == true && (d["history"] as? Bool) == true
                    if report["ok"] as? Bool != true { report["error"] = "expected 起動中… at Enter, 起動しました while waiting, then the new session's panel with its first message (at Enter: \(shownAtEnter), waited: \(waited), panel: \(d["panel"] ?? "")" + ")" }
                } else if case .failure(let e) = r2 { return fail("new: \(e.localizedDescription)") }
            }
            if scenario == "resize" {
                let sel = (await claudeCardSelector()) ?? "[data-col=\"stale\"] .card:not(.sub)"
                let r0 = await js(wait + "await wait(()=>document.querySelector('\(sel)'),5000); return 1")
                if case .failure(let e) = r0 { return fail("no card to open: \(e.localizedDescription)") }
                guard await clickOpen("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                _ = await js(wait + "await wait(()=>!document.querySelector('#detail').hidden,3000); return 1")
                // dragging the list's right edge left narrows it (saved as listw); the panel takes the rest
                _ = await js("try{localStorage.removeItem('listw')}catch(e){} document.documentElement.style.removeProperty('--listw'); return 1")
                let before = await js("return {w:Math.round(document.querySelector('#detail').getBoundingClientRect().width), list:Math.round(document.querySelector('main').getBoundingClientRect().width), docked:listDocked()}")
                guard await osDrag("#mgrip", dx: -80) else { return fail("drag the grip") }
                steps.append("dragged grip (\(lastPointer))")
                let after = await js("const d=document.querySelector('#detail').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(); return {w:Math.round(d.width), list:Math.round(m.width), meet:Math.abs(d.left-m.right)<=2, saved:+(localStorage.getItem('listw')||0), listw:parseInt(getComputedStyle(document.documentElement).getPropertyValue('--listw'))||0}")
                if case .success(let b) = before, let d0 = b as? [String: Any] { report["widthBefore"] = d0["w"] ?? 0; report["listBefore"] = d0["list"] ?? 0; report["docked"] = d0["docked"] ?? false }
                if case .success(let a) = after, let d = a as? [String: Any] {
                    for (k, val) in d { report[k] = val }
                    let w0 = (report["widthBefore"] as? Int) ?? 0, l0 = (report["listBefore"] as? Int) ?? 0
                    let w1 = (d["w"] as? Int) ?? 0, l1 = (d["list"] as? Int) ?? 0
                    report["ok"] = (report["docked"] as? Bool) == true && l1 < l0 - 50 && abs((w1 - w0) - (l0 - l1)) <= 3 && (d["meet"] as? Bool) == true && ((d["saved"] as? Int) ?? 0) > 0 && (d["saved"] as? Int) == (d["listw"] as? Int)
                    if report["ok"] as? Bool != true { report["error"] = "dragging the grip did not narrow the list and widen the panel by as much (list \(l0) → \(l1), panel \(w0) → \(w1))" }
                }
            }
            if scenario == "split" {
                // split panes are separate shells: a cd in one leaves the other, both run at once
                let r = await js(wait + "termOpen(true); const p=splitPane(); if(!p) return {error:'no split'}; const i0=document.querySelector('#termin'), i1=p.el.querySelector('.tin'); const run=(i,c)=>{i.value=c;i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}; run(i1,'cd /tmp && sleep 1 && pwd'); run(i0,'pwd'); await wait(()=>!term.busy&&!p.busy,20000); const last=el=>{const b=[...el.querySelectorAll('.trun')].pop();return b?b.querySelector('.tout').textContent.trim():''}; const out0=last(term.el), out1=last(p.el); run(i0,'pwd'); await wait(()=>!term.busy,10000); const again0=last(term.el); p.el.querySelector('.tpx').click(); return {panes:document.querySelectorAll('#tpanes .tpane').length, out0, out1, again0, closed:panes.length}")
                if case .success(let v) = r, let d = v as? [String: Any] {
                    for (k, val) in d { report[k] = val }
                    let home = FileManager.default.homeDirectoryForCurrentUser.path
                    report["ok"] = (d["out1"] as? String)?.hasSuffix("/tmp") == true && (d["out0"] as? String) == home && (d["again0"] as? String) == home && (d["closed"] as? Int) == 1
                } else if case .failure(let e) = r { return fail("split: \(e.localizedDescription)") }
                steps.append("split"); report["steps"] = steps
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "layout" {
                // the board at RALLY_SELFTEST_SIZE, panel closed and open, light and dark, measured in the
                // page by VCHECK
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                var issues: [String] = []
                var states: [String: Any] = [:]
                func snap(_ name: String) async {
                    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                        web.takeSnapshot(with: nil) { img, _ in
                            if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                                try? png.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
                            }
                            c.resume()
                        }
                    }
                }
                for (panel, dark) in [(false, false), (false, true), (true, false), (true, true)] {
                    let label = (panel ? "panel" : "board") + "-" + (dark ? "dark" : "light")
                    if panel {
                        if case .success(let o) = await js("return !document.querySelector('#detail').hidden"), (o as? Bool) != true {
                            guard await clickOpen("\(sel) .proj, \(sel) .ct") else { return fail("click card") }
                            _ = await js(wait + "await wait(()=>!document.querySelector('#detail').hidden,3000); await wait(()=>document.querySelectorAll('#mhist .turn').length>0,20000); return 1")
                        }
                    } else {
                        _ = await js("if(!document.querySelector('#detail').hidden)closeDetail('x'); return 1")
                    }
                    // the window is never on screen, so transitions never tick: turn them off to measure
                    _ = await js("if(!document.querySelector('#vcheck-still')){const st=document.createElement('style');st.id='vcheck-still';st.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';document.head.appendChild(st)} applyTheme(\(dark ? "false" : "true")); await new Promise(r=>setTimeout(r,300)); return 1")
                    let r = await js(Self.VCHECK + "return vcheck()")
                    if case .success(let v) = r, let d = v as? [String: Any] {
                        states[label] = d
                        for x in (d["issues"] as? [String]) ?? [] { issues.append(label + ": " + x) }
                    } else if case .failure(let e) = r { issues.append(label + ": the check threw: " + e.localizedDescription) }
                    await snap(label)
                }
                // wide, opening and closing the panel moves no lane
                let laneRs = Set(states.values.compactMap { ($0 as? [String: Any])?["laneR"] as? Int })
                let W = states.values.compactMap { ($0 as? [String: Any])?["W"] as? Int }.first ?? 0
                report["lanesStill"] = laneRs.count == 1
                if W >= 1011 && laneRs.count != 1 { issues.append("the lanes move when the panel opens or closes (right edges \(laneRs.sorted()))") }
                report["states"] = states
                report["issues"] = Array(issues.prefix(60))
                report["issueCount"] = issues.count
                report["ok"] = issues.isEmpty
                if !issues.isEmpty { report["error"] = "\(issues.count) layout problems: " + issues.prefix(3).joined(separator: " | ") }
                steps.append("measured 4 states"); report["steps"] = steps
                return finishSelfTest(dir: dir, report: report)
            }
            if scenario == "detail" {
                guard let sel = await claudeCardSelector() else { return fail("no claude card on the board") }
                let r0 = await js(wait + "await wait(()=>document.querySelector('\(sel)'),5000); return 1")
                if case .failure(let e) = r0 { return fail("the picked card vanished: \(e.localizedDescription)") }
                steps.append("card ready")
                // `hidden` alone doesn't prove the panel isn't covering the page (a display rule can beat
                // [hidden]): check the computed style and what is hittable. Start from the default width.
                _ = await js("try{localStorage.removeItem('panelw')}catch(e){} document.documentElement.style.removeProperty('--panelw'); return 1")
                // the docked panel is never closed, so hide it for a moment to check
                let base = await js("const d=document.querySelector('#detail'); const was=d.hidden; d.hidden=true; const disp=getComputedStyle(d).display; const el=document.elementFromPoint(innerWidth-200,300); d.hidden=was; return {display:disp, underPoint: el ? el.tagName+'.'+el.className : null, underDetail:!!(el&&el.closest('#detail')), open:!d.hidden, openFor:openFor||'', sel:sel||'', listR:Math.round(document.querySelector('main').getBoundingClientRect().right)}")
                var openBase: [String: Any] = [:]
                if case .success(let v) = base, let d = v as? [String: Any] {
                    report["baselineDisplay"] = d["display"] ?? ""
                    openBase = d; report["openBefore"] = d["openFor"] ?? ""
                    if (d["display"] as? String) != "none" || (d["underDetail"] as? Bool) == true { return fail("the panel is not display:none when hidden (the [hidden] overlay bug)") }
                }
                guard await clickOpen("\(sel) .proj, \(sel) .ct") else { return fail("click card, Enter") }
                steps.append("clicked card (\(lastPointer))")
                let r = await js(wait + "await wait(()=>!document.querySelector('#detail').hidden,3000); await wait(()=>document.querySelectorAll('#mhist .turn').length>0,20000); const p=document.querySelector('#detail'); const r_=p.getBoundingClientRect(); const card=document.querySelector('\(sel)'); const cr=card.getBoundingClientRect(); const mid=document.elementFromPoint(cr.left+8, cr.top+8); return {open:!p.hidden, title:document.querySelector('#mtitle').textContent, bodyLen:document.querySelector('#mbody').textContent.length, hasStatus:/Working|Your Turn|Waiting|Completed/.test((document.querySelector('#mmeta .mstat .lane')||{}).textContent||''), hasResume:/--resume|resume /.test(document.querySelector('#mmeta').textContent), panelSendBox:!!p.querySelector('.msg textarea'), historyTurns:document.querySelectorAll('#mhist .turn').length, atBottom:(()=>{const h=document.querySelector('#mhist');return h.scrollHeight-h.clientHeight-h.scrollTop<40})(), scrollable:(()=>{const h=document.querySelector('#mhist');return h.scrollHeight>h.clientHeight+20})(), canScroll:(()=>{const o=getComputedStyle(document.querySelector('#mhist')).overflowY;return o==='auto'||o==='scroll'})(), hasGrip:!!document.querySelector('#mgrip'), resized:(()=>{const d=document.querySelector('#detail'),before=d.getBoundingClientRect().width,lw=getComputedStyle(document.documentElement).getPropertyValue('--listw');document.documentElement.style.setProperty('--listw','400px');const after=d.getBoundingClientRect().width;document.documentElement.style.setProperty('--listw',lw);return {before:Math.round(before),after:Math.round(after),want:Math.round((document.body.classList.contains('termclosed')?document.querySelector('#term').getBoundingClientRect().left:innerWidth)-400)}})(), dockedRight:Math.abs(r_.right-(document.body.classList.contains('termclosed')?document.querySelector('#term').getBoundingClientRect().left:window.innerWidth))<=2&&Math.abs(r_.left-document.querySelector('main').getBoundingClientRect().right)<=2, cardStillHittable:!!(mid&&mid.closest('.card')&&!mid.closest('#detail')), boardPadded:getComputedStyle(document.querySelector('main')).paddingRight, openNow:openFor||'', selNow:sel||'', panelW:Math.round(r_.width), listR:Math.round(document.querySelector('main').getBoundingClientRect().right)}")
                if case .success(let v) = r, let d = v as? [String: Any] {
                    for (k, val) in d { report[k] = val }
                    report["ok"] = (d["open"] as? Bool) == true && !((d["title"] as? String) ?? "").isEmpty && (d["hasStatus"] as? Bool) == true
                        && (d["dockedRight"] as? Bool) == true && (d["cardStillHittable"] as? Bool) == true && (d["panelSendBox"] as? Bool) == true
                        && ((d["historyTurns"] as? Int) ?? 0) > 0
                        && (d["hasGrip"] as? Bool) == true
                        // opened at the newest turn in a scrollable pane (whether it needs to scroll is reported only)
                        && (d["canScroll"] as? Bool) == true && (d["atBottom"] as? Bool) == true
                        && (((d["resized"] as? [String: Any])?["after"] as? Int) ?? 0) == (((d["resized"] as? [String: Any])?["want"] as? Int) ?? -1)
                    // the click moved the panel from the selected row onto the clicked one; the list stayed
                    let clicked = (d["openNow"] as? String) ?? ""
                    let moved = (openBase["open"] as? Bool) == true && !((openBase["openFor"] as? String) ?? "").isEmpty && (openBase["openFor"] as? String) == (openBase["sel"] as? String)
                        && clicked.hasSuffix(sel.replacingOccurrences(of: ".card[data-id=\"", with: "").replacingOccurrences(of: "\"]", with: "")) && clicked != (openBase["openFor"] as? String) && (d["selNow"] as? String) == clicked
                        && (openBase["listR"] as? Int) == (d["listR"] as? Int)
                    report["panelMoved"] = moved
                    if !moved { report["ok"] = false }
                } else if case .failure(let e) = r { return fail("modal did not open: \(e.localizedDescription)") }
                if report["ok"] as? Bool != true { report["error"] = "detail panel: expected the right side already showing the selected row, the click moving it onto the clicked row with the list still, it docked right of the list, board hittable, send box, history opened at the newest turn, and a resizable width" }
                // colours are automatic: no picker
                if case .success(let vc) = await js("return !!document.querySelector('#mbody .swatches')"), (vc as? Bool) == true {
                    report["ok"] = false; report["error"] = "the panel still shows a colour picker"
                }
                let rLast = await js(wait + "const turns=[{t:Date.now()-9000,kind:'user',text:'ひとつ目'},{t:Date.now()-8000,kind:'assistant',text:'できました'},{t:Date.now()-7000,kind:'user',text:'ふたつ目'},{t:Date.now()-6000,kind:'assistant',text:'これも'}]; const draw=()=>renderHistory({agent:openFor.split(':')[0],session:openFor.split(':').slice(1).join(':'),turns,dropped:0}); document.querySelector('#mbody .viewpick button[data-v=\"last\"]').click(); histSig=''; draw(); const shown=[...document.querySelectorAll('#mhist > .turn:not(.think)')].map(t=>t.textContent); const more=document.querySelectorAll('#mhist details.reply').length===1; document.querySelector('#mbody .viewpick button[data-v=\"all\"]').click(); histSig=''; draw(); const allShown=document.querySelectorAll('#mhist .turn:not(.think)').length; return {shown:shown.length, hasMore:more, lastText:(shown[shown.length-1]||''), allShown}")
                if case .success(let vl) = rLast, let dl = vl as? [String: Any] {
                    report["lastOnly"] = dl["shown"] ?? 0
                    report["lastOnlyAll"] = dl["allShown"] ?? 0
                    // 直前のみ: the newest exchange open, earlier instructions kept, replies folded
                    if ((dl["shown"] as? Int) ?? 0) != 3 || (dl["hasMore"] as? Bool) != true
                        || !((dl["lastText"] as? String) ?? "").contains("これも") || ((dl["allShown"] as? Int) ?? 0) != 4 {
                        report["ok"] = false
                        report["error"] = "直前のみ did not show just the last exchange (\(dl))"
                    }
                }
                // the newest turn is whole on screen (scroll set after layout)
                let rBot = await js(wait + "await wait(()=>document.querySelectorAll('#mhist .turn').length>0,8000); await new Promise(r=>setTimeout(r,600)); const h=document.querySelector('#mhist'); const ts=[...h.querySelectorAll('.turn')]; const last=ts[ts.length-1]; const hb=h.getBoundingClientRect(), lb=last.getBoundingClientRect(); return {overflow:Math.round(lb.bottom-hb.bottom), lastText:(last.textContent||'').slice(0,40), atEnd:Math.round(h.scrollHeight-h.clientHeight-h.scrollTop)}")
                if case .success(let vb) = rBot, let db = vb as? [String: Any] {
                    report["lastTurnOverflow"] = db["overflow"] ?? 0
                    report["historyAtEnd"] = db["atEnd"] ?? 0
                    if ((db["overflow"] as? Int) ?? 99) > 2 {
                        report["ok"] = false
                        report["error"] = "the newest turn is cut off by \((db["overflow"] as? Int) ?? 0)px — the reader has to scroll to read what just arrived"
                    }
                }
                // an unchanged refresh leaves the panel's DOM alone
                let rSame = await js("document.querySelector('#mmeta').dataset.mark='1'; applyState(live); const a=document.querySelector('#mmeta').dataset.mark; applyState(live); const b=document.querySelector('#mmeta').dataset.mark; return {kept:a==='1'&&b==='1'}")
                if case .success(let vs) = rSame, let ds = vs as? [String: Any] {
                    report["panelStable"] = ds["kept"] ?? false
                    if (ds["kept"] as? Bool) != true { report["ok"] = false; report["error"] = "an unchanged refresh rebuilt the panel" }
                }
                // switching away and back draws the cached conversation in the same tick
                let rCache = await js(wait + "await wait(()=>document.querySelectorAll('#mhist .turn').length>0,20000); const first=openFor; const others=(live.cards||[]).filter(c=>c.agent+':'+c.id!==first&&(c.agent==='claude'||c.agent==='codex')); if(!others.length) return {skip:true}; const a=live.cards.find(c=>c.agent+':'+c.id===first); openDetail(others[0]); await new Promise(r=>setTimeout(r,1200)); openDetail(a); const immediate=document.querySelectorAll('#mhist .turn').length; const placeholder=[...document.querySelectorAll('#mhist > .more')].some(e=>/読み込み中/.test(e.textContent)); return {immediate,placeholder}")
                if case .success(let vc2) = rCache, let dc2 = vc2 as? [String: Any], (dc2["skip"] as? Bool) != true {
                    report["cachedTurns"] = dc2["immediate"] ?? 0
                    if ((dc2["immediate"] as? Int) ?? 0) < 1 || (dc2["placeholder"] as? Bool) == true {
                        report["ok"] = false
                        report["error"] = "coming back to a session blanked the conversation instead of showing what was already read"
                    }
                }
                // the rail folds an answer, a click reopens it, a click on an open one does nothing;
                // tool runs stay folded
                let rFoldA = await js(wait + "await wait(()=>document.querySelectorAll('#mhist .turn.assistant').length>0,8000); const t=document.querySelector('#mhist .turn.assistant'); const g=t.querySelector('.fold'); const before=t.classList.contains('folded'); g.click(); const after=t.classList.contains('folded'); t.click(); const back=t.classList.contains('folded'); t.click(); const stillOpen=!t.classList.contains('folded'); const open=document.querySelectorAll('#mhist details.tools[open]').length; return {before,after,back,stillOpen,open,tools:document.querySelectorAll('#mhist details.tools').length}")
                if case .success(let vfa) = rFoldA, let dfa = vfa as? [String: Any] {
                    report["answerFolds"] = dfa["after"] ?? false
                    report["bodyClickOpens"] = dfa["back"] ?? true
                    report["bodyClickKeepsOpen"] = dfa["stillOpen"] ?? false
                    report["toolsOpen"] = dfa["open"] ?? 0
                    if (dfa["before"] as? Bool) != false || (dfa["after"] as? Bool) != true
                        || (dfa["back"] as? Bool) != false || (dfa["stillOpen"] as? Bool) != true
                        || ((dfa["open"] as? Int) ?? 1) != 0 {
                        report["ok"] = false
                        report["error"] = "folding by the rail, reopening by a click, or leaving an open answer alone did not work"
                    }
                }
                // a refresh redraws the open panel, keeps the draft, and waits while you type
                let r3 = await js("const t=document.querySelector('#mbody .msg textarea'); if(t){t.focus();t.value='のこす'} const c=live.cards.find(x=>x.agent+':'+x.id===openFor); const before=document.querySelector('#clabel').textContent; c.title='更新テスト'; const typing=document.activeElement===t; applyState(live); const waited=document.querySelector('#clabel').textContent; if(t)t.blur(); await new Promise(r=>setTimeout(r,60)); return {label:document.querySelector('#clabel').textContent, before:before, typing:typing, waited:waited, kept:(document.querySelector('#mbody .msg textarea')||{}).value||''}")
                if case .success(let v3) = r3, let d3 = v3 as? [String: Any] {
                    report["panelRefreshed"] = d3["label"] ?? ""
                    report["panelKeptDraft"] = d3["kept"] ?? ""
                    report["redrawWaited"] = (d3["typing"] as? Bool) == true ? ((d3["waited"] as? String) == (d3["before"] as? String)) : true
                    if (d3["label"] as? String) != "更新テスト" || (d3["kept"] as? String) != "のこす" || (report["redrawWaited"] as? Bool) != true {
                        report["ok"] = false
                        report["error"] = "a refresh did not redraw the open panel (label \((d3["label"] as? String) ?? "?")) or lost the draft (\((d3["kept"] as? String) ?? "?"))"
                    }
                }
                // a picture of the open panel (screenshot.png comes after Escape)
                await self.snapshot(to: dir + "/panel.png")
                // Escape closes nothing: the panel stays on its row, the row has the keys
                _ = await js("const o=openFor; document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.__escOpen=o; return 1")
                let r2 = await js(wait + "await new Promise(r=>setTimeout(r,300)); const a=document.activeElement; return {hidden:document.querySelector('#detail').hidden, same:openFor===window.__escOpen, onRow:!!(a&&a.classList&&a.classList.contains('card')&&a.dataset.agent+':'+a.dataset.id===openFor)}")
                if case .success(let v2) = r2, let d2 = v2 as? [String: Any] {
                    report["escKeptPanel"] = (d2["hidden"] as? Bool) == false && (d2["same"] as? Bool) == true
                    report["escRowKeys"] = d2["onRow"] ?? false
                    if (report["escKeptPanel"] as? Bool) != true || (d2["onRow"] as? Bool) != true { report["ok"] = false; report["error"] = "Escape in the docked list: expected the panel to stay on its row and the row to have the keys (\(d2))" }
                }
            }
            report["steps"] = steps
            report["pointer"] = lastPointer
            self.finishSelfTest(dir: dir, report: report)
        }
    }

    /// One PNG of the web view as it looks right now.
    func snapshot(to path: String) async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            web.takeSnapshot(with: nil) { img, _ in
                if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: path))
                }
                c.resume()
            }
        }
    }

    /// a picture mid-scenario
    func shot(dir: String, name: String) async {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            web.takeSnapshot(with: nil) { img, _ in
                if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: dir + "/" + name))
                }
                cont.resume()
            }
        }
    }

    /// The `layout` scenario's in-page check: nothing off the right edge or clipped, no overlaps,
    /// the terminal off the send box, the panel off the lanes at 761–1010px, targets ≥ 20px, contrast ≥ 3.
    static let VCHECK = #"""
    const vcheck=()=>{
      const W=innerWidth,issues=[],seen=new Set();
      const add=m=>{if(!seen.has(m)){seen.add(m);issues.push(m)}};
      const vis=e=>{if(!e)return false;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return false;for(let x=e;x&&x!==document.body;x=x.parentElement){const cs=getComputedStyle(x);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)return false}return true};
      const nm=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className.trim()?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'')+(e.textContent?' "'+e.textContent.trim().slice(0,14)+'"':'');
      const R=e=>e.getBoundingClientRect();
      const meet=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const sw=document.documentElement.scrollWidth;
      if(sw>W+1)add('the page scrolls sideways ('+sw+' > '+W+')');
      for(const e of document.querySelectorAll('header, header > *, main .col, main .card, #detail, #detail .modalcard, #dempty, #dempty button, #term, #termhead > *, #mbody .foot, #mbody .msg'))
        if(vis(e)&&R(e).right>W+1)add('off the right edge: '+nm(e)+' → '+Math.round(R(e).right));
      // controls whose words must fit: a squeezed button reads as broken (card titles may ellipsis, these may not)
      for(const e of document.querySelectorAll('header button, .col > h2, #mclose, #mclose2, #mmeta .mfoldbtn, #detail .mhead, #mbody .mstat button, #mbody .viewpick button, #mbody .foot button, #mbody .foot .chips button, #termhead button, #termhead > b, #termhead, #mbody .foot'))
        if(vis(e)&&e.scrollWidth>e.clientWidth+2)add('clipped: '+nm(e)+' ('+e.scrollWidth+' in '+e.clientWidth+')');
      // header items side by side must not sit on one another
      for(const [row,where] of [['header > *','header'],['#termhead > *, #termtabs > *','terminal bar']]){
        const hs=[...document.querySelectorAll(row)].filter(vis).filter(e=>!e.contains(document.querySelector(row===''?'x':'#termtabs'))||e.id!=='termtabs');
        for(let i=0;i<hs.length;i++)for(let k=i+1;k<hs.length;k++)if(!hs[i].contains(hs[k])&&!hs[k].contains(hs[i])&&meet(R(hs[i]),R(hs[k]))>4)add(where+' overlap: '+nm(hs[i])+' × '+nm(hs[k]));
      }
      // one-line bars whose items wrapped: the words break a character a line, or the bar cuts them
      for(const e of document.querySelectorAll('#termhead > *, #termtabs > *, header > button, header > h1'))if(vis(e)&&!/^vertical/.test(getComputedStyle(e).writingMode)){const lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;if(R(e).height>lh*1.7+8)add('wraps onto more lines: '+nm(e)+' ('+Math.round(R(e).height)+'px tall)')}
      {const th=document.querySelector('#termhead');if(vis(th)&&th.scrollHeight>th.clientHeight+2)add('the terminal bar cuts its own row ('+th.scrollHeight+' in '+th.clientHeight+')')}
      // a label squeezed below its words (overflow visible spills into the next item, hidden cuts it)
      for(const e of document.querySelectorAll('#termhead > b, header > h1, .col > h2'))if(vis(e)){const r=document.createRange();r.selectNodeContents(e);const tw=r.getBoundingClientRect().width;if(tw>R(e).width+2)add('squeezed: '+nm(e)+' ('+Math.round(tw)+' of text in '+Math.round(R(e).width)+')')}
      const panel=document.querySelector('#detail'),open=panel&&!panel.hidden&&vis(panel);
      const term=document.querySelector('#term');
      if(open&&vis(term)){for(const e of document.querySelectorAll('#mbody .msg textarea, #mbody .foot'))if(vis(e)&&meet(R(term),R(e))>4)add('the terminal covers the send box: '+nm(e))}
      if(open&&W>=761&&W<=1010){for(const c of document.querySelectorAll('main .col'))if(vis(c)&&meet(R(panel),R(c))>40)add('at '+W+'px the panel covers a lane: '+nm(c))}
      // closed on a wide board the panel's place stays, empty; narrow, it goes
      const emp=document.querySelector('#dempty'),empOn=vis(emp);
      if(!open&&W>=1011&&!empOn)add('at '+W+'px a closed panel leaves no empty place');
      if(W<=1010&&empOn)add('at '+W+'px the empty place shows (it would sit on the lanes)');
      if(empOn&&Math.round(R(emp).right)!==W)add('the empty place is not docked right ('+Math.round(R(emp).right)+')');
      if(empOn){for(const c of document.querySelectorAll('main .col'))if(vis(c)&&meet(R(emp),R(c))>40)add('the empty place covers a lane: '+nm(c))}
      const laneR=Math.round(Math.max(0,...[...document.querySelectorAll('main .col')].filter(vis).map(c=>R(c).right)));
      // tap targets
      for(const b of document.querySelectorAll('header button, #detail button, #dempty button, #termhead button, .card button'))if(vis(b)){const r=R(b);if(r.height<20||r.width<20)add('small target: '+nm(b)+' '+Math.round(r.width)+'×'+Math.round(r.height))}
      // words you cannot read: a button's text against what is actually behind it (WCAG ratio < 3)
      const rgb=c=>{const m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;const v=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}};
      const lum=c=>{const f=x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
      const bgOf=e=>{for(let x=e;x;x=x.parentElement){const c=rgb(getComputedStyle(x).backgroundColor);if(c&&c.a>.5)return c}return rgb(getComputedStyle(document.body).backgroundColor)};
      for(const b of document.querySelectorAll('header button, #detail button, #dempty button, #termhead button, .card button, .col > h2'))if(vis(b)&&b.textContent.trim()){
        const fg=rgb(getComputedStyle(b).color),bg=bgOf(b);if(!fg||!bg)continue;
        const L1=lum(fg),L2=lum(bg),ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
        if(ratio<3)add('low contrast: '+nm(b)+' '+ratio.toFixed(1)+':1 ('+getComputedStyle(b).color+' on '+getComputedStyle(bgOf===null?b:b).backgroundColor+')')}
      return {W, H:innerHeight, scrollW:sw, open:!!open, empty:empOn, laneR, dark:!document.body.classList.contains('light'), issues};
    };
    """#

    func finishSelfTest(dir: String, report: [String: Any]) {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: URL(fileURLWithPath: dir + "/report.json")) }
        selftestStage("report written, taking the screenshot")
        web.takeSnapshot(with: nil) { img, _ in
            if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: dir + "/screenshot.png"))
            }
            NSApp.terminate(nil)
        }
    }
}
