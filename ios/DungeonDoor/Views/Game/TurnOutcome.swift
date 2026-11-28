import SwiftUI

/// What the table sees between one turn and the next: first everyone and what they did, while the
/// dice fall; then the result, a row for every hero, each d20 landing in turn with what it was
/// against and whether it came good; then what the turn changed. It stays until the player sends
/// it away, so nobody has to catch it in passing.
///
/// Everything on it comes from the server's `TurnResult`: a die shown here is a die that decided
/// something, and it sits under the hero it was rolled for.
struct TurnOutcomeOverlay: View {
    @Bindable var session: GameSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The latest turn whose result this player has sent away, kept per game on this device.
    @Binding var seen: Int
    /// How many d20s have landed so far.
    @State private var landed = 0

    private var state: GameState { session.state }

    /// The turn on the table: the one resolving now, or the one just played and not yet sent away.
    private struct Showing: Equatable {
        let index: Int
        let result: TurnResult?
        /// The scene still resolving, for who did what before the dice are in.
        let scene: GameScene?
        /// The dungeon master's telling, once written. Nil while the next scene is being written.
        let outcome: String?
    }

    private var showing: Showing? {
        if state.status == .resolving, let scene = state.scene {
            return Showing(index: scene.index, result: scene.result, scene: scene, outcome: nil)
        }
        if let last = state.chronicle?.last, last.index > seen, let result = last.result {
            return Showing(index: last.index, result: result, scene: nil, outcome: last.outcome)
        }
        return nil
    }

    var body: some View {
        let showing = showing
        ZStack {
            if let showing {
                Palette.ink.opacity(0.88)
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
                Group {
                    if let result = showing.result {
                        TurnResultCard(result: result, outcome: showing.outcome, players: state.players,
                                       me: session.playerId, landed: landed, revealAll: revealAll) {
                            dismiss(showing.index)
                        }
                    } else if let scene = showing.scene {
                        TableWaitingCard(scene: scene, players: state.players, combat: state.rules?.combat, me: session.playerId)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 18)
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.25), value: showing?.index)
        .animation(.easeInOut(duration: 0.25), value: showing?.result != nil)
        // The dice land one after another. A turn seen again (a second look, a poll) starts over
        // only when it is another turn or its result has just arrived.
        .task(id: Reveal(index: showing?.index, ready: showing?.result != nil)) {
            let total = showing?.result?.rollCount ?? 0
            landed = 0
            guard total > 0 else { return }
            if reduceMotion { landed = total; return }
            for count in 1...total {
                try? await Task.sleep(for: .milliseconds(count == 1 ? 900 : 800))
                guard !Task.isCancelled else { return }
                withAnimation(.spring(duration: 0.35, bounce: 0.35)) { landed = count }
            }
        }
    }

    private struct Reveal: Hashable {
        let index: Int?
        let ready: Bool
    }

    private func revealAll() {
        guard let total = showing?.result?.rollCount, landed < total else { return }
        withAnimation(.easeOut(duration: 0.2)) { landed = total }
    }

    private func dismiss(_ index: Int) {
        Self.remember(turn: index, in: session.code)
        withAnimation(.easeInOut(duration: 0.2)) { seen = max(seen, index) }
    }

    private static func key(_ code: String) -> String { "dd.turnSeen.\(code)" }

    /// The latest turn this device has seen the result of in that game; -1 for none.
    static func seenTurn(in code: String) -> Int {
        UserDefaults.standard.object(forKey: key(code)) as? Int ?? -1
    }

    static func remember(turn index: Int, in code: String) {
        UserDefaults.standard.set(max(index, seenTurn(in: code)), forKey: key(code))
    }

    /// Puts the last turn's result back on the table (the Story page's "How the last turn went").
    static func forget(turn index: Int, in code: String) {
        UserDefaults.standard.set(index - 1, forKey: key(code))
    }
}

// MARK: - While the dice fall

/// Everyone at the table and what each did, before the engine's numbers are in. No dice here: a
/// die means something only once it is known what it was for.
private struct TableWaitingCard: View {
    let scene: GameScene
    let players: [GamePlayer]
    let combat: Combat?
    let me: String

