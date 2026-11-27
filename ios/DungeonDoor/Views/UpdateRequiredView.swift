import SwiftUI

/// Blocks the table until this install is new enough to play. An older build never sees this screen:
/// it shows the server's sentence on the action it tried (Open the door, a vote).
struct UpdateRequiredView: View {
    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "arrow.down.app.fill")
                .font(.system(size: 44))
                .foregroundStyle(Palette.gold)
                .accessibilityHidden(true)
            Text("Update the app")
                .font(.display(28))
            Text("This version of The Dungeon Door is no longer supported. Install the latest build from TestFlight, then open the app again.")
                .font(.prose)
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.parchment.opacity(0.9))
            if let url = AppConfig.updateURL {
                Link(destination: url) {
                    Label("Get the update", systemImage: "arrow.down.app")
                }
                .buttonStyle(.gilded)
            }
            Spacer()
        }
        .padding(28)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .screenChrome()
    }
}
