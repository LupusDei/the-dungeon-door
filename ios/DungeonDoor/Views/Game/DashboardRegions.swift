import SwiftUI

// The regions of `PlayDashboard`. Each one is always in the tree, in this file's order on the
// screen: a turn changes what is enabled inside a region, not which regions exist.

/// A titled block that does not collapse when its contents are quiet.
struct DashboardSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title).accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The line a region shows when it has nothing to list. It keeps the region's place.
struct DashboardNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.serif(.subheadline).italic())
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 14)
            .card()
    }
}

// MARK: - Controls

/// A common action: icon over a short name, one of eight that never leave the bar.
struct PlayChip: View {
    let control: PlayControl
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: control.symbol)
                    .font(.system(size: 15, weight: .semibold))
                Text(control.title)
                    .font(.system(size: 11, weight: .semibold, design: .serif))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(selected ? Palette.ink : control.enabled ? Palette.parchment : Palette.muted)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 3)
            .padding(.vertical, 6)
            .background(selected ? Palette.gold : Palette.surface, in: .rect(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Palette.gold.opacity(selected ? 0.95 : control.enabled ? 0.38 : 0.16), lineWidth: 1)
            }
            .opacity(control.enabled || selected ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .disabled(!control.enabled)
        .accessibilityLabel(control.title)
        .accessibilityHint(control.enabled ? control.hint : control.unavailableReason)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A sheet row or a scene offer. `badge` replaces the symbol with a letter (the scene's A, B, C).
struct PlayRow: View {
    let control: PlayControl
    let selected: Bool
    var badge: String?
    var pips: Pips?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10) {
                mark
                VStack(alignment: .leading, spacing: 3) {
                    Text(control.title)
                        .font(.serif(.body, weight: .semibold))
                        .foregroundStyle(control.enabled || selected ? Palette.parchment : Palette.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !control.detail.isEmpty {
                        Text(control.detail)
                            .font(.serif(.footnote))
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let pips { PipsView(pips: pips) }
                }
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Palette.gold)
                        .accessibilityHidden(true)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .card(highlighted: selected)
            .opacity(control.enabled || selected ? 1 : 0.55)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!control.enabled)
        .accessibilityLabel(spoken)
        .accessibilityHint(control.enabled ? control.hint : control.unavailableReason)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var spoken: String {
        [control.title, control.detail].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    @ViewBuilder private var mark: some View {
        if let badge {
            Text(badge)
                .font(.display(15, weight: .bold))
                .foregroundStyle(selected ? Palette.ink : Palette.gold)
                .frame(width: 28, height: 28)
                .background(selected ? Palette.gold : Palette.raised, in: .circle)
        } else {
            Image(systemName: control.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? Palette.ink : Palette.gold)
                .frame(width: 28, height: 28)
                .background(selected ? Palette.gold : Palette.raised, in: .circle)
        }
    }
}

// MARK: - Vitals

/// Hit points, armour, exhaustion, death saves, and the conditions, pinned above the scroll.
struct DashboardVitals: View {
    let name: String
    let calling: String
    let portrait: URL?
    let sheet: CharacterSheet?
    let live: LiveHero?
    let combatant: Combatant?
    let conditions: [PlayControl]
    /// A fight is on, and this hero has no action. The numbers stay; a line says why.
    let showDown: Bool
    var selected: (PlayControl) -> Bool
    var act: (PlayControl) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                PortraitView(url: portrait, size: 36)
                    .saturation(death == .fallen || death == .down || death == .dying ? 0 : 1)
                    .opacity(death == .standing || death == .stable ? 1 : 0.7)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name)
                        .font(.serif(.headline, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if !calling.isEmpty {
                        Text(calling)
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(death == .fallen ? Palette.muted : Palette.gold)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .top, spacing: 6) {
                hitPoints.frame(maxWidth: .infinity)
                armorClass.frame(width: 52)
                exhaustionMark.frame(width: 46)
                deathSaves.frame(width: 78)
            }
            conditionRow
            if showDown { downLine }
        }
    }

    // MARK: Numbers

    private var hp: Int? { live?.standing.hp ?? sheet?.hp }
    private var maxHp: Int? { live?.standing.maxHp ?? sheet?.maxHp }
    private var armor: Int? { live?.standing.armorClass ?? sheet?.armorClass }
    private var exhaustion: Int { live?.standing.exhaustion ?? sheet?.exhaustion ?? 0 }

    private var standing: Bool { death == .standing || death == .stable }

    private var hitPoints: some View {
        let tint = Health.tint(hp: hp ?? 0, maxHp: max(maxHp ?? 1, 1), standing: standing && (hp ?? 0) > 0)
        return VStack(alignment: .leading, spacing: 4) {
            Text("HIT POINTS")
                .font(.serif(.caption2, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(standing ? Palette.muted : Palette.ember)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(hp.map(String.init) ?? "—")
                    .font(.serif(.title3, weight: .bold))
                    .foregroundStyle(standing ? Palette.parchment : Palette.muted)
                Text("/\(maxHp.map(String.init) ?? "—")")
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(Palette.muted)
            }
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            HPBar(hp: standing ? (hp ?? 0) : 0, maxHp: max(maxHp ?? 1, 1), tint: tint, height: 5)
        }
        .padding(8)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(hpLabel)
    }

    private var hpLabel: String {
        guard let hp, let maxHp else { return "Hit points unknown" }
        return standing ? "Hit points, \(hp) of \(maxHp)" : "\(death.caption), \(hp) of \(maxHp) hit points"
    }

    private var armorClass: some View {
        VStack(spacing: 2) {
            ZStack {
                ShieldShape().fill(Palette.raised)
                ShieldShape().stroke(Palette.gold, style: StrokeStyle(lineWidth: 1.25, lineJoin: .round))
                Text(armor.map(String.init) ?? "—")
                    .font(.serif(.headline, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .offset(y: -1)
            }
            .frame(width: 30, height: 34)
            Text("AC")
                .font(.serif(.caption2, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(armor.map { "Armor class \($0)" } ?? "Armor class unknown")
    }

    private var exhaustionMark: some View {
        VStack(spacing: 2) {
            Text("\(exhaustion)")
                .font(.serif(.title3, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(exhaustion > 0 ? Palette.ember : Palette.parchment)
            Text("EXH")
                .font(.serif(.caption2, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(exhaustion > 0 ? Palette.ember : Palette.muted)
            Text("of 6")
                .font(.system(size: 9, design: .serif))
                .foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Exhaustion \(exhaustion) of 6")
    }

    /// The track is always six marks. The client is not sent how many saves have landed, so they
    /// stay open and the caption says whether the hero is standing, down, dying, stable or fallen.
    private var deathSaves: some View {
        VStack(spacing: 3) {
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { _ in
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 9))
                        .foregroundStyle(Palette.verdigris.opacity(0.55))
                }
            }
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { _ in
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 9))
                        .foregroundStyle(Palette.ember.opacity(0.55))
                }
            }
            Text(death.caption.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .serif))
                .tracking(0.4)
                .foregroundStyle(death.tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Death saves, \(death.caption). The save count is not on the sheet yet.")
    }

    private var death: DeathMark {
        if let combatant {
            switch combatant.status {
            case "dying": return .dying
            case "stable": return .stable
            case "dead": return .fallen
            default: return combatant.isUp ? .standing : .down
            }
        }
        if live?.standing.dead == true || sheet?.dead == true { return .fallen }
        if live?.standing.down == true { return .down }
        if let hp, hp <= 0 { return .down }
        return .standing
    }

    private var conditionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if conditions.isEmpty {
                    TagLabel("None", tint: Palette.muted)
                        .accessibilityLabel("No conditions")
                } else {
                    ForEach(conditions) { control in
                        if control.choice != nil {
                            conditionButton(control)
                        } else {
                            TagLabel(control.title, tint: conditionTint(control))
                                .accessibilityHint(control.detail)
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
        .fixedSize(horizontal: false, vertical: true)
        .frame(minHeight: 28)
    }

    private func conditionTint(_ control: PlayControl) -> Color {
        if control.id == "condition/concentration" || control.id == "condition/revival" { return Palette.gold }
        if control.id == "condition/sight" { return Palette.muted }
        return Palette.ember
    }

    private func conditionButton(_ control: PlayControl) -> some View {
        let on = selected(control)
        return Button { act(control) } label: {
            Text(control.title.uppercased())
                .font(.system(.caption2, design: .serif, weight: .semibold))
                .tracking(1.1)
                .lineLimit(1)
                .foregroundStyle(on ? Palette.ink : Palette.gold)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(on ? Palette.gold : Palette.gold.opacity(0.16), in: Capsule(style: .circular))
                .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(on ? 0.95 : 0.5), lineWidth: 0.75) }
                .opacity(control.enabled || on ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .disabled(!control.enabled)
        .accessibilityLabel(control.title)
        .accessibilityHint(control.enabled ? control.hint : control.unavailableReason)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var downLine: some View {
        let fallen = death == .fallen
        return Text(fallen
                    ? "\(name) has fallen. The dead take no action."
                    : "\(name) is down. At 0 hit points there is no action to take.")
            .font(.serif(.footnote))
            .foregroundStyle(Palette.parchment.opacity(0.9))
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.ember.opacity(0.14), in: .rect(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.ember.opacity(0.5), lineWidth: 1) }
    }
}

/// Where the death-save track sits. The marks themselves wait on a count the server does not send.
private enum DeathMark {
    case standing, down, dying, stable, fallen

    var caption: String {
        switch self {
        case .standing: "Standing"
        case .down: "Down"
        case .dying: "Dying"
        case .stable: "Stable"
        case .fallen: "Fallen"
        }
    }

    var tint: Color {
        switch self {
        case .standing: Palette.muted
        case .down, .dying, .fallen: Palette.ember
        case .stable: Palette.gold
        }
    }
}

// MARK: - Common actions

/// Attack, Dash, Disengage, Dodge, Help, Hide, Ready, Use an Object. Pinned under the thumb.
struct DashboardActionBar: View {
    let controls: [PlayControl]
    let status: String
    var selected: (PlayControl) -> Bool
    var act: (PlayControl) -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text(status)
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 18, alignment: .leading)
            VStack(spacing: 6) {
                HStack(spacing: 6) { chips(Array(controls.prefix(4))) }
                HStack(spacing: 6) { chips(Array(controls.suffix(from: min(4, controls.count)))) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(Palette.ink)
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.22)).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Common actions")
    }

    private func chips(_ controls: [PlayControl]) -> some View {
        ForEach(controls) { control in
            PlayChip(control: control, selected: selected(control)) { act(control) }
        }
    }
}

// MARK: - Map and freeform

/// The battle map's place. A later task fills it; a dungeon still opens the map the app already has.
struct DashboardMapPlaceholder: View {
    var hasDungeon: Bool
    var openMap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Map")
            grid.accessibilityHidden(true)
            Text("Battle map")
                .font(.serif(.subheadline, weight: .semibold))
            Text("An interactive map comes later. Miniatures will move by a tap.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if hasDungeon {
                Button("Dungeon map", action: openMap)
                    .buttonStyle(.plain)
                    .font(.serif(.caption, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .frame(minHeight: 32, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
        .card()
        .accessibilityElement(children: .combine)
        .accessibilityHint(hasDungeon ? "Opens the dungeon map" : "A battle map comes later")
    }

    private var grid: some View {
        VStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: 3) {
                    ForEach(0..<3, id: \.self) { column in
                        RoundedRectangle(cornerRadius: 2)
                            .strokeBorder(Palette.gold.opacity(row == 1 && column == 1 ? 0.85 : 0.28), lineWidth: 1)
                            .background(row == 1 && column == 1 ? Palette.gold.opacity(0.18) : Color.clear)
                            .frame(width: 14, height: 14)
                    }
                }
            }
        }
    }
}

/// Where a player will type an action in their own words. It does not send anything yet.
struct DashboardFreeform: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("In your own words")
            Text("Say what you do…")
                .font(.serif(.subheadline))
                .foregroundStyle(Palette.muted.opacity(0.85))
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                .padding(10)
                .background(Palette.ink.opacity(0.55), in: .rect(cornerRadius: 10))
                .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.gold.opacity(0.22), lineWidth: 1) }
            Text("The dungeon master isn't taking freeform turns yet.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
        .card()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Freeform action")
        .accessibilityHint("Unavailable. The dungeon master isn't taking freeform turns yet.")
    }
}

// MARK: - Sheet

/// Attacks, spells and slots, items, features and resources. Always these four, in this order.
struct DashboardSheet: View {
    let board: PlayBoard
    let casting: Spellcasting?
    /// Slots left per spell level, from the game when there is one.
    var slotsLeft: [Int]?
    /// Gold pieces on the hero right now. Always shown, so the line does not come and go.
    var gold: Double
    let resources: [ResourceUse]
    var selected: (PlayControl) -> Bool
    var act: (PlayControl) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            DashboardSection(title: "Attacks") {
                rows(board.weapons, empty: "No weapons listed.")
            }
            DashboardSection(title: "Spells") {
                if let casting = casting {
                    SlotStrip(casting: casting, slotsLeft: slotsLeft)
                }
                if board.spells.isEmpty {
                    DashboardNote(casting == nil ? "No spells." : "No spells prepared.")
                } else {
                    rows(board.spells, empty: "No spells.")
                }
            }
            DashboardSection(title: "Items") {
                HStack {
                    Text("Gold pieces")
                        .font(.serif(.body))
                    Spacer(minLength: 8)
                    Text("\(SRD.coins(gold)) gp")
                        .font(.serif(.body, weight: .semibold))
                        .monospacedDigit()
                }
                .padding(12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .card()
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(SRD.coins(gold)) gold pieces")
                rows(board.items, empty: "Nothing but the clothes on their back.")
            }
            DashboardSection(title: "Features") {
                rows(board.features, empty: "No features listed.", pips: { pips(for: $0) })
            }
        }
    }

    private func rows(_ controls: [PlayControl], empty: String, pips: ((PlayControl) -> Pips?)? = nil) -> some View {
        Group {
            if controls.isEmpty {
                DashboardNote(empty)
            } else {
                VStack(spacing: 8) {
                    ForEach(controls) { control in
                        PlayRow(control: control, selected: selected(control), pips: pips?(control)) { act(control) }
                    }
                }
            }
        }
    }

    private func pips(for control: PlayControl) -> Pips? {
        guard let resource = resources.first(where: { "resource/\($0.id)" == control.id }), resource.max > 0 else { return nil }
        return Pips(left: resource.left, max: resource.max)
    }
}

/// Spell save DC, spell attack, and one pip row per spell level the caster has slots for.
struct SlotStrip: View {
    let casting: Spellcasting
    var slotsLeft: [Int]?

    private var levels: [(index: Int, most: Int)] {
        casting.slots.enumerated().compactMap { index, most in most > 0 ? (index: index, most: most) : nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 14) {
                Text("DC \(casting.saveDc)")
                Text("Attack \(SRD.signed(casting.attackBonus))")
                if !casting.ability.isEmpty {
                    Text(SRD.ability(casting.ability))
                }
            }
            .font(.serif(.footnote, weight: .semibold))
            .foregroundStyle(Palette.gold)
            .accessibilityElement(children: .combine)
            ForEach(levels, id: \.index) { level in
                let left = slotsLeft ?? casting.slotsLeft
                let remaining = min(level.most, max(0, left.indices.contains(level.index) ? left[level.index] : level.most))
                HStack(spacing: 8) {
                    Text(SRD.ordinal(level.index + 1))
                        .font(.serif(.caption, weight: .semibold))
                        .frame(width: 36, alignment: .leading)
                    PipsView(pips: Pips(left: remaining, max: level.most))
                    Spacer(minLength: 4)
                    Text("\(remaining)/\(level.most)")
                        .font(.serif(.caption))
                        .foregroundStyle(Palette.muted)
                        .monospacedDigit()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(SRD.ordinal(level.index + 1)) level slots, \(remaining) of \(level.most) left")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
