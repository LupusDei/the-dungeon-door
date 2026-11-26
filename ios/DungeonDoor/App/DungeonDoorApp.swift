import SwiftUI

@main
struct DungeonDoorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(model)
                .tint(Palette.gold)
                .preferredColorScheme(.dark)
                .task {
                    PushCenter.shared.start(api: model.api)
                    PushCenter.shared.onArrival = { news in if news.isInvite { Task { await model.refreshInvitations() } } }
                    await model.refresh()
                    await model.resumeIfPossible()
                    if let news = AppConfig.pushOpenArgument { await model.open(news) }
                }
                // Back from the background: leave to notify may have changed in Settings.
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await PushCenter.shared.refreshLeave() } }
                }
        }
    }
}
