#if DEBUG
import SwiftUI

enum ProtoSheetPane: String, CaseIterable, Identifiable, Hashable {
    case abilities, saves, attacks, spells, items, features
    var id: String { rawValue }
    var title: String {
        switch self {
        case .abilities: "Abilities"
        case .saves: "Saves"
        case .attacks: "Attacks"
        case .spells: "Spells"
        case .items: "Items"
        case .features: "Features"
        }
    }
}

/// The hero's sheet, as its own tab, with scrolling chips for the six regions of the sheet.
struct ProtoSheetTab: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @Binding var pane: ProtoSheetPane
    @State private var detail: RuleDetail?

    private var character: Character? { session.me?.character }
    private var sheet: CharacterSheet? { character?.sheet }
    private var live: LiveHero? { session.state.live(of: session.playerId) }
    private var book: RuleBook { RuleBook(reference: model.reference) }

    var body: some View {
        VStack(spacing: 0) {
            chips
            Divider().overlay(Palette.gold.opacity(0.15))
            ScrollView {
                Group {
                    if let sheet, let character {
                        switch pane {
                        case .abilities:
                            AbilitiesTab(sheet: sheet, live: live, rules: book, open: { detail = $0 })
                        case .saves:
                            ProtoSavesPane(sheet: sheet, live: live, rules: book)
                        case .attacks:
                            ProtoAttacksPane(sheet: sheet, attacks: character.attacks ?? [], live: live)
                        case .spells:
                            ProtoSpellsPane(sheet: sheet, live: live, rules: book)
                        case .items:
                            ProtoItemsPane(sheet: sheet, live: live)
                        case .features:
                            ProtoFeaturesPane(sheet: sheet, live: live, rules: book, open: { detail = $0 })
                        }
                    } else {
                        Text("This hero has no sheet yet.")
                            .font(.proseSmall.italic())
                            .foregroundStyle(Palette.muted)
                            .padding(24)
                    }
                }
                .padding(16)
                .padding(.bottom, 36)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .sheet(item: $detail) { RuleDetailView(detail: $0, attribution: book.reference?.attribution) }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ProtoSheetPane.allCases) { item in
                    Button {
                        withAnimation(.snappy) { pane = item }
                    } label: {
                        Text(item.title)
                            .font(.serif(.caption, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(pane == item ? Palette.gold : Palette.raised, in: Capsule())
                            .foregroundStyle(pane == item ? Palette.ink : Palette.parchment)
                            .overlay {
                                Capsule().strokeBorder(Palette.gold.opacity(pane == item ? 0 : 0.3), lineWidth: 1)
                            }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Palette.ink)
    }
}

// MARK: - Saves

struct ProtoSavesPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let rules: RuleBook

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionLabel("Saving throws")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(SRD.abilities, id: \.self) { id in
                    let proficient = sheet.savingThrows.contains(id)
                    let bonus = sheet.saveBonuses[id]
                    VStack(spacing: 4) {
                        Text(SRD.ability(id))
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(Palette.gold)
                        Text(SRD.signed(bonus))
                            .font(.serif(.title, weight: .bold))
                            .monospacedDigit()
                        HStack(spacing: 4) {
                            Image(systemName: proficient ? "circle.fill" : "circle")
                                .font(.system(size: 7))
                                .foregroundStyle(proficient ? Palette.gold : Palette.muted)
                            Text(proficient ? "Proficient" : "Untrained")
                                .font(.serif(.caption2))
                                .foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                    .card()
                    .accessibilityLabel("\(SRD.abilityName(id)) save \(SRD.spoken(bonus))\(proficient ? ", proficient" : "")")
                }
            }

            SectionLabel("Conditions")
            if let held = live?.standing.conditions, !held.isEmpty {
                ForEach(held, id: \.condition) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(rules.conditionName(item.condition))
                            .font(.serif(.body, weight: .semibold))
                        if !item.ending.isEmpty {
                            Text(item.ending).font(.serif(.footnote)).foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }
            } else {
                Text("No conditions. The hero stands clear.")
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.muted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
            }

            SectionLabel("Death saves")
            let word = live?.standing.word ?? (sheet.dead ? "Fallen" : "Standing")
            VStack(alignment: .leading, spacing: 8) {
                Text(word)
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(word == "Standing" ? Palette.verdigris : Palette.ember)
                Text("The track is six marks. The app is not sent how many have landed, so the marks stay open.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in
                        Image(systemName: "circle").foregroundStyle(Palette.verdigris)
                    }
                    ForEach(0..<3, id: \.self) { _ in
                        Image(systemName: "circle").foregroundStyle(Palette.ember)
                    }
                }
                .font(.system(size: 16))
                .accessibilityLabel("Death saving throw track, six open marks")
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }
}

// MARK: - Attacks

struct ProtoAttacksPane: View {
    let sheet: CharacterSheet
    let attacks: [Attack]
    var live: LiveHero?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Weapons and spells")
            Text("A tap sends this attack, if the table is taking your vote.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            ForEach(Array(attacks.enumerated()), id: \.offset) { _, attack in
                attackCard(attack)
            }
        }
    }

    private func attackCard(_ attack: Attack) -> some View {
        let range = rangeLine(attack)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(attack.name)
                    .font(.serif(.title3, weight: .bold))
                Spacer()
                Text(attack.isSpell ? "Spell" : attack.ranged ? "Ranged" : "Melee")
                    .font(.serif(.caption, weight: .semibold))
                    .foregroundStyle(attack.isSpell ? Palette.verdigris : Palette.gold)
            }
            HStack(spacing: 16) {
                labeled("To hit", attack.neverMisses ? "Always" : SRD.signed(attack.bonus))
                labeled("Damage", attack.damage)
                labeled("Range", range)
            }
            Button { } label: {
                Text(attack.isSpell ? "Cast \(attack.name)" : "Attack with \(attack.name)")
                    .font(.serif(.subheadline, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Palette.gold, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Palette.ink)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(attack.isSpell ? "Cast \(attack.name)" : "Attack with \(attack.name)")
        }
        .padding(14)
        .card()
    }

    private func labeled(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .serif))
                .tracking(0.6)
                .foregroundStyle(Palette.muted)
            Text(value)
                .font(.serif(.subheadline, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func rangeLine(_ attack: Attack) -> String {
        if attack.isSpell {
            switch attack.name.lowercased() {
            case "fire bolt", "magic missile": return "120 ft"
            case "mage hand": return "30 ft"
            default: return "Spell"
            }
        }
        return attack.ranged ? "80/320 ft" : "5 ft"
    }
}

// MARK: - Spells

struct ProtoSpellsPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let rules: RuleBook

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let casting = sheet.spellcasting {
                SectionLabel("Spell slots")
                HStack(spacing: 8) {
                    let left = live?.standing.slotsLeft ?? casting.slotsLeft
                    ForEach(Array(casting.slots.enumerated()), id: \.offset) { index, most in
                        if most > 0 || index == 0 {
                            let remain = left.indices.contains(index) ? left[index] : most
                            VStack(spacing: 4) {
                                Text(SRD.ordinal(index + 1))
                                    .font(.serif(.caption2, weight: .semibold))
                                    .foregroundStyle(Palette.muted)
                                Text("\(remain)/\(most)")
                                    .font(.serif(.headline, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(remain == 0 ? Palette.muted : Palette.parchment)
                            }
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity)
                            .card()
                        }
                    }
                }
                Text("Save DC \(casting.saveDc) · Attack \(SRD.signed(casting.attackBonus)) · \(SRD.abilityName(casting.ability))")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)

                SectionLabel("Cantrips")
                ForEach(casting.cantrips, id: \.self) { name in
                    spellRow(name, level: 0, canCast: true)
                }
                SectionLabel("Prepared")
                ForEach(casting.prepared, id: \.self) { name in
                    let slotsLeft = (live?.standing.slotsLeft ?? casting.slotsLeft).first ?? 0
                    spellRow(name, level: 1, canCast: slotsLeft > 0)
                }
            } else {
                Text("This hero has no spellcasting.")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private func spellRow(_ name: String, level: Int, canCast: Bool) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.serif(.body, weight: .semibold))
                Text(level == 0 ? "Cantrip" : "\(SRD.ordinal(level))-level")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 8)
            Button(level == 0 ? "Cast" : "Cast (1 slot)") { }
                .font(.serif(.caption, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background((canCast ? Palette.gold : Palette.raised), in: Capsule())
                .foregroundStyle(canCast ? Palette.ink : Palette.muted)
                .disabled(!canCast)
                .buttonStyle(.plain)
        }
        .padding(12)
        .card()
    }
}

