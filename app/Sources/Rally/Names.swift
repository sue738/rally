import Foundation

/// The product's name first, then its legacy names (read for old data dirs, variables, sockets).
/// lib/names.js holds the same list; scripts/rename.py changes both.
enum Names {
    static let all = [
        "rally", // rename:keep
        "hotaru",
        "ika",
        "genba",
        "agentkanban",
    ]
}