    var body: some View {
        VStack(spacing: 14) {
            TumblingD20(size: 64)
            Text(scene.combat ? "The round plays out…" : "The dice are falling…")
                .font(.display(22, weight: .bold))
                .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(players, id: \.playerId) { player in
                    let entry = PlayTurn.entry(of: player.playerId, in: scene, me: me)
                    let seat = PlayTurn.seat(of: player.playerId, chosen: entry != nil, in: scene, combat: combat, me: me)
                    HStack(alignment: .top, spacing: 10) {
                        PortraitView(url: player.character.portraitURL, size: 36, circular: true, opensViewer: false)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(player.character.name.isEmpty ? "A hero" : player.character.name)
                                .font(.serif(.subheadline, weight: .bold))
                                .foregroundStyle(player.playerId == me ? Palette.gold : Palette.parchment)
                            Text(entry?.detail ?? (seat == .down ? "Down: could not act" : "Did not act"))
                                .font(.serif(.footnote))
                                .foregroundStyle(Palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding(22)
        .frame(maxWidth: 440)
        .background(Palette.ink, in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.gold.opacity(0.5)) }
        .shadow(color: .black.opacity(0.6), radius: 24)
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - The result

private struct TurnResultCard: View {
    let result: TurnResult
    let outcome: String?
    let players: [GamePlayer]
    let me: String
    /// How many d20s have landed.
    let landed: Int
    var revealAll: () -> Void
    var dismiss: () -> Void

    private var allLanded: Bool { landed >= result.rollCount }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    rule
                    ForEach(result.inOrder) { hero in
                        HeroResult(hero: hero, portrait: players.first { $0.playerId == hero.playerId }?.character.portraitURL,
                                   isMe: hero.playerId == me, combat: result.combat,
                                   firstRoll: result.rollsBefore(hero), landed: landed)
                    }
                    if allLanded {
                        changes
                        telling
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 12)
            }
            .scrollBounceBehavior(.basedOnSize)
            Rectangle().fill(Palette.gold.opacity(0.25)).frame(height: 1)
            footer
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
        }
        .frame(maxWidth: 520)
        .background(Palette.ink, in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.gold.opacity(0.5)) }
        .shadow(color: .black.opacity(0.6), radius: 24)
        .contentShape(.rect)
        // A tap anywhere lands the dice still in the air.
        .onTapGesture(perform: revealAll)
        .accessibilityAddTraits(.isModal)
        .animation(.easeOut(duration: 0.25), value: allLanded)
    }

    private var rule: some View {
        Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1)
    }

