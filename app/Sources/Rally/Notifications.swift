// Notifications and the menu bar's permission count (AppDelegate extension;
// its stored properties are in main.swift).
import AppKit
import WebKit
import ServiceManagement
import Carbon.HIToolbox
import UserNotifications

extension AppDelegate {
    func notify(key: String, title: String, body: String, perm: String = "") {
        let c = UNUserNotificationCenter.current()
        let post = {
            let n = UNMutableNotificationContent()
            n.title = title; n.body = body; n.sound = .default
            n.userInfo = ["key": key, "perm": perm]
            if !perm.isEmpty { n.categoryIdentifier = "ak-perm" }
            // one notification per card: a newer one replaces it
            c.add(UNNotificationRequest(identifier: key.isEmpty ? UUID().uuidString : "ak-" + key, content: n, trigger: nil)) { err in
                if let err { self.logLine(["ev": "notify-failed", "error": err.localizedDescription]) }
            }
        }
        if notifyAsked { post(); return }
        c.requestAuthorization(options: [.alert, .sound, .badge]) { granted, err in
            DispatchQueue.main.async {
                self.notifyAsked = true
                if !granted { self.logLine(["ev": "notify-denied", "error": err?.localizedDescription ?? ""]) }
                post()
            }
        }
    }

    /// Re-asked each time the app comes forward: the switch is in System Settings.
    func sendNotifyState() {
        if selftesting { return }
        UNUserNotificationCenter.current().getNotificationSettings { st in
            let status: String
            switch st.authorizationStatus {
            case .authorized, .provisional: status = st.alertSetting == .disabled ? "silent" : "on"
            case .denied: status = "denied"
            case .notDetermined: status = "ask"
            default: status = "on"
            }
            DispatchQueue.main.async { self.call("window.__kanban&&window.__kanban.notifyState&&window.__kanban.notifyState({status:'\(status)'})") }
        }
    }
    func watchActive() {
        if watchingActive { return }; watchingActive = true
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.sendNotifyState() }
    }
    /// macOS asks only the first time; after a no, only System Settings can change it.
    func askNotify() {
        UNUserNotificationCenter.current().getNotificationSettings { st in
            DispatchQueue.main.async {
                if st.authorizationStatus == .notDetermined {
                    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in DispatchQueue.main.async { self.notifyAsked = true; self.sendNotifyState() } }
                } else {
                    let id = Bundle.main.bundleIdentifier ?? "dev.sue738.rally"
                    let urls = ["x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)", "x-apple.systempreferences:com.apple.preference.notifications"]
                    for u in urls { if let url = URL(string: u), NSWorkspace.shared.open(url) { break } }
                }
            }
        }
    }

    // no banner while the board is in front
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done(NSApp.isActive && (window?.isKeyWindow ?? false) ? [] : [.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let key = (info["key"] as? String) ?? ""
        let perm = (info["perm"] as? String) ?? ""
        // Allow / Deny from the banner answers that request only (`perm --answer` refuses a stale one)
        if ["ak-allow", "ak-deny"].contains(response.actionIdentifier), perm.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil {
            let decision = response.actionIdentifier == "ak-allow" ? "allow" : "deny"
            actQueue.async {
                let (out, code) = self.runNode(["perm", "--id", perm, "--answer", decision])
                self.logLine(["ev": "perm-from-notification", "decision": decision, "code": Int(code), "out": String(out.prefix(200))])
                DispatchQueue.main.async { self.call("window.__kanban.permChanged()"); done() }
            }
            return
        }
        DispatchQueue.main.async { self.openFromNotification(key); done() }
    }

    /// Menu bar item: sessions held on a permission prompt, shown only while there are some.
    func setAsks(_ items: [(String, String)]) {
        if items.map({ $0.0 + "\u{0}" + $0.1 }) == asksShown.map({ $0.0 + "\u{0}" + $0.1 }) { return }
        asksShown = items
        if items.isEmpty {
            if let s = statusItem { NSStatusBar.system.removeStatusItem(s); statusItem = nil }
            return
        }
        let s = statusItem ?? NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = s
        s.button?.title = "許可 \(items.count)"
        s.button?.toolTip = "Rally: 許可を待っているセッション"
        let m = NSMenu()
        for (k, t) in items {
            let it = NSMenuItem(title: t, action: #selector(openAsk(_:)), keyEquivalent: "")
            it.target = self; it.representedObject = k
            m.addItem(it)
        }
        m.addItem(.separator())
        let b = NSMenuItem(title: "ボードを開く", action: #selector(openBoardFromMenu), keyEquivalent: ""); b.target = self
        m.addItem(b)
        s.menu = m
    }
    @objc func openAsk(_ sender: NSMenuItem) { openFromNotification((sender.representedObject as? String) ?? "") }
    @objc func openBoardFromMenu() { showBoard() }

    func openFromNotification(_ key: String) {
        showBoard()
        guard !key.isEmpty, let data = try? JSONSerialization.data(withJSONObject: [key]),
              let arg = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__kanban.focus(\(arg)[0])", completionHandler: nil)
    }
}
