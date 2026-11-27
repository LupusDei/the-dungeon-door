import SwiftUI

@main
struct DungeonDoorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            root
                .environment(model)
                .tint(Palette.gold)
                .preferredColorScheme(.dark)
                .task { await launch() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await PushCenter.shared.refreshLeave() } }
                }
        }
    }

    @ViewBuilder private var root: some View {
        #if DEBUG
        if DemoLaunch.screen != nil {
            DemoRoot(model: model)
        } else {
            HomeView()
        }
        #else
        HomeView()
        #endif
    }

    @MainActor private func launch() async {
        #if DEBUG
        if DemoLaunch.screen != nil { return }
        #endif
        PushCenter.shared.start(api: model.api)
        PushCenter.shared.onArrival = { news in if news.isInvite { Task { await model.refreshInvitations() } } }
        await model.refresh()
        // Leave to notify is asked as soon as the server is known to send pushes, not only once the
        // player is in a party: an invitation is a push too. Not awaited, so the game opens behind it.
        if model.catalog?.push == true { Task { await PushCenter.shared.enable() } }
        await model.resumeIfPossible()
        if let news = AppConfig.pushOpenArgument { await model.open(news) }
    }
}