    /// What the table did: the choice it went with and how that was settled, or that there was none.
    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            SectionLabel(result.headline)
            if let choice = result.choice {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(choice.label)
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(Palette.parchment)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if allLanded, let success = choice.success {
                        VerdictStamp(word: success ? "Succeeded" : "Failed", success: success, large: true)
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                }
                if let rules = choice.rules, !rules.isEmpty {
                    Text(rules)
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.gold.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let line = result.pickLine() {
                Text(line)
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// What the turn did beyond the dice, in the engine's own words.
    @ViewBuilder private var changes: some View {
        let notes = result.otherNotes
        if !notes.isEmpty {
            rule
            if result.combat {
                DiceLog(lines: notes, heroes: result.heroes.map(\.name), title: "The rest of the round")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("What it changed")
                    ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.system(.caption2, weight: .bold))
                                .foregroundStyle(Palette.gold.opacity(0.8))
                                .accessibilityHidden(true)
                            Text(note)
                                .font(.serif(.subheadline))
                                .foregroundStyle(Palette.parchment)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    /// The dungeon master's telling of it, once written.
    @ViewBuilder private var telling: some View {
        if let outcome, !outcome.isEmpty {
            rule
            Text(outcome)
                .font(.proseSmall.italic())
                .foregroundStyle(Palette.parchment.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var footer: some View {
        if outcome != nil {
            Button(allLanded ? "On with the story" : "Show the dice", action: allLanded ? dismiss : revealAll)
                .buttonStyle(.gilded)
        } else {
            HStack(spacing: 10) {
                ProgressView().tint(Palette.gold)
                Text("The dungeon master is writing what happens next…")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

/// One hero on the result: who, what they did, and each of their d20s.
private struct HeroResult: View {
    let hero: TurnHero
    let portrait: URL?
    let isMe: Bool
    let combat: Bool
    /// Where this hero's first die comes among all the dice on the screen.
    let firstRoll: Int
    let landed: Int

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            PortraitView(url: portrait, size: 40, circular: true, opensViewer: false)
                .saturation(hero.deed == .down ? 0 : 1)
                .opacity(hero.deed == .down ? 0.55 : 1)
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(isMe ? "\(hero.name) (you)" : hero.name)
                        .font(.serif(.subheadline, weight: .bold))
                        .foregroundStyle(isMe ? Palette.gold : Palette.parchment)
                    Text(hero.deedLine)
                        .font(.serif(.footnote))
                        .foregroundStyle(hero.deed == .nothing || hero.deed == .down ? Palette.muted : Palette.parchment.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(hero.rolls.enumerated()), id: \.offset) { offset, roll in
                    RollLine(roll: roll, landed: landed > firstRoll + offset)
                }
                if hero.byClock {
                    Label("Their die was left to the clock: half XP this turn", systemImage: "hourglass")
                        .font(.serif(.caption))
                        .foregroundStyle(Palette.ember)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if landed >= firstRoll + hero.rolls.count {
                    ForEach(hero.plainLines, id: \.self) { line in
                        Text(line)
                            .font(.serif(.caption))
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    // What the turn taught them, once their dice have landed: the amount, then every
                    // reason in the dice log's words, with the chance their roll's result had.
                    if let xp = hero.xp {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Image(systemName: xp.surprising ? "sparkles" : "star.fill")
                                .font(.system(.caption2, weight: .bold))
                                .foregroundStyle(Palette.gold)
                                .accessibilityHidden(true)
                            (Text(xp.amount).font(.serif(.caption, weight: .bold)).foregroundStyle(Palette.gold)
                                + Text(xp.why.isEmpty ? "" : " · \(xp.why)").font(.serif(.caption)).foregroundStyle(Palette.parchment.opacity(xp.surprising ? 0.95 : 0.8)))
                                .monospacedDigit()
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(xp.spoken)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One d20: it turns until it lands, then shows its face, the sum against the number to beat, and
/// the verdict as a word and a mark as well as a colour.
private struct RollLine: View {
    let roll: TurnRoll
    let landed: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            ZStack {
                if landed {
                    D20Badge(roll: roll.natural, size: 38)
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                } else {
                    TumblingD20(size: 38)
                }
            }
            .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .fixedSize(horizontal: false, vertical: true)
                if landed {
                    // The sum and the verdict side by side; with larger text, one over the other.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            sum.fixedSize()
                            Spacer(minLength: 0)
                            stamp
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            sum
                            stamp
                        }
                    }
                    .transition(.opacity)
                    ForEach(extras, id: \.self) { extra in
                        Text(extra)
                            .font(.serif(.caption))
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text("Rolling…")
                        .font(.serif(.subheadline).italic())
                        .foregroundStyle(Palette.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(8)
        .background(Palette.surface, in: .rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(roll.purpose == "choice" ? Palette.gold.opacity(0.6) : Palette.gold.opacity(0.14),
                              lineWidth: roll.purpose == "choice" ? 1.2 : 0.75)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(landed ? "\(title). \(roll.spoken)" : "\(title), rolling")
    }

    private var sum: some View {
        Text("\(roll.sum) vs \(roll.target)")
            .font(.serif(.subheadline, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Palette.parchment)
    }

    private var stamp: some View {
        VerdictStamp(word: roll.verdict, success: roll.success)
    }

    /// What the die is for: the party's choice, the hero's own action, or an attack.
    private var title: String {
        switch roll.purpose {
        case "choice": "\(roll.name) · the party's choice"
        case "attack": "Attack · \(roll.name)"
        default: "\(roll.name) · their own action"
        }
    }

    private var extras: [String] {
        var lines: [String] = []
        if let two = roll.twoDice { lines.append(two) }
        if !roll.helpers.isEmpty { lines.append("Helped by \(TurnResult.listed(roll.helpers))") }
        if roll.fresh { lines.append("Rolled for them by the table") }
        if let detail = roll.detail, !detail.isEmpty { lines.append(detail.prefix(1).uppercased() + detail.dropFirst()) }
        return lines
    }
}

/// "Succeeded" with a tick, or "Failed" with a cross.
private struct VerdictStamp: View {
    let word: String
    let success: Bool
    var large = false

    var body: some View {
        let tint = success ? Palette.verdigris : Palette.ember
        HStack(spacing: 4) {
            Image(systemName: success ? "checkmark.circle.fill" : "xmark.circle.fill")
            Text(word)
        }
        .font(.serif(large ? .subheadline : .footnote, weight: .bold))
        .foregroundStyle(tint)
        .padding(.horizontal, large ? 9 : 7)
        .padding(.vertical, large ? 5 : 3)
        .background(tint.opacity(0.16), in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(tint.opacity(0.6), lineWidth: 1) }
        .fixedSize()
    }
}
