import Foundation

/// Moves a legacy data directory (Names.all) to ~/.rally before the app reads it, as lib/paths.js
/// migrate() does: one atomic rename, then a link at the old path so old hooks and a running
/// host's pty.sock keep resolving. If the link can't be made the rename is undone.
enum DataDir {
    /// 'migrated' | 'none' | 'linked' | 'both' | 'failed' (what migrate() in lib/paths.js returns)
    static var result = "none"

    private static func kind(_ p: String) -> String {
        var st = stat()
        if lstat(p, &st) != 0 { return "none" }
        if (st.st_mode & S_IFMT) == S_IFLNK { return "link" }
        return (st.st_mode & S_IFMT) == S_IFDIR ? "dir" : "file"
    }

    @discardableResult
    static func migrate() -> String {
        // $HOME, not NSHomeDirectory(): under the selftest HOME is the fixture home, and the
        // migration must never touch the user's real data directory
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let new = home + "/." + Names.all[0]
        let olds = Names.all.dropFirst().map { home + "/." + $0 }
        guard let src = olds.first(where: { kind($0) == "dir" }) else {
            result = olds.contains(where: { kind($0) == "link" }) ? "linked" : "none"; return result
        }
        if kind(new) != "none" { result = "both"; return result }
        if rename(src, new) != 0 { result = "failed"; return result }
        if symlink("." + Names.all[0], src) != 0 {
            _ = rename(new, src)
            result = "failed"; return result
        }
        result = "migrated"; return result
    }
}
