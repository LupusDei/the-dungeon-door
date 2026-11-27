import SwiftUI

/// The fight at a glance, pinned under the act bar on every tab while a fight is on: a lane of the
/// party with their hit points, and a lane of the foes with how hurt each looks (the server never
/// sends a foe's hit points, only its tier), each with what holds them. So the table can choose whom
/// to hit, who needs healing, and who is asleep without leaving the tab they are on. The sheets are a
/// tab away; the cells are not buttons.
///
/// Colour is never the only signal: a foe's tier is a word and a row of pips, and each condition is
/// a word with its icon.
struct CombatHUD: View {
    let hud: CombatHud
    /// The caller's player id: their own hero is outlined in gold.
    let me: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if !hud.party.isEmpty {
                lane("Party", tint: Palette.verdigris) {
                    ForEach(hud.party) { hero in heroChip(hero) }
                }
            }
            if !hud.foes.isEmpty {
                lane("Foes", tint: Palette.ember) {
                    ForEach(hud.foes) { foe in foeChip(foe) }
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ink)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("The fight at a glance")
    }

    private func lane<Content: View>(_ title: String, tint: Color, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(title.uppercased())
                .font(.system(size: 8.5, weight: .bold, design: .serif))
                .tracking(0.8)
                .foregroundStyle(tint)
                .frame(width: 34, alignment: .leading)
                .padding(.top, 6)
                .accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 6) { content() }
                    .padding(.trailing, 14)
            }
        }
        .padding(.leading, 14)
    }

    // MARK: Heroes

    private func heroChip(_ hero: HudHero) -> some View {
        let mine = hero.id == me
        let standing = hero.isUp
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(shortName(hero.name))
                    .font(.system(size: 12, weight: .semibold, design: .serif))
                    .foregroundStyle(standing ? (mine ? Palette.gold : Palette.parchment) : Palette.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(standing ? "\(hero.hp)/\(hero.maxHp)" : statusWord(hero.status))
                    .font(.system(size: 10.5, weight: .semibold, design: .serif))
                    .monospacedDigit()
                    .foregroundStyle(standing ? Palette.muted : Palette.ember)
                    .lineLimit(1)
                    .fixedSize()
            }
            HPBar(hp: hero.hp, maxHp: max(hero.maxHp, 1),
                  tint: Health.tint(hp: hero.hp, maxHp: max(hero.maxHp, 1), standing: standing), height: 4)
            conditionRow(hero.conditions)
        }
        .hudCell(highlighted: mine, faded: hero.status == "dead")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(hero))
    }

    // MARK: Foes

    private func foeChip(_ foe: HudFoe) -> some View {
        let tint = tierTint(foe)
        return VStack(alignment: .leading, spacing: 3) {
            Text(foe.name)
                .font(.system(size: 12, weight: .semibold, design: .serif))
                .strikethrough(foe.isDead, color: Palette.muted)
                .foregroundStyle(foe.isDead ? Palette.muted : Palette.parchment)
                .lineLimit(1)
            HStack(spacing: 5) {
                TierPips(lit: foe.pipsLit, tint: tint)
                Text(foe.label)
                    .font(.system(size: 10.5, weight: .semibold, design: .serif))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .fixedSize()
            }
            conditionRow(foe.conditions)
        }
        .hudCell(highlighted: false, faded: foe.isDead)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(foe))
    }

    private func tierTint(_ foe: HudFoe) -> Color {
        if foe.isDead { return Health.fallen }
        switch foe.tier {
        case "unhurt": return Palette.verdigris
        case "hurt": return Palette.gold
        case "down": return Health.fallen
        default: return Palette.ember
        }
    }

    // MARK: Conditions

    @ViewBuilder private func conditionRow(_ conditions: [HudCondition]) -> some View {
        if !conditions.isEmpty {
            HStack(spacing: 3) {
                ForEach(conditions) { condition in ConditionBadge(condition: condition) }
            }
        }
    }

    // MARK: Words

    /// "Bryn" from "Bryn Stonehand": the lane is narrow, and the sheet has the rest.
    private func shortName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    private func statusWord(_ status: String) -> String {
        switch status {
        case "dead": "Dead"
        case "dying": "Dying"
        case "stable": "Down"
        default: SRD.name(status)
        }
    }

    private func spoken(_ hero: HudHero) -> String {
        var parts = [hero.name, hero.id == me ? "you" : "hero"]
        parts.append(hero.isUp ? "\(hero.hp) of \(hero.maxHp) hit points" : statusWord(hero.status))
        parts += hero.conditions.map(\.spoken)
        return parts.joined(separator: ", ")
    }

    private func spoken(_ foe: HudFoe) -> String {
        ([foe.name, "foe", foe.label] + foe.conditions.map(\.spoken)).joined(separator: ", ")
    }
}

