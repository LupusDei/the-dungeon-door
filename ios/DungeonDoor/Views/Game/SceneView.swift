import SwiftUI

/// One scene: the art, the dungeon master's narration, three choices and the party's votes.
/// Also the finale, which has no choices.
struct SceneView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var revealedRoll: Int?

    private var state: GameState { session.state }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if let scene = state.scene {
                    VStack(alignment: .leading, spacing: 20) {
                        header(scene)
                        IllustrationView(url: scene.imageURL)
                        if let last = state.chronicle?.last, last.index == scene.index - 1 {
                            previously(last)
                        }
                        narration(scene)
                        if scene.isFinale {
                            finale
                        } else {
                            choices(scene).id("choices")
                            status(scene)
                        }
                        ErrorLine(text: session.error)
                    }
                    .padding(20)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .id(scene.index)
                }
            }
            .onChange(of: state.scene?.index) { _, _ in
                revealedRoll = nil
                withAnimation { proxy.scrollTo(state.scene?.index, anchor: .top) }
            }
        }
        .overlay {
            if state.status == .resolving { ResolvingOverlay(votes: state.scene?.votes ?? [], players: state.players) }
        }
        .animation(.easeInOut, value: state.status)
    }

    private func header(_ scene: GameScene) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(scene.isFinale ? "Finale" : "Scene \(scene.index + 1) of \(state.sceneCount)")
            Text(scene.title).font(.display(28, weight: .bold))
        }
    }

    private func previously(_ entry: ChronicleEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel("What came of it")
            Text("The party chose: \(entry.choiceLabel)").font(.proseSmall.weight(.semibold)).foregroundStyle(Palette.gold)
            Text(entry.outcome).font(.proseSmall.italic()).foregroundStyle(Palette.parchment.opacity(0.85))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .leading) { Rectangle().fill(Palette.gold.opacity(0.6)).frame(width: 2) }
    }

    private func narration(_ scene: GameScene) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(scene.narration.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: 18, design: .serif))
                    .lineSpacing(5)
            }
        }
        .textSelection(.enabled)
    }

    // MARK: Choices

    private func choices(_ scene: GameScene) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("What will you do?")
            ForEach(scene.choices) { choice in
                ChoiceCard(
                    choice: choice,
                    voters: scene.votes.filter { $0.choiceId == choice.id }.compactMap { state.player($0.playerId) },
                    mine: scene.myVote == choice.id,
                    enabled: state.status == .voting && !session.busy
                ) {
                    Task {
                        let firstVote = scene.myVote == nil
                        await session.vote(choice)
                        if firstVote, let roll = session.myVote?.roll {
                            withAnimation(.spring(duration: 0.6, bounce: 0.5)) { revealedRoll = roll }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func status(_ scene: GameScene) -> some View {
        let waitingOn = state.players.filter { p in !scene.votes.contains { $0.playerId == p.playerId } }
        VStack(spacing: 14) {
            if let roll = session.myVote?.roll {
                HStack(spacing: 14) {
                    D20Badge(roll: roll, size: 52)
                        .rotationEffect(.degrees(revealedRoll == nil ? 0 : 360))
                        .scaleEffect(revealedRoll == nil ? 1 : 1.08)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Your d20").font(.display(16))
                        Text(rollFlavor(roll)).font(.footnote.italic()).foregroundStyle(Palette.muted)
                    }
                    Spacer()
                }
                .padding(14)
                .card()
            }
            if state.status == .voting {
                if waitingOn.isEmpty {
                    Text("All votes are in.").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().tint(Palette.gold)
                        Text("Waiting on \(ListFormatter.localizedString(byJoining: waitingOn.map(\.character.name)))…")
                            .font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                    }
                    if session.isHost && !scene.votes.isEmpty {
                        Button("Proceed without them") { Task { await session.advance() } }
                            .buttonStyle(.gildedOutline)
                            .disabled(session.busy)
                    }
                }
            } else if state.status == .preparing {
                HStack(spacing: 8) {
                    ProgressView().tint(Palette.gold)
                    Text("The dungeon master is still writing…").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func rollFlavor(_ roll: Int) -> String {
        switch roll {
        case 20: "A natural 20! Fortune bends toward you."
        case 1: "A natural 1. Something will go wrong."
        case 15...19: "A strong roll."
        case 8...14: "A fair roll. Fate is undecided."
        default: "A poor roll. Tread carefully."
        }
    }

    // MARK: Finale

    private var finale: some View {
        VStack(spacing: 16) {
            Image(systemName: "laurel.leading")
                .font(.system(size: 34))
                .foregroundStyle(Palette.gold)
                .overlay(alignment: .trailing) {
                    Image(systemName: "laurel.trailing").font(.system(size: 34)).foregroundStyle(Palette.gold).offset(x: 40)
                }
                .offset(x: -20)
            Text("The End").font(.display(26, weight: .bold))
            Text("Your tale is written in the chronicle.").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
            Button("Return to the tavern") { model.closeGame() }
                .buttonStyle(.gilded)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }
}

private struct ChoiceCard: View {
    let choice: Choice
    let voters: [GamePlayer]
    let mine: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 14) {
                Text(choice.id.uppercased())
                    .font(.display(18, weight: .bold))
                    .foregroundStyle(mine ? Palette.ink : Palette.gold)
                    .frame(width: 34, height: 34)
                    .background(mine ? Palette.gold : Palette.raised, in: .circle)
                VStack(alignment: .leading, spacing: 6) {
                    Text(choice.label).font(.display(17)).multilineTextAlignment(.leading)
                    Text(choice.detail).font(.footnote).foregroundStyle(Palette.muted).multilineTextAlignment(.leading)
                    if !voters.isEmpty {
                        HStack(spacing: -8) {
                            ForEach(voters) { voter in
                                PortraitView(url: voter.character.portraitURL, size: 26, circular: true)
                            }
                            Text(voters.count == 1 ? voters[0].character.name : "\(voters.count) votes")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                                .padding(.leading, 14)
                        }
                        .transition(.opacity)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .card(highlighted: mine)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .animation(.snappy, value: voters.map(\.playerId))
        .accessibilityAddTraits(mine ? .isSelected : [])
    }
}

/// While the dungeon master weighs the votes: everyone's roll, laid out on the table.
private struct ResolvingOverlay: View {
    let votes: [Vote]
    let players: [GamePlayer]

    var body: some View {
        ZStack {
            Palette.ink.opacity(0.82).ignoresSafeArea()
            VStack(spacing: 22) {
                Text("The dungeon master weighs your fates…")
                    .font(.display(22, weight: .bold))
                    .multilineTextAlignment(.center)
                HStack(spacing: 18) {
                    ForEach(votes, id: \.playerId) { vote in
                        VStack(spacing: 8) {
                            PortraitView(url: players.first { $0.playerId == vote.playerId }?.character.portraitURL,
                                         size: 52, circular: true)
                            D20Badge(roll: vote.roll, size: 40)
                            Text(vote.choiceId.uppercased()).font(.caption.bold()).foregroundStyle(Palette.muted)
                        }
                    }
                }
                ProgressView().tint(Palette.gold)
            }
            .padding(30)
        }
        .transition(.opacity)
    }
}
