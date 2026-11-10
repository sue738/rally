// A newer release, said once (AppDelegate extension). At most once a day the app asks GitHub for
// sue738/rally's latest release; when it is newer than this build, the Rally menu gets
// "Update Available: vX…" (opens the release page) and one notification is posted per version.
// Nothing is downloaded or installed. RALLY_NO_UPDATE_CHECK=1 turns the check off.
//
// The same daily check also fetches the price list (lib/rates.json on main): model prices change more often
// than the app is released. It is left at ~/.rally/rates.json for lib/price.js, which uses it only when it is
// well-formed and dated later than this build's own. Numbers under model names: nothing in it is run.
import AppKit

enum Update {
    static let api = URL(string: "https://api.github.com/repos/sue738/rally/releases/latest")!
    static let rates = URL(string: "https://raw.githubusercontent.com/sue738/rally/main/lib/rates.json")!
    /// lib/price.js reads no more than this
    static let ratesMax = 65536
    static let day: TimeInterval = 24 * 60 * 60
    static var off: Bool { Env.get("NO_UPDATE_CHECK") != nil }
    static var current: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
    /// installed with `brew install --cask`: the notification names the command
    static var fromBrew: Bool {
        ["/opt/homebrew/Caskroom/rally", "/usr/local/Caskroom/rally"].contains { FileManager.default.fileExists(atPath: $0) }
    }

    /// "v1.2.10" is newer than "1.2.9"; a tag that is not dotted numbers never is
    static func newer(_ tag: String, than cur: String) -> Bool {
        func parts(_ s: String) -> [Int]? {
            let t = s.hasPrefix("v") ? String(s.dropFirst()) : s
            let p = t.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
            return p.isEmpty || p.contains(where: { $0 == nil }) ? nil : p.compactMap { $0 }
        }
        guard let a = parts(tag), let b = parts(cur) else { return false }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// the release page, and only one of this repository's (the menu and the notification open it)
    static func page(_ s: String?) -> URL? {
        guard let s, let u = URL(string: s), u.scheme == "https", u.host == "github.com",
              u.path.hasPrefix("/sue738/rally/releases/") else { return nil }
        return u
    }
}

extension AppDelegate {
    /// at launch: what the last check found shows at once; the next check waits for its day
    func startUpdateCheck() {
        if selftesting || Update.off { return }
        showUpdate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.checkForUpdate() }
        // a board left open for days still hears of a release
        Timer.scheduledTimer(withTimeInterval: 6 * 60 * 60, repeats: true) { [weak self] _ in self?.checkForUpdate() }
    }

    func checkForUpdate() {
        let d = UserDefaults.standard, now = Date().timeIntervalSince1970
        if now - d.double(forKey: "update.checkedAt") < Update.day { return }
        d.set(now, forKey: "update.checkedAt")
        fetchRates()
        var req = URLRequest(url: Update.api, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Rally/" + Update.current, forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = j["tag_name"] as? String, let url = Update.page(j["html_url"] as? String) else {
                DispatchQueue.main.async { self.logLine(["ev": "update-check-failed", "status": code]) }
                return
            }
            DispatchQueue.main.async {
                d.set(tag, forKey: "update.tag"); d.set(url.absoluteString, forKey: "update.url")
                self.logLine(["ev": "update-check", "latest": tag, "current": Update.current])
                self.showUpdate()
            }
        }.resume()
    }

    /// The repository's price list, saved as it came when it looks like one (lib/price.js checks every row).
    func fetchRates() {
        var req = URLRequest(url: Update.rates, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("Rally/" + Update.current, forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data, data.count <= Update.ratesMax,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let asof = j["asof"] as? String, j["claude"] is [String: Any] else {
                DispatchQueue.main.async { self.logLine(["ev": "rates-failed", "status": code]) }
                return
            }
            let dir = Env.get("HOME") ?? (FileManager.default.homeDirectoryForCurrentUser.path + "/.rally")
            let saved = (try? data.write(to: URL(fileURLWithPath: dir + "/rates.json"), options: .atomic)) != nil
            DispatchQueue.main.async { self.logLine(["ev": "rates", "asof": asof, "saved": saved]) }
        }.resume()
    }

    /// the menu item while a newer release is known, and its one notification
    func showUpdate() {
        let d = UserDefaults.standard
        guard let menu = NSApp.mainMenu?.items.first?.submenu else { return }
        if let old = menu.items.first(where: { $0.identifier?.rawValue == "update" }) { menu.removeItem(old) }
        guard let tag = d.string(forKey: "update.tag"), Update.newer(tag, than: Update.current),
              let url = Update.page(d.string(forKey: "update.url")) else { return }
        let item = NSMenuItem(title: L("新しい版 \(tag) があります…", "Update Available: \(tag)…"), action: #selector(openUpdate), keyEquivalent: "")
        item.identifier = NSUserInterfaceItemIdentifier("update")
        item.target = self
        menu.insertItem(item, at: 0)
        if d.string(forKey: "update.notified") == tag { return }
        d.set(tag, forKey: "update.notified")
        let how = Update.fromBrew
            ? L("brew upgrade --cask rally で更新できます", "Run brew upgrade --cask rally to update")
            : L("リリースページから入れなおせます", "Get it from the release page")
        notify(key: "", title: L("Rally \(tag) が出ています", "Rally \(tag) is out"), body: how, url: url.absoluteString)
    }

    @objc func openUpdate() {
        if let u = Update.page(UserDefaults.standard.string(forKey: "update.url")) { workspaceOpen(u) }
    }
}