// MARK: - Items

struct ProtoItemsPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?

    var body: some View {
        let items = live?.standing.inventory ?? sheet.equipment
        let gold = live?.standing.gp ?? sheet.gp
        let carried = live?.standing.carried
        let capacity = live?.standing.capacity
        return VStack(alignment: .leading, spacing: 16) {
            SectionLabel("Purse")
            HStack {
                Text("Gold").font(.serif(.body, weight: .semibold))
                Spacer()
                Text("\(SRD.coins(gold)) gp")
                    .font(.serif(.title3, weight: .bold))
                    .foregroundStyle(Palette.gold)
                    .monospacedDigit()
            }
            .padding(14)
            .card()

            if let carried, let capacity, capacity > 0 {
                Text("Carrying \(SRD.pounds(carried)) lb of \(SRD.pounds(capacity)) lb.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
            }

            SectionLabel("Inventory")
            ForEach(items, id: \.id) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name.isEmpty ? SRD.name(item.id) : item.name)
                            .font(.serif(.body, weight: .semibold))
                        if SRD.isArmor(item.id) || ["quarterstaff", "longsword", "shortsword", "shortbow", "longbow"].contains(item.id) {
                            Text("Equipped")
                                .font(.serif(.caption, weight: .semibold))
                                .foregroundStyle(Palette.gold)
                        }
                    }
                    Spacer()
                    if item.count > 1 {
                        Text("×\(item.count)")
                            .font(.serif(.subheadline, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(Palette.muted)
                    }
                }
                .padding(12)
                .card()
            }
        }
    }
}

