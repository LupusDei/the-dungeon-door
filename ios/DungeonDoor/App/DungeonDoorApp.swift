import SwiftUI

@main
struct DungeonDoorApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(model)
                .tint(Palette.gold)
                .preferredColorScheme(.dark)
                .task {
                    await model.refresh()
                    await model.resumeIfPossible()
                }
        }
    }
}
