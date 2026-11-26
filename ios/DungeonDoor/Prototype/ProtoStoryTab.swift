#if DEBUG
import SwiftUI

/// The narrative pane: the dungeon master's words, the scene painting, what the table offers,
/// a freeform line, and the last dice. The eight common actions are not here; Act lives in the shell.
struct ProtoStoryTab: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator

    @State private var freeform = ""

    private var state: GameState { session.state }
    private var scene: GameScene? { state.scene }
    private var inCombat: Bool { scene?.combat == true }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let party = state.rules?.party, !party.isEmpty {
                    PartyStrip(party: party, players: state.players, me: session.playerId)
                }
                if state.rules?.time != nil || state.rules?.light != nil {
                    TimeAndLight(clock: state.rules?.time, light: state.rules?.light,
                                 mine: state.standing(session.playerId))
                }
                IllustrationView(url: scene?.imageURL, aspect: 16 / 10)
                if let scene {
                    NarratorBar(scene: scene, session: session, narrator: narrator)
                }
                narration
                if inCombat, let combat = state.rules?.combat {
                    initiative(combat)
                }
                if !inCombat, let waiting = state.rules?.dungeon?.waiting {
                    WaitingFoesNotice(waiting: waiting)
                }
                offers
                freeformBox
                if let lines = state.rules?.results, !lines.isEmpty {
                    DiceLog(lines: lines,
                            heroes: state.rules?.party.map(\.name) ?? state.players.map(\.character.name),
                            title: inCombat ? "Round \((state.rules?.combat?.round ?? 1) - 1)" : "How it went")
                }
                Color.clear.frame(height: 28)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .task {
            narrator.offer(model.catalog)
            narrator.arrived(at: scene, in: session)
            if DemoLaunch.screen == .storyOffers || DemoLaunch.screen == .storyCombatOffers {
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo("choices", anchor: .top)
                }
            }
        }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(eyebrow)
            Text(scene?.title ?? state.title ?? "The door")
                .font(.display(26, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var eyebrow: String {
        guard let scene else { return "Between scenes" }
        if scene.isFinale { return "Finale" }
        if scene.combat, let combat = state.rules?.combat {
            let band = combat.band.map { " · a \($0) fight" } ?? ""
            return "Battle · Round \(combat.round)\(band)"
        }
        if let dungeon = state.rules?.dungeon, let here = dungeon.here {
            return "\(dungeon.kind) · \(DungeonNames.label(here))"
        }
        return "Scene \(scene.index + 1)"
    }

    private var narration: some View {
        let text = scene?.narration ?? ""
        let paragraphs = text.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: 17, design: .serif))
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            if let lines = scene?.roleplay, !lines.isEmpty {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text("\(line.characterName): \(line.text)")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.gold)
                }
            }
        }
        .accessibilityLabel("The dungeon master's narration")
    }

    private func initiative(_ combat: Combat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel("Initiative")
                Spacer()
                if let band = combat.band {
                    Text("\(band) fight")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .foregroundStyle(Palette.ember)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                        chip(combatant, place: index + 1)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func chip(_ combatant: Combatant, place: Int) -> some View {
        let out = !combatant.isUp
        let tint = combatant.isFoe ? Palette.ember : Palette.verdigris
        return HStack(spacing: 5) {
            Text("\(place)")
                .font(.system(size: 10, weight: .bold, design: .serif))
                .foregroundStyle(Palette.muted)
            Text(combatant.name)
                .font(.system(size: 12, weight: .semibold, design: .serif))
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .foregroundStyle(out ? Palette.muted : combatant.id == session.playerId ? Palette.gold : Palette.parchment)
            if let position = combatant.position, !out {
                Text(position)
                    .font(.system(size: 10, design: .serif))
                    .foregroundStyle(position == "engaged" ? Palette.parchment.opacity(0.9) : Palette.muted)
            }
            Text(out ? combatant.status.capitalized : combatant.wound ?? "\(combatant.hp)")
                .font(.system(size: 11, design: .serif))
                .monospacedDigit()
                .foregroundStyle(out ? Palette.ember : Palette.muted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Palette.surface, in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(tint.opacity(out ? 0.25 : 0.7), lineWidth: 1) }
    }

    private var offers: some View {
        let choices = scene?.choices ?? []
        return VStack(alignment: .leading, spacing: 8) {
            SectionLabel(inCombat ? "Your action this round" : "The table offers")
            Text(inCombat
                 ? "Pick a blow, a spell, or a third action. You can change it until the round resolves."
                 : "What the party does together, when it is not an action on your sheet.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                let selected = scene?.myVote == choice.id
                Button {
                    Task { await session.vote(choice) }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Text(ChoiceLetter.at(index))
                            .font(.serif(.headline, weight: .bold))
                            .foregroundStyle(selected ? Palette.ink : Palette.gold)
                            .frame(width: 28, height: 28)
                            .background(selected ? Palette.gold : Palette.raised, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(choice.label)
                                .font(.serif(.body, weight: .semibold))
                                .foregroundStyle(Palette.parchment)
                            if !choice.detail.isEmpty {
                                Text(choice.detail)
                                    .font(.serif(.footnote))
                                    .foregroundStyle(Palette.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let rules = choice.rules, !rules.isEmpty {
                                Text(rules)
                                    .font(.serif(.caption, weight: .semibold))
                                    .foregroundStyle(Palette.gold.opacity(0.85))
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .card(highlighted: selected)
                }
                .buttonStyle(.plain)
            }
        }
        .id("choices")
    }

    private var freeformBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("In your own words")
            Text("Say what you do. If it matches something on your sheet, it becomes that action.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            TextField("Say what you do…", text: $freeform, axis: .vertical)
                .font(.prose)
                .lineLimit(2...4)
                .padding(12)
                .card()
        }
    }
}
#endif
