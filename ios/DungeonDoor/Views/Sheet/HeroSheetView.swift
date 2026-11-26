import SwiftUI

/// The tabs of a hero sheet, in the order they are shown.
enum HeroSheetTab: String, CaseIterable, Identifiable {
    case abilities, combat, spells, gear, story

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    /// Where a sheet opens: Abilities, unless a `-sheetTab` launch argument says otherwise.
    static var launchDefault: HeroSheetTab {
        AppConfig.sheetTabArgument.flatMap(HeroSheetTab.init(rawValue:)) ?? .abilities
    }
}

/// How a hero stands right now, in a game: the rules engine's numbers for them, and what the
/// fight in progress has done to them. These replace the sheet's own hit points and add what only
/// a game knows (resources left, the load carried).
struct LiveHero: Equatable {
    var standing: HeroStanding
    /// Condition ids from the fight in progress, when there is one.
    var conditions: [String] = []
}

extension GameState {
    /// A hero's numbers from the party, with conditions from the fight if there is one.
    func live(of playerId: String) -> LiveHero? {
        guard let standing = standing(playerId) else { return nil }
        return LiveHero(standing: standing, conditions: rules?.combat?.combatant(playerId)?.conditions ?? [])
    }
}

/// A hero's character sheet (SRD 5.2): the vitals, always in view, over five tabs.
///
/// The body is a `Section`, so the host decides how it scrolls. In a
/// `LazyVStack(pinnedViews: [.sectionHeaders])` the vitals and the tabs stay pinned while a tab's
/// content scrolls under them (the hero page, the sheet in a game); in a plain stack they simply
/// come first (the forge's preview). It draws its own side margins (`inset`), so the pinned bar
/// can run edge to edge.
struct HeroSheetView: View {
    @Environment(AppModel.self) private var model
    let character: Character
    /// The hero's standing in a game in progress. Nil shows the sheet's own numbers.
    var live: LiveHero?
    @Binding var tab: HeroSheetTab
    var inset: CGFloat = 20

    @State private var detail: RuleDetail?
    @State private var refreshing = false

    var body: some View {
        if let sheet = character.sheet {
            let tabs = HeroSheetTab.allCases.filter { $0 != .spells || sheet.spellcasting != nil }
            let shown = tabs.contains(tab) ? tab : .abilities
            Section {
                content(shown, sheet)
                    .padding(.horizontal, inset)
                    .padding(.top, 16)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .sheet(item: $detail) { RuleDetailView(detail: $0, attribution: model.reference?.attribution) }
                    .task {
                        // `-sheetRule <name>`: open that rule's text by itself (screenshot checks).
                        guard let wanted = AppConfig.sheetRuleArgument else { return }
                        try? await Task.sleep(for: .seconds(1.2))
                        detail = RuleBook(reference: model.reference).rule(named: wanted, on: sheet, species: character.race)
                    }
            } header: {
                VStack(spacing: 10) {
                    VitalsBar(sheet: sheet, live: live)
                    SheetTabBar(tabs: tabs, selection: Binding(get: { shown }, set: { tab = $0 }))
                }
                .padding(.horizontal, inset)
                .padding(.vertical, 10)
                .background(Palette.ink)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1)
                }
            }
        } else if !(model.catalog?.backgrounds.isEmpty ?? true) {
            // A rules server gives every hero a sheet, so one is on its way. A server from before
            // the rules engine never will: there the page is the hero's story alone.
            pending
                .padding(.horizontal, inset)
                .padding(.vertical, 16)
        }
    }

    @ViewBuilder private func content(_ tab: HeroSheetTab, _ sheet: CharacterSheet) -> some View {
        let rules = RuleBook(reference: model.reference)
        let open: (RuleDetail) -> Void = { detail = $0 }
        switch tab {
        case .abilities:
            AbilitiesTab(sheet: sheet, live: live, rules: rules, open: open)
        case .combat:
            CombatTab(sheet: sheet, attacks: character.attacks ?? [], live: live, rules: rules, open: open)
        case .spells:
            if let casting = sheet.spellcasting {
                SpellsTab(casting: casting, slotsLeft: live?.standing.slotsLeft, rules: rules, open: open)
            }
        case .gear:
            GearTab(sheet: sheet, attacks: character.attacks ?? [], live: live)
        case .story:
            StoryTab(character: character, sheet: sheet, catalog: model.catalog, rules: rules, open: open)
        }
    }

    /// A hero from before sheets existed (or from an old cache): one card, never a blank tab.
    private var pending: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "scroll").font(.title3).foregroundStyle(Palette.gold)
                Text("This hero's sheet is being drawn up")
                    .font(.serif(.headline))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("The dungeon master works out the numbers from their species, class and background. It only takes a moment.")
                .font(.serif(.subheadline))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task {
                    refreshing = true
                    await model.refresh()
                    refreshing = false
                }
            } label: {
                if refreshing { ProgressView().tint(Palette.gold) } else { Text("Look again") }
            }
            .buttonStyle(.gildedOutline)
            .disabled(refreshing)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .card()
    }
}

// MARK: - Vitals

/// The six numbers a player looks for first. Three to a row on a phone, all six in one where
/// there's room.
struct VitalsBar: View {
    let sheet: CharacterSheet
    var live: LiveHero?

