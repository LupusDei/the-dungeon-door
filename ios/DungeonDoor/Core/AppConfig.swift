import Foundation

/// Where the server is and who this device plays as.
///
/// Launch arguments (handy from run.sh): `-apiBase http://localhost:3000` points at a local dev
/// server, `-openGame ABCDEF` drops straight into a game, `-playerId <uuid>` plays as someone else.
enum AppConfig {
    static var apiBase: URL {
        let defaults = UserDefaults.standard
        if let override = defaults.string(forKey: "apiBase"), let url = URL(string: override) { return url }
        let plist = Bundle.main.object(forInfoDictionaryKey: "DDAPIBase") as? String
        return URL(string: plist ?? "") ?? URL(string: "https://the-dungeon-door.vercel.app")!
    }

    static var appKey: String? {
        (Bundle.main.object(forInfoDictionaryKey: "DDAppKey") as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// A random id made on first launch. There's no sign-in in the MVP.
    static var playerId: String {
        let defaults = UserDefaults.standard
        if let forced = defaults.string(forKey: "playerId"), !forced.isEmpty { return forced }
        if let saved = defaults.string(forKey: "dd.playerId") { return saved }
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: "dd.playerId")
        return fresh
    }

    static var openGameArgument: String? {
        UserDefaults.standard.string(forKey: "openGame")?.uppercased()
    }
}