private extension View {
    /// A HUD cell: the surface card, outlined in gold for the caller's own hero.
    func hudCell(highlighted: Bool, faded: Bool) -> some View {
        self
            .padding(.horizontal, 7)
            .padding(.vertical, 5)
            .frame(minWidth: 96, alignment: .leading)
            .background(Palette.surface, in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(highlighted ? Palette.gold.opacity(0.6) : Palette.gold.opacity(0.16), lineWidth: 1)
            }
            .opacity(faded ? 0.5 : 1)
            .fixedSize(horizontal: true, vertical: false)
    }
}

/// A foe's tier as pips: four for unhurt, none once down. Read with the word beside it.
struct TierPips: View {
    let lit: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<HudFoe.pips, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(index < lit ? tint : Color.black.opacity(0.45))
                    .overlay {
                        RoundedRectangle(cornerRadius: 1).strokeBorder(tint.opacity(0.35), lineWidth: 0.5)
                    }
                    .frame(width: 6, height: 7)
            }
        }
        .accessibilityHidden(true)
    }
}

/// One condition: its icon and its word.
struct ConditionBadge: View {
    let condition: HudCondition

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: condition.symbol)
                .font(.system(size: 8.5, weight: .semibold))
            Text(condition.label)
                .font(.system(size: 9.5, weight: .semibold, design: .serif))
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(condition.tint)
        .padding(.horizontal, 4)
        .padding(.vertical, 1.5)
        .background(condition.tint.opacity(0.14), in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(condition.tint.opacity(0.45), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }
}

extension HudCondition {
    /// An SF Symbol for the condition; one the app doesn't know is a dot.
    var symbol: String {
        switch id {
        case "asleep": "zzz"
        case "unconscious": "moon.fill"
        case "incapacitated": "pause.circle.fill"
        case "paralyzed": "lock.fill"
        case "stunned": "sparkles"
        case "petrified": "mountain.2.fill"
        case "prone": "arrow.down.to.line"
        case "restrained", "grappled": "link"
        case "blinded": "eye.slash.fill"
        case "deafened": "speaker.slash.fill"
        case "charmed": "heart.fill"
        case "frightened": "exclamationmark.triangle.fill"
        case "poisoned": "drop.fill"
        case "invisible": "circle.dashed"
        case "exhaustion": "battery.25"
        case "concentrating": "brain.head.profile"
        case "dodging": "shield.lefthalf.filled"
        default: "circle.fill"
        }
    }

    /// Calm for what the hero does (concentrating, dodging); gold for what holds them.
    var tint: Color {
        switch id {
        case "concentrating", "dodging": Palette.verdigris
        default: Palette.gold
        }
    }

    /// "Asleep, from Sleep", "Concentrating on Sleep", "Poisoned, 10 minutes".
    var spoken: String {
        var text = label
        if let source {
            text += id == "concentrating" ? " on \(source)" : ", from \(source)"
        }
        if let ends { text += ", \(ends)" }
        return text
    }
}
