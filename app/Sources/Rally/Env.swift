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
