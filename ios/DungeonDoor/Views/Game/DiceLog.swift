import SwiftUI

/// The rules engine's own account of the last scene: every roll, hit, save and reward, one line
/// each, exactly as the server wrote them (`rules.results`). The app only decides how each line
/// looks: a hero's hit is gold, a blow that lands on a hero is ember, a miss is quiet.
struct DiceLog: View {
    let lines: [String]
    /// The party's names, to tell a hero's line from a foe's.
    let heroes: [String]
    var title = "The dice"
    /// More lines than this are folded: the last ones stay (how it ended, what was won), and the
    /// earlier ones wait behind a button.
    var fold = 8

    @State private var expanded = false

    var body: some View {
        if !lines.isEmpty {
            let folded = !expanded && lines.count > fold + 1
            let shown = folded ? Array(lines.suffix(fold)) : lines
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "dice.fill").font(.system(size: 11)).foregroundStyle(Palette.gold)
                    SectionLabel(title)
                }
                if folded {
                    Button {
                        withAnimation(.snappy) { expanded = true }
                    } label: {
                        Label("Show the \(lines.count - shown.count) rolls before these", systemImage: "chevron.up")
                            .font(.serif(.footnote, weight: .semibold))
                            .foregroundStyle(Palette.gold)
                            .frame(minHeight: 30)
                    }
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, line in
                        DiceLine(text: line, style: DiceLineStyle(line: line, heroes: heroes))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .card()
        }
    }
}

/// How one of the engine's lines is drawn. Read from the words the server uses; a line the app
/// doesn't recognise is drawn plainly, never dropped.
struct DiceLineStyle: Equatable {
    enum Tone { case good, bad, plain, quiet, headline }

    var tone: Tone
    var symbol: String

    init(line: String, heroes: [String]) {
        let text = line.lowercased()
        // Who the line is about: a hero when it opens with one of the party's names (the opportunity
        // attacks of fleeing foes' pursuers carry a prefix).
        let subject = line.hasPrefix("Opportunity Attack: ") ? String(line.dropFirst("Opportunity Attack: ".count)) : line
        let byHero = heroes.contains { !$0.isEmpty && subject.hasPrefix($0) }

        func has(_ words: String...) -> Bool { words.contains { text.contains($0) } }

        let good: Tone = byHero ? .good : .bad
        let pick: (Tone, String)
        if has("reaches level") {
            pick = (.headline, "star.fill")
        } else if text.hasPrefix("victory") || has("surrender", "break and flee", "the foes flee") {
            pick = (.headline, "flag.fill")
        } else if text.hasPrefix("morale") {
            pick = (.plain, "flag")
        } else if has(" rest:", " rests.", "hit die", "hit dice") {
            pick = (.good, "moon.zzz.fill")
        } else if text.hasPrefix("treasure") || (has(" buys ", " takes ") && !has("damage")) {
            pick = (.good, "bag.fill")
        } else if has(" attacks ") {
            if has("critical hit") {
                pick = (good, "sparkles")
            } else if has("hit for") {
                pick = (good, "burst.fill")
            } else {
                pick = (.quiet, "wind")
            }
        } else if has(" casts ") {
            pick = (has("damage") ? good : .quiet, "wand.and.stars")
        } else if has(" dodges") {
            pick = (.quiet, "shield.lefthalf.filled")
        } else if has("death save") {
            pick = (has("(success", "back up", ": stable") ? .plain : .bad, "heart.slash")
        } else if has("cannot act") {
            pick = (.quiet, "hourglass")
        } else if has(" dies", " is dead", "is dying", "is down and fails") {
            pick = (.bad, "heart.slash")
        } else if has(" falls.") {
            pick = byHero ? (.bad, "heart.slash") : (.good, "xmark.circle")
        } else if has("is stable", "back on their feet", "wakes with", "regains", "hp back") {
            pick = (.good, "heart.fill")
        } else if has(" uses ") && has(" save):") {
            // A monster's power (a breath, a web, a gaze): everyone caught saves.
            pick = (has(" fails") ? .bad : .quiet, "tornado")
        } else if has("is ready again") {
            pick = (.quiet, "arrow.clockwise")
        } else if has("cannot break free", " is still ", "tries to stabilize", "loses concentration", "can no longer concentrate") {
            pick = (.bad, "xmark.circle.fill")
        } else if has("stabilizes ", "breaks free", "shakes off", "is no longer ") {
            pick = (.good, "checkmark.circle.fill")
        } else if has("eats a day") {
            pick = (.quiet, "fork.knife")
        } else if has("vs dc", "(passive") {
            pick = has(", failure") ? (.bad, "xmark.circle.fill") : (.good, "checkmark.circle.fill")
        } else if text.hasPrefix("damage") || has("goes off", "nobody notices", "the party meets") {
            pick = (.bad, "exclamationmark.triangle.fill")
        } else if has("a fight begins") {
            pick = (.plain, "flame.fill")
        } else if has("the party enters") {
            pick = (.plain, "door.left.hand.open")
        } else {
            pick = (.plain, "circle.fill")
        }
        tone = pick.0
        symbol = pick.1
    }

    var tint: Color {
        switch tone {
        case .good, .headline: Palette.gold
        case .bad: Palette.ember
        case .plain: Palette.parchment.opacity(0.9)
        case .quiet: Palette.muted
        }
    }
}

private struct DiceLine: View {
    let text: String
    let style: DiceLineStyle

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: style.symbol)
                .font(.system(size: style.symbol == "circle.fill" ? 5 : 11))
                .foregroundStyle(style.tint)
                .frame(width: 16)
            Text(text)
                .font(style.tone == .headline ? .proseSmall.weight(.bold) : .proseSmall)
                .foregroundStyle(style.tint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
