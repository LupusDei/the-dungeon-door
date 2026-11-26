import SwiftUI

/// The caller's sheet, as its own tab. A scrolling chip row picks the region.
struct PlaySheetPage: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @Binding var pane: PlaySheetPane
    var onAction: (LegalAction) -> Void

    @State private var detail: RuleDetail?

    private var character: Character? { session.me?.character }
    private var sheet: CharacterSheet? { character?.sheet }
    private var live: LiveHero? { session.state.live(of: session.playerId) }
    private var book: RuleBook { RuleBook(reference: model.reference) }
    private var actions: [LegalAction] { session.state.scene?.actions ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            chips
            Rectangle().fill(Palette.gold.opacity(0.15)).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                Group {
                    if let sheet, let character {
                        switch pane {
                        case .abilities:
                            AbilitiesTab(sheet: sheet, live: live, rules: book, open: { detail = $0 })
                        case .saves:
                            PlaySavesPane(sheet: sheet, live: live, combatant: session.state.rules?.combat?.combatant(session.playerId), rules: book)
                        case .attacks:
                            PlayAttacksPane(attacks: character.attacks ?? [], actions: actions, onAction: onAction)
                        case .spells:
                            PlaySpellsPane(sheet: sheet, live: live, actions: actions, rules: book, onAction: onAction)
                        case .items:
                            PlayItemsPane(sheet: sheet, live: live, attacks: character.attacks ?? [], actions: actions, onAction: onAction)
                        case .features:
                            PlayFeaturesPane(sheet: sheet, live: live, actions: actions, rules: book,
                                             open: { detail = $0 }, onAction: onAction)
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
                .frame(maxWidth: .infinity, alignment: .leading)
                ErrorLine(text: session.error)
                    .padding(.horizontal, 16)
                }
            }
        }
        .sheet(item: $detail) { RuleDetailView(detail: $0, attribution: book.reference?.attribution) }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(PlaySheetPane.allCases) { item in
                    Button {
                        withAnimation(.snappy) { pane = item }
                    } label: {
                        Text(item.title)
                            .font(.serif(.caption, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(pane == item ? Palette.gold : Palette.raised, in: Capsule())
                            .foregroundStyle(pane == item ? Palette.ink : Palette.parchment)
                            .overlay { Capsule().strokeBorder(Palette.gold.opacity(pane == item ? 0 : 0.3), lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(pane == item ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Palette.ink)
    }
}

// MARK: - Saves

private struct PlaySavesPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    var combatant: Combatant?
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
            if conditionRows.isEmpty {
                Text("No conditions. The hero stands clear.")
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.muted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
            } else {
                ForEach(conditionRows, id: \.id) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.name).font(.serif(.body, weight: .semibold))
                        if !row.detail.isEmpty {
                            Text(row.detail).font(.serif(.footnote)).foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }
            }

            SectionLabel("Death saves")
            VStack(alignment: .leading, spacing: 8) {
                Text(deathWord)
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(deathWord == "Standing" ? Palette.verdigris : Palette.ember)
                Text("The track is six marks. The app is not sent how many have landed, so the marks stay open.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in
                        Image(systemName: "circle").foregroundStyle(Palette.verdigris)
                    }
                    ForEach(0..<3, id: \.self) { index in
                        Image(systemName: "circle").foregroundStyle(Palette.ember).id("fail-\(index)")
                    }
                }
                .font(.system(size: 16))
                .accessibilityLabel("Death saving throw track, six open marks. \(deathWord).")
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private var deathWord: String {
        switch combatant?.status {
        case "dying": "Dying"
        case "stable": "Stable"
        case "dead": "Fallen"
        default: live?.standing.word ?? (sheet.dead ? "Fallen" : "Standing")
        }
    }

    private var conditionRows: [ConditionRow] {
        var rows: [ConditionRow] = []
        var seen = Set<String>()
        func add(_ id: String, name: String, detail: String) {
            let key = id.lowercased()
            guard !key.isEmpty, seen.insert(key).inserted else { return }
            rows.append(ConditionRow(id: key, name: name, detail: detail))
        }
        for held in live?.standing.conditions ?? [] {
            add(held.condition, name: rules.conditionName(held.condition), detail: held.ending)
        }
        for id in combatant?.conditions ?? [] {
            add(id, name: rules.conditionName(id), detail: "")
        }
        if let spell = live?.standing.concentratingOn, !spell.isEmpty {
            add("concentration", name: "Concentrating on \(spell)", detail: "A hit forces a Constitution save to keep it.")
        }
        return rows
    }

    private struct ConditionRow: Identifiable {
        let id: String
        let name: String
        let detail: String
    }
}

// MARK: - Attacks

private struct PlayAttacksPane: View {
    let attacks: [Attack]
    let actions: [LegalAction]
    var onAction: (LegalAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Weapons and spells")
            Text("A tap votes this attack, when the table is offering it.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            if attacks.isEmpty && actions.filter({ $0.kind == "attack" }).isEmpty {
                Text("No attacks are listed for this hero yet.")
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.muted)
            }
            ForEach(Array(attacks.enumerated()), id: \.offset) { _, attack in
                attackCard(attack)
            }
            let commons = actions.filter { $0.kind == "common" }
            if !commons.isEmpty {
                SectionLabel("Actions")
                ForEach(commons) { action in
                    actionRow(action)
                }
            }
        }
    }

    private func attackCard(_ attack: Attack) -> some View {
        let kind = attack.isSpell ? "spell" : "attack"
        let action = PlayTurn.matching(kind, named: attack.name, id: attack.name, actions: actions)
        let enabled = action?.available == true
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(attack.name)
                    .font(.serif(.title3, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Text(attack.isSpell ? "Spell" : attack.ranged ? "Ranged" : "Melee")
                    .font(.serif(.caption, weight: .semibold))
                    .foregroundStyle(attack.isSpell ? Palette.verdigris : Palette.gold)
            }
            HStack(alignment: .top, spacing: 12) {
                stat("To hit", attack.neverMisses ? "Always" : attack.save != nil ? "Save" : SRD.signed(attack.bonus))
                stat("Damage", attack.damage.isEmpty ? "—" : attack.damage)
                stat("Range", rangeLine(attack, action: action))
            }
            Button {
                if let action { onAction(action) }
            } label: {
                Text(action?.label ?? (attack.isSpell ? "Cast \(attack.name)" : "Attack with \(attack.name)"))
                    .font(.serif(.subheadline, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(enabled ? Palette.gold : Palette.raised, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(enabled ? Palette.ink : Palette.muted)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            if let reason = action?.reason, action?.available == false {
                Text(reason).font(.serif(.caption)).foregroundStyle(Palette.ember)
            } else if action == nil {
                Text("Not on offer this turn.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(14)
        .card()
    }

    private func actionRow(_ action: LegalAction) -> some View {
        Button { onAction(action) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(action.label)
                    .font(.serif(.body, weight: .semibold))
                    .foregroundStyle(action.available ? Palette.parchment : Palette.muted)
                if !action.detail.isEmpty {
                    Text(action.detail).font(.serif(.footnote)).foregroundStyle(Palette.muted)
                }
                if let reason = action.reason, !action.available {
                    Text(reason).font(.serif(.caption)).foregroundStyle(Palette.ember)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .card()
        }
        .buttonStyle(.plain)
        .disabled(!action.available)
    }

    private func stat(_ title: String, _ value: String) -> some View {
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

    private func rangeLine(_ attack: Attack, action: LegalAction?) -> String {
        if let range = action?.rangeFeet {
            if let long = range.long, long > range.normal { return "\(range.normal)/\(long) ft" }
            if range.normal > 0 { return "\(range.normal) ft" }
        }
        if let reach = action?.reachFeet, reach > 0 { return "\(reach) ft" }
        if attack.isSpell { return "Spell" }
        return attack.ranged ? "Ranged" : "5 ft"
    }
}

// MARK: - Spells

private struct PlaySpellsPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let actions: [LegalAction]
    let rules: RuleBook
    var onAction: (LegalAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let casting = sheet.spellcasting {
                SectionLabel("Spell slots")
                let left = live?.standing.slotsLeft ?? casting.slotsLeft
                HStack(spacing: 8) {
                    ForEach(Array(casting.slots.enumerated()), id: \.offset) { index, most in
                        if most > 0 {
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

                if !casting.cantrips.isEmpty {
                    SectionLabel("Cantrips")
                    ForEach(casting.cantrips, id: \.self) { id in
                        spellRow(id, cantrip: true)
                    }
                }
                if !casting.prepared.isEmpty {
                    SectionLabel("Prepared")
                    ForEach(casting.prepared, id: \.self) { id in
                        spellRow(id, cantrip: false)
                    }
                }
            } else {
                Text("This hero has no spellcasting.")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private func spellRow(_ id: String, cantrip: Bool) -> some View {
        let name = rules.spellName(id)
        let action = PlayTurn.matching("spell", named: name, id: id, actions: actions)
        let enabled = action?.available == true
        return HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.serif(.body, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                Text(rules.spellLine(id) ?? (cantrip ? "Cantrip" : "Prepared"))
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = action?.reason, action?.available == false {
                    Text(reason).font(.serif(.caption)).foregroundStyle(Palette.ember)
                }
            }
            Spacer(minLength: 8)
            Button(action?.label ?? "Cast") {
                if let action { onAction(action) }
            }
            .font(.serif(.caption, weight: .semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(enabled ? Palette.gold : Palette.raised, in: Capsule())
            .foregroundStyle(enabled ? Palette.ink : Palette.muted)
            .disabled(!enabled)
            .buttonStyle(.plain)
        }
        .padding(12)
        .card()
    }
}

// MARK: - Items

private struct PlayItemsPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let attacks: [Attack]
    let actions: [LegalAction]
    var onAction: (LegalAction) -> Void

    var body: some View {
        let items = live?.standing.inventory ?? sheet.equipment
        let gold = live?.standing.gp ?? sheet.gp
        let equipped = items.filter { isEquipped($0) }
        let packed = items.filter { !isEquipped($0) }
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

            if let carried = live?.standing.carried, let capacity = live?.standing.capacity, capacity > 0 {
                Text("Carrying \(SRD.pounds(carried)) lb of \(SRD.pounds(capacity)) lb.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
            }

            if !equipped.isEmpty {
                SectionLabel("Equipped")
                ForEach(equipped, id: \.id) { item in itemRow(item) }
            }
            SectionLabel("Inventory")
            if packed.isEmpty {
                Text(equipped.isEmpty ? "Nothing but the clothes on their back." : "Nothing else in the pack.")
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.muted)
            }
            ForEach(packed, id: \.id) { item in itemRow(item) }
        }
    }

    private func isEquipped(_ item: EquipmentItem) -> Bool {
        if SRD.isArmor(item.id) { return true }
        let name = item.name.isEmpty ? SRD.name(item.id) : item.name
        return attacks.contains { attack in
            !attack.isSpell && attack.name.compare(name, options: .caseInsensitive) == .orderedSame
        }
    }

    private func itemRow(_ item: EquipmentItem) -> some View {
        let name = item.name.isEmpty ? SRD.name(item.id) : item.name
        let action = PlayTurn.matching("item", named: name, id: item.id, actions: actions)
        return HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.serif(.body, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                if let reason = action?.reason, action?.available == false {
                    Text(reason).font(.serif(.caption)).foregroundStyle(Palette.ember)
                }
            }
            Spacer(minLength: 8)
            if item.count > 1 {
                Text("×\(item.count)")
                    .font(.serif(.subheadline, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Palette.muted)
            }
            if let action {
                Button(action.available ? "Use" : "Use") { onAction(action) }
                    .font(.serif(.caption, weight: .semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(action.available ? Palette.gold : Palette.raised, in: Capsule())
                    .foregroundStyle(action.available ? Palette.ink : Palette.muted)
                    .disabled(!action.available)
                    .buttonStyle(.plain)
            }
        }
        .padding(12)
        .card()
    }
}

// MARK: - Features

private struct PlayFeaturesPane: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let actions: [LegalAction]
    let rules: RuleBook
    var open: (RuleDetail) -> Void
    var onAction: (LegalAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let resources = live?.standing.resources, !resources.isEmpty {
                SectionLabel("Resources")
                ForEach(resources) { resource in
                    resourceCard(resource)
                }
            }
            SectionLabel("Class and origin")
            ForEach(Array(sheet.features.enumerated()), id: \.offset) { _, name in
                featureRow(name, tag: "Class")
            }
            if !sheet.feat.isEmpty {
                featureRow(sheet.feat, tag: "Feat")
            }
            ForEach(sheet.feats, id: \.self) { id in
                featureRow(rules.featName(id), tag: "Feat", ruleId: id)
            }
            if !sheet.traits.isEmpty {
                SectionLabel("Species traits")
                ForEach(sheet.traits, id: \.self) { id in
                    featureRow(rules.traitName(id), tag: "Trait", traitId: id)
                }
            }
        }
    }

    private func resourceCard(_ resource: ResourceUse) -> some View {
        let action = PlayTurn.matching("feature", named: resource.name, id: resource.id, actions: actions)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(resource.name).font(.serif(.body, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Text("\(resource.left) of \(resource.max)")
                    .font(.serif(.subheadline, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(resource.left == 0 ? Palette.muted : Palette.gold)
            }
            ProgressView(value: Double(resource.left), total: Double(max(resource.max, 1)))
                .tint(Palette.gold)
            if let action {
                Button(action.label) { onAction(action) }
                    .font(.serif(.caption, weight: .semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(action.available ? Palette.gold : Palette.raised, in: Capsule())
                    .foregroundStyle(action.available ? Palette.ink : Palette.muted)
                    .disabled(!action.available)
                    .buttonStyle(.plain)
                if let reason = action.reason, !action.available {
                    Text(reason).font(.serif(.caption)).foregroundStyle(Palette.ember)
                }
            }
        }
        .padding(12)
        .card()
    }

    private func featureRow(_ name: String, tag: String, ruleId: String? = nil, traitId: String? = nil) -> some View {
        let action = PlayTurn.matching("feature", named: name, id: ruleId ?? name, actions: actions)
        return Button {
            if let action, action.available {
                onAction(action)
            } else if let traitId {
                open(rules.trait(traitId, species: SRD.name(sheet.speciesId)))
            } else if let ruleId {
                open(rules.feat(id: ruleId))
            } else {
                open(rules.feature(named: name, classId: sheet.classId, className: nil))
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.serif(.body, weight: .semibold)).foregroundStyle(Palette.parchment)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(action != nil ? "\(tag) · tap to use" : tag)
                        .font(.serif(.caption))
                        .foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: action != nil ? "hand.tap" : "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.muted)
            }
            .padding(12)
            .card()
        }
        .buttonStyle(.plain)
    }
}
