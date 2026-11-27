import SwiftUI

/// Under a scene's title: how much of the adventure is left. With a set length, the scenes still to
/// come before the ending; with none, that it goes on, and for the host the way to call the ending.
struct ScenesToGo: View {
    @Bindable var session: GameSession
    @State private var confirming = false

    private var state: GameState { session.state }

    var body: some View {
        if let line {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(line, systemImage: symbol)
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(lastScene ? Palette.gold : Palette.muted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if canCallEnding {
                    Button("Call the ending") { confirming = true }
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay { Capsule().strokeBorder(Palette.gold.opacity(0.6), lineWidth: 1) }
                        .buttonStyle(.plain)
                        .disabled(session.busy)
                }
            }
            .padding(.top, 4)
            .confirmationDialog("Call the ending?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Make this the last scene") { Task { await session.callEnding() } }
                Button("Keep going", role: .cancel) {}
            } message: {
                Text(state.scene?.combat == true
                     ? "When this fight is over, the dungeon master tells the ending. It cannot be undone."
                     : "The party finishes this scene, then the dungeon master tells the ending. It cannot be undone.")
            }
        }
    }

    /// The scene being played is the last one with choices.
    private var lastScene: Bool { state.scenesLeft == 0 && state.scene?.isFinale == false }

    /// Past the scenes planned with the quest's goal not yet reached: the adventure goes on toward it.
    private var pastThePlan: Bool {
        !state.openEnded && state.scenesLeft == nil && state.rules?.quest?.reached == false
    }

    /// Only the host, only while the table is choosing, and only where there is no ending in sight.
    private var canCallEnding: Bool {
        (state.openEnded || pastThePlan) && session.isHost && state.status == .voting && state.scene?.isFinale == false
    }

    private var symbol: String { state.openEnded ? "infinity" : lastScene ? "flag.checkered" : pastThePlan ? "scope" : "hourglass" }

    private var line: String? {
        guard let scene = state.scene, !scene.isFinale, state.status != .ended else { return nil }
        if state.openEnded {
            return session.isHost ? "No set length. It goes on until you call the ending."
                                  : "No set length. It goes on until the host calls the ending."
        }
        if pastThePlan { return "Past the plan. It ends when the goal is reached" }
        guard let left = state.scenesLeft else { return nil }
        switch left {
        case 0: return scene.combat ? "The ending follows this fight" : "The last scene. The ending follows"
        case 1: return "1 scene to go before the ending"
        default: return "\(left) scenes to go before the ending"
        }
    }
}
