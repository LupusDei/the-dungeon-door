import SwiftUI

/// What happened last turn, in a few lines, at the head of a streamlined game's Story page
/// (docs/app-tabs.md, "A streamlined game"): the choice the party went with and whether it came
/// good, each d20 with its verdict, what the turn changed, and the dungeon master's one sentence.
/// The full result, every die at its own size, is a tap away.
struct TurnBrief: View {
    /// The turn's result. Nil for a turn from before results: the sentence alone is shown.
    let turn: TurnResult?
    /// The dungeon master's sentence of what happened.
    let outcome: String
    /// The caller's own hero, to mark their line.
    var me: String? = nil
    /// Puts the whole result card back on the table.
    var showAll: () -> Void = {}

    /// The changes shown before "and N more"; the rest are on the full result.
    static let mostChanges = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel("What happened")
                Spacer(minLength: 8)
                if turn != nil {
                    Button(action: showAll) {
                        Label("Every roll", systemImage: "dice")
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(Palette.gold)
                            .padding(.vertical, 4)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Show every roll of the last turn")
                }
            }
            if let turn { told(turn) }
            if !outcome.isEmpty {
                Text(outcome)
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.parchment.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Palette.surface, in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.gold.opacity(0.25)) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("what-happened")
    }

    @ViewBuilder private func told(_ turn: TurnResult) -> some View {
        // The choice, and whether its check or save came good.
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                title(turn)
                Spacer(minLength: 0)
                verdict(turn)
            }
            VStack(alignment: .leading, spacing: 4) {
                title(turn)
                verdict(turn)
            }
        }
        if turn.heroes.count > 1, let picked = turn.pickLine() {
            Text(picked)
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(turn.briefLines) { line in row(line, mine: mine(line, in: turn)) }
        let changes = turn.briefChanges
        ForEach(Array(changes.prefix(Self.mostChanges).enumerated()), id: \.offset) { _, change in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(.caption2, weight: .bold))
                    .foregroundStyle(Palette.gold.opacity(0.8))
                    .frame(width: 14)
                    .accessibilityHidden(true)
                Text(change)
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.parchment)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        if changes.count > Self.mostChanges {
            Button(action: showAll) {
                Text("and \(changes.count - Self.mostChanges) more")
                    .font(.serif(.caption, weight: .semibold))
                    .foregroundStyle(Palette.gold)
            }
            .buttonStyle(.plain)
        }
    }

    private func title(_ turn: TurnResult) -> some View {
        Text(turn.briefTitle)
            .font(.serif(.headline, weight: .bold))
            .foregroundStyle(Palette.parchment)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func verdict(_ turn: TurnResult) -> some View {
        if let word = turn.verdict, let success = turn.choice?.success {
            stamp(word, success: success)
        }
    }

    private func mine(_ line: TurnBriefLine, in turn: TurnResult) -> Bool {
        guard let me else { return false }
        return turn.heroes.first { $0.playerId == me }?.name == line.hero
    }

    /// A hero's line: how it came out, who, and what was rolled against what. The mark leads, so a
    /// column of them reads at a glance; the words wrap as one sentence at any text size.
    private func row(_ line: TurnBriefLine, mine: Bool) -> some View {
        let tint = line.success.map { $0 ? Palette.verdigris : Palette.ember }
        let verdict = line.verdict.map { Text("  \($0)").font(.serif(.footnote, weight: .bold)).foregroundStyle(tint ?? Palette.parchment) } ?? Text("")
        let words = Text(line.hero).font(.serif(.footnote, weight: .bold)).foregroundStyle(mine ? Palette.gold : Palette.parchment)
            + Text("  \(Self.unbroken(line.text))").font(.serif(.footnote)).foregroundStyle(Palette.parchment)
            + verdict
            + Text(line.detail.map { ". \($0)" } ?? "").font(.serif(.footnote)).foregroundStyle(Palette.muted)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: line.success.map { $0 ? "checkmark.circle.fill" : "xmark.circle.fill" } ?? "circle.fill")
                .font(.system(.caption2, weight: .bold))
                .imageScale(line.success == nil ? .small : .medium)
                .foregroundStyle(tint ?? Palette.gold.opacity(0.5))
                .frame(width: 14)
                .accessibilityHidden(true)
            words
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.spoken)
    }

    /// "DC 10" and "AC 15" stay on one line: a target split from its number reads as two things.
    private static func unbroken(_ text: String) -> String {
        text.replacingOccurrences(of: " vs DC ", with: " vs DC\u{00A0}").replacingOccurrences(of: " vs AC ", with: " vs AC\u{00A0}")
    }

    private func stamp(_ word: String, success: Bool) -> some View {
        let tint = success ? Palette.verdigris : Palette.ember
        return HStack(spacing: 3) {
            Image(systemName: success ? "checkmark.circle.fill" : "xmark.circle.fill")
            Text(word)
        }
        .font(.serif(.caption, weight: .bold))
        .foregroundStyle(tint)
        .fixedSize()
    }
}