    /// Six of these and their gaps must fit for the one-row layout to be chosen.
    private static let cellWidth: CGFloat = 86
    @ScaledMetric(relativeTo: .title3) private var shieldWidth: CGFloat = 36
    @ScaledMetric(relativeTo: .title3) private var shieldHeight: CGFloat = 40

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                hitPoints; armorClass; initiative; speed; proficiency; perception
            }
            VStack(spacing: 8) {
                HStack(spacing: 8) { hitPoints; armorClass; initiative }
                HStack(spacing: 8) { speed; proficiency; perception }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var hitPoints: some View {
        let hp = live?.standing.hp ?? sheet.hp
        let most = live?.standing.maxHp ?? sheet.maxHp
        let dead = live?.standing.dead ?? sheet.dead
        let standing = !dead && hp > 0
        let tint = Health.tint(hp: hp, maxHp: most, standing: standing)
        let label = standing ? "Hit Points" : dead ? "Fallen" : "Down"
        return StatCell(label: label,
                        spoken: standing ? "Hit points, \(hp) of \(most)" : "\(label), \(hp) of \(most) hit points",
                        minWidth: Self.cellWidth, labelTint: standing ? Palette.muted : Palette.ember) {
            VStack(spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(hp)")
                        .font(.serif(.title3, weight: .bold))
                        .foregroundStyle(standing ? Palette.parchment : Palette.muted)
                    Text("/\(most)")
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                }
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                HPBar(hp: standing ? hp : 0, maxHp: most, tint: tint, height: 5)
                    .padding(.horizontal, 10)
            }
        }
    }

    private var armorClass: some View {
        let ac = live?.standing.armorClass ?? sheet.armorClass
        return StatCell(label: "Armor Class", spoken: "Armor class, \(ac)", minWidth: Self.cellWidth) {
            ZStack {
                ShieldShape().fill(Palette.raised)
                ShieldShape().stroke(Palette.gold, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                Text("\(ac)")
                    .font(.serif(.title3, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 4)
                    .offset(y: -2)
            }
            .frame(width: shieldWidth, height: shieldHeight)
        }
    }

    private var initiative: some View {
        let bonus = SRD.modifier(sheet.abilityScores.dex)
        return StatCell(label: "Initiative", spoken: "Initiative, \(SRD.spoken(bonus))", minWidth: Self.cellWidth) {
            number(SRD.signed(bonus))
        }
    }

    private var speed: some View {
        // The sheet's speed is the hero's own. Each level of exhaustion takes 5 feet off it, and
        // over their carrying capacity a hero drags along at 5 feet. In a game the server says what
        // the hero moves at; the sum here is for a hero at home, and for an older server.
        let dragging = live?.standing.dragging ?? false
        let exhaustion = live?.standing.exhaustion ?? sheet.exhaustion
        let tired = max(0, sheet.speed - 5 * exhaustion)
        let feet = live?.standing.speed ?? (dragging ? min(5, tired) : tired)
        let label = dragging ? "Speed, dragging" : feet < sheet.speed ? "Speed, exhausted" : "Speed"
        return StatCell(label: label, spoken: "\(label), \(feet) feet",
                        minWidth: Self.cellWidth, labelTint: feet < sheet.speed ? Palette.ember : Palette.muted) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                number("\(feet)")
                Text("ft").font(.serif(.footnote, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
    }

    private var proficiency: some View {
        StatCell(label: "Proficiency", spoken: "Proficiency bonus, \(SRD.spoken(sheet.proficiencyBonus))",
                 minWidth: Self.cellWidth) {
            number(SRD.signed(sheet.proficiencyBonus))
        }
    }

    private var perception: some View {
        let passive = live?.standing.passivePerception ?? sheet.passivePerception
        return StatCell(label: "Passive Perception", spoken: "Passive perception, \(passive)",
                        minWidth: Self.cellWidth) {
            number("\(passive)")
        }
    }

    private func number(_ text: String) -> some View {
        Text(text)
            .font(.serif(.title3, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// One cell of numbers: the value large, its label beneath in small caps.
struct StatCell<Value: View>: View {
    let label: String
    let spoken: String
    /// The narrowest a cell may get. The vitals use it to decide between one row and two.
    var minWidth: CGFloat = 0
    /// Ember when the label is itself the news ("Down", "Fallen").
    var labelTint: Color = Palette.muted
    @ViewBuilder var value: Value

    @ScaledMetric(relativeTo: .title3) private var valueHeight: CGFloat = 42

    var body: some View {
        VStack(spacing: 4) {
            value.frame(minHeight: valueHeight)
            Text(label.uppercased())
                .font(.serif(.caption2, weight: .semibold))
                .tracking(0.8)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(labelTint)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .frame(minWidth: minWidth, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }
}

/// A heater shield: flat across the top, straight at the shoulders, curving to a point.
struct ShieldShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            let shoulder = rect.minY + rect.height * 0.48
            let belly = rect.minY + rect.height * 0.86
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: shoulder))
            path.addQuadCurve(to: CGPoint(x: rect.midX, y: rect.maxY), control: CGPoint(x: rect.maxX, y: belly))
            path.addQuadCurve(to: CGPoint(x: rect.minX, y: shoulder), control: CGPoint(x: rect.minX, y: belly))
            path.closeSubpath()
        }
    }
}

// MARK: - Tabs

/// The sheet's segmented control, in the app's own colours.
struct SheetTabBar: View {
    let tabs: [HeroSheetTab]
    @Binding var selection: HeroSheetTab
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs) { tab in
                let selected = tab == selection
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = tab }
                } label: {
                    Text(tab.title)
                        .font(.serif(.subheadline, weight: selected ? .semibold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(selected ? Palette.ink : Palette.parchment.opacity(0.85))
                        .padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                Capsule(style: .circular).fill(Palette.gold).matchedGeometryEffect(id: "selected", in: pill)
                            }
                        }
                        // The pill is 36 points tall; the tap target is the full 44.
                        .padding(.vertical, 4)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(.horizontal, 4)
        .background(Palette.surface, in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(0.3), lineWidth: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sheet sections")
    }
}
