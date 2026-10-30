import Foundation

/// The app's environment variables: <NAME>_<var> under the current name, else under an earlier one
/// (Names.all, newest first); lib/env.js does the same for the CLI.
enum Env {
    static func get(_ name: String) -> String? {
        let e = ProcessInfo.processInfo.environment
        for n in Names.all { if let v = e[n.uppercased() + "_" + name] { return v } }
        return nil
    }
}

/// The app's language, "ja" or "en": the one picked on the page (UserDefaults "lang"), else the system's first.
/// Node started from the app gets it as RALLY_LANG (lib/i18n.js), so the board and the CLI speak the same.
enum Lang {
    static var current: String {
        if Env.get("SELFTEST") != nil { return "ja" }   // the selftest reads the Japanese as written
        if let v = UserDefaults.standard.string(forKey: "lang"), v == "ja" || v == "en" { return v }
        return (Locale.preferredLanguages.first ?? "").lowercased().hasPrefix("ja") ? "ja" : "en"
    }
    /// Every process started from now on inherits it (Process, the pty host and the node worker read this environment).
    /// What the page is told when its own localStorage has no "lang" yet: the one picked here, or the selftest's.
    static var stored: String? {
        if Env.get("SELFTEST") != nil { return "ja" }
        if let v = UserDefaults.standard.string(forKey: "lang"), v == "ja" || v == "en" { return v }
        return nil
    }
    static func export() { setenv(Names.all[0].uppercased() + "_LANG", current, 1) }
}

/// The words in the app's language: L("日本語", "English").
func L(_ ja: String, _ en: String) -> String { Lang.current == "ja" ? ja : en }