// MARK: - Features

struct ProtoFeaturesPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let rules: RuleBook
    var open: (RuleDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let resources = live?.standing.resources, !resources.isEmpty {
                SectionLabel("Resources")
                ForEach(resources) { resource in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(resource.name).font(.serif(.body, weight: .semibold))
                            Spacer()
                            Text("\(resource.left) of \(resource.max)")
                                .font(.serif(.subheadline, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(resource.left == 0 ? Palette.muted : Palette.gold)
                        }
                        ProgressView(value: Double(resource.left), total: Double(max(resource.max, 1)))
                            .tint(Palette.gold)
                    }
                    .padding(12)
                    .card()
                }
            }

            SectionLabel("Class and origin")
            ForEach(sheet.features, id: \.self) { name in
                featureRow(name, tag: "Class")
            }
            if !sheet.feat.isEmpty {
                featureRow(sheet.feat, tag: "Feat")
            }

            if !sheet.traits.isEmpty {
                SectionLabel("Species traits")
                ForEach(sheet.traits, id: \.self) { id in
                    featureRow(SRD.name(id), tag: "Trait")
                }
            }
        }
    }

    private func featureRow(_ name: String, tag: String) -> some View {
        Button {
            open(rules.feature(named: name, classId: sheet.classId, className: nil))
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.serif(.body, weight: .semibold)).foregroundStyle(Palette.parchment)
                    Text(tag).font(.serif(.caption)).foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.muted)
            }
            .padding(12)
            .card()
        }
        .buttonStyle(.plain)
    }
}
#endif
