import Observation
import SwiftUI
import UIKit
import UserNotifications

/// What a push from the server is about (docs/push.md): the kind of news and the game.
struct PushNews: Equatable {
    /// "turn", "combat", "chat" or "invite".
    let kind: String
    /// The game's door code.
    let code: String

    var isInvite: Bool { kind == "invite" }

    init?(_ userInfo: [AnyHashable: Any]) {
        guard let kind = userInfo["kind"] as? String, let code = userInfo["code"] as? String, code.count == 6 else { return nil }
        self.kind = kind
        self.code = code.uppercased()
    }

    /// `-pushOpen kind:CODE`, the debug stand-in for tapping a notification.
    init?(argument: String) {
        let parts = argument.split(separator: ":").map(String.init)
        guard parts.count == 2 else { return nil }
        self.init(["kind": parts[0], "code": parts[1]])
    }
}

/// Push notifications on this device: asking leave, telling the server this device's token, and
/// deciding what a push does when it lands or is tapped.
///
/// The server sends a push when it is the player's turn, when a combat round needs their action,
/// when the party chats and when a companion invites them (docs/push.md). It already holds back
/// pushes about a game the player is looking at; the app does the same for the moment in between.
@MainActor @Observable
final class PushCenter: NSObject, UNUserNotificationCenterDelegate {
    enum Leave { case unknown, notAsked, granted, refused }

    static let shared = PushCenter()

    /// Whether iOS lets the app notify.
    private(set) var leave: Leave = .unknown
    /// The player's own switch (on unless they turn it off). Off tells the server to forget this device.
    var wanted: Bool = UserDefaults.standard.object(forKey: "dd.pushOn") == nil || UserDefaults.standard.bool(forKey: "dd.pushOn") {
        didSet {
            guard wanted != oldValue else { return }
            UserDefaults.standard.set(wanted, forKey: "dd.pushOn")
            Task { await wanted ? enable() : disable() }
        }
    }
    /// A tapped notification the app has not acted on yet. The home screen takes it.
    var tapped: PushNews?
    /// Called when a push arrives while the app is open (an invitation to show, say).
    var onArrival: ((PushNews) -> Void)?
    /// The game on screen, so a push about it stays quiet.
    var openGame: String?

    private var api: APIClient?
    private var token: String? { didSet { UserDefaults.standard.set(token, forKey: "dd.pushToken") } }

    private override init() {
        token = UserDefaults.standard.string(forKey: "dd.pushToken")
        super.init()
    }

    /// True when pushes reach this device: iOS allows them and the player wants them.
    var isOn: Bool { leave == .granted && wanted }

    /// Called once at launch.
    func start(api: APIClient) {
        self.api = api
        UNUserNotificationCenter.current().delegate = self
        Task {
            await refreshLeave()
            if isOn { register() }
        }
    }

    func refreshLeave() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: leave = .notAsked
        case .denied: leave = .refused
        default: leave = .granted
        }
    }

    /// Asks iOS for leave the first time the app opens on a server that sends pushes (an invitation
    /// has to be able to reach a player who is in no party yet), and registers the device whenever
    /// leave is already given. Safe to call again: a second call waits for the first one's answer.
    func enable() async {
        if let asking { return await asking.value }
        let task = Task { await ask() }
        asking = task
        await task.value
        asking = nil
    }

    private var asking: Task<Void, Never>?

    private func ask() async {
        guard wanted else { return }
        await refreshLeave()
        if leave == .notAsked {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
            leave = granted ? .granted : .refused
        }
        if leave == .granted { register() }
    }

    private func register() {
        #if !targetEnvironment(simulator) || arch(arm64)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }

    private func disable() async {
        guard let token, let api else { return }
        try? await api.unregisterDevice(token: token)
    }

    /// iOS handed over this device's token: tell the server (again each launch, in case it changed).
    func registered(token data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        guard wanted, let api else { return }
        Task { try? await api.registerDevice(token: hex, environment: Self.environment) }
    }

    /// Builds from Xcode talk to Apple's sandbox; TestFlight and the App Store to production.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    // MARK: UNUserNotificationCenterDelegate

    /// A push while the app is open: quiet when it is about the game on screen, a banner otherwise.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let userInfo = notification.request.content.userInfo
        return await MainActor.run {
            guard let news = PushNews(userInfo) else { return [.banner, .list, .sound] }
            onArrival?(news)
            return !news.isInvite && news.code == openGame ? [] : [.banner, .list, .sound]
        }
    }

    /// The player tapped a push.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let userInfo = response.notification.request.content.userInfo
        await MainActor.run { tapped = PushNews(userInfo) }
    }
}

/// UIKit's hooks for the device token; SwiftUI has none.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushCenter.shared.registered(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("[DungeonDoor] no push token: \(error.localizedDescription)")
        #endif
    }
}

/// Where the party gathers: whether this device will be called when it is the player's turn, and
/// the switch for it. When iOS has refused, the way to its settings.
struct NotificationsRow: View {
    @State private var push = PushCenter.shared

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: push.isOn ? "bell.badge.fill" : "bell.slash.fill")
                .font(.system(size: 17))
                .foregroundStyle(push.isOn ? Palette.gold : Palette.muted)
                .frame(width: 26)
                .accessibilityHidden(true)
            if push.leave == .refused {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Notifications are off").font(.display(16))
                    Text("Turn them on in Settings to be called when it is your turn, when the party talks and when a fight needs you.")
                        .font(.footnote)
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                }
                Spacer(minLength: 0)
            } else {
                Toggle(isOn: $push.wanted) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Call me back").font(.display(16))
                        Text("A notification when it is your turn, when the party talks and when a fight needs you.")
                            .font(.footnote)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(Palette.gold)
            }
        }
        .padding(14)
        .card()
    }
}
