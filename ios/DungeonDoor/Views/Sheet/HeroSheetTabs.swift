import SwiftUI

// The five tabs of `HeroSheetView`. Each is sections of `SheetRow`s under a `SectionLabel`, so a
// player learns one layout and finds it everywhere.

/// A titled block of a tab.
private struct SheetSection<Content: View>: View {
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

/// A line that stands in for a list with nothing in it.
private struct SheetNote: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.serif(.subheadline).italic())
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .padding(.horizontal, 14)
            .card()
    }
}

// MARK: - Abilities

/// The six abilities, modifier first (it is what gets added to the die), then every skill.
struct AbilitiesTab: View {
    let sheet: CharacterSheet
    var live: LiveHero?
    let rules: RuleBook
    let open: (RuleDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 3), spacing: 8) {
                ForEach(SRD.abilities, id: \.self) { ability($0) }
            }
            SheetSection(title: "Skills") {
                SheetRowGroup(rows: skillRows, open: open)
            }
            SheetSection(title: "Passive senses") {
                SheetRowGroup(rows: [
                    SheetRow(id: "passive/perception", title: "Passive Perception",
                             subtitle: "What they notice without looking.",
                             value: "\(live?.standing.passivePerception ?? sheet.passivePerception)"),
                    SheetRow(id: "passive/insight", title: "Passive Insight",
                             subtitle: "What they sense of others without asking.", value: "\(passiveInsight)"),
                ])
            }
        }
    }

    /// From the game when there is one. The sheet carries Passive Perception but not this, so
    /// out of a game it is 10 plus the Insight bonus.
    private var passiveInsight: Int {
        live?.standing.passiveInsight ?? 10 + (sheet.skillBonuses["insight"] ?? SRD.modifier(sheet.abilityScores.wis))
    }

    private func ability(_ id: String) -> some View {
        let score = sheet.abilityScores[id]
        let modifier = SRD.modifier(score)
        let save = sheet.saveBonuses[id]
        let proficient = sheet.savingThrows.contains(id)
        return VStack(spacing: 3) {
            Text(SRD.ability(id))
                .font(.serif(.caption, weight: .semibold))
                .tracking(2)
                .foregroundStyle(Palette.gold)
            Text(SRD.signed(modifier))
                .font(.serif(.largeTitle, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text("\(score)")
                .font(.serif(.footnote, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Palette.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 1)
                .background(Palette.raised, in: Capsule(style: .circular))
                .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(0.25), lineWidth: 0.75) }
            Rectangle()
                .fill(Palette.gold.opacity(0.16))
                .frame(height: 1)
                .padding(.top, 6)
            HStack(spacing: 5) {
                Image(systemName: proficient ? "circle.fill" : "circle")
                    .font(.system(size: 7))
                    .foregroundStyle(proficient ? Palette.gold : Palette.muted.opacity(0.7))
                Text("Save")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
                Text(SRD.signed(save))
                    .font(.serif(.subheadline, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(proficient ? Palette.gold : Palette.parchment)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
        }
        .padding(.top, 10)
        .frame(maxWidth: .infinity)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(SRD.abilityName(id)), modifier \(SRD.spoken(modifier)), score \(score), saving throw \(SRD.spoken(save))\(proficient ? ", proficient" : "")")
    }

    /// All the skills the sheet (or the reference) knows, by name, each with its ability as a tag.
    private var skillRows: [SheetRow] {
        let ids = Set(sheet.skillBonuses.keys).union(sheet.skills).union(rules.reference?.skills.keys.map { $0 } ?? [])
        return ids
            .map { id in (id: id, name: rules.skillName(id)) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { skill in
                let proficient = sheet.skills.contains(skill.id)
                let ability = rules.skillAbility(skill.id)
                // A sheet that doesn't list a bonus still has one: the ability's modifier, plus
                // the proficiency bonus when the hero is trained.
                let bonus = sheet.skillBonuses[skill.id] ?? ability.map {
                    SRD.modifier(sheet.abilityScores[$0]) + (proficient ? sheet.proficiencyBonus : 0)
                }
                return SheetRow(
                    id: "skill/\(skill.id)",
                    marker: proficient ? .on : .off,
                    title: skill.name,
                    strong: proficient,
                    tags: ability.map { [SheetRow.Tag(text: SRD.ability($0))] } ?? [],
                    value: bonus.map(SRD.signed),
                    spoken: [skill.name, bonus.map(SRD.spoken), proficient ? "proficient" : nil]
                        .compactMap { $0 }.joined(separator: ", "),
                    detail: rules.skill(skill.id, bonus: bonus, proficient: proficient))
            }
    }
}

// MARK: - Combat

/// What the hero does in a fight, what they have left to spend, and how hard they are to put down.
struct CombatTab: View {
    let sheet: CharacterSheet
    let attacks: [Attack]
    let live: LiveHero?
    let rules: RuleBook
    let open: (RuleDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if !conditionRows.isEmpty {
                SheetSection(title: "Right now") {
                    SheetRowGroup(rows: conditionRows, open: open)
                }
            }
            SheetSection(title: "Attacks") {
                if attacks.isEmpty {
                    SheetNote("No attacks are listed for this hero yet.")
                } else {
                    SheetRowGroup(rows: attackRows)
                }
            }
            if let resources = live?.standing.resources, !resources.isEmpty {
                SheetSection(title: "Class resources") {
                    SheetRowGroup(rows: resources.map(resourceRow), open: open)
                }
            }
            SheetSection(title: "Staying alive") {
                SheetRowGroup(rows: defenceRows, open: open)
            }
            SheetSection(title: "Saving throws") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(SRD.abilities, id: \.self) { save($0) }
                }
            }
        }
    }

    private var attackRows: [SheetRow] {
        attacks.enumerated().map { index, attack in
            let reach = attack.isSpell ? "Spell" : attack.ranged ? "Ranged" : "Melee"
            var row = SheetRow(
                id: "attack/\(index)",
                title: attack.name,
                strong: true,
                tags: [SheetRow.Tag(text: reach, tint: attack.isSpell ? Palette.verdigris : Palette.muted)],
                subtitle: attack.damage,
                pill: true)
            if let save = attack.save {
                // The target saves against the hero's spell save DC; there is no roll to hit.
                let dc = sheet.spellcasting?.saveDc
                row.value = dc.map { "DC \($0)" } ?? "Save"
                row.valueNote = "\(SRD.ability(save).capitalized) save"
                row.spoken = "\(attack.name), \(SRD.abilityName(save)) save\(dc.map { " against DC \($0)" } ?? ""), \(attack.damage), spell"
            } else {
                row.value = SRD.signed(attack.bonus)
                row.valueNote = "to hit"
                row.spoken = "\(attack.name), \(SRD.spoken(attack.bonus)) to hit, \(attack.damage), \(reach.lowercased())"
            }
            return row
        }
    }

    /// How the hero stands in the game on show: down or fallen, and the fight's conditions.
    private var conditionRows: [SheetRow] {
        guard let live else {
            return sheet.dead ? [SheetRow(id: "status", title: "Fallen", strong: true,
                                          tags: [SheetRow.Tag(text: "Dead", tint: Palette.ember)],
                                          subtitle: "Died on an adventure. A temple can raise the dead, for a price.")] : []
        }
        var rows: [SheetRow] = []
        let standing = live.standing
        if !standing.isUp {
            rows.append(SheetRow(id: "status", title: standing.word, strong: true,
                                 tags: [SheetRow.Tag(text: standing.dead ? "Dead" : "0 hit points", tint: Palette.ember)],
                                 subtitle: standing.dead ? "Only a Revivify spell or a temple can bring them back." : "Out of the fight until healed or rested."))
        }
        if standing.isUp, standing.cannotSee {
            rows.append(SheetRow(id: "sight", title: "Cannot see", strong: true,
                                 tags: [SheetRow.Tag(text: "Darkness", tint: Palette.ember)],
                                 subtitle: "No light and no darkvision. Perception and Investigation fail, and in a fight the hero is blinded."))
        } else if standing.isUp, standing.seesDimly {
            rows.append(SheetRow(id: "sight", title: "Sees dimly",
                                 tags: [SheetRow.Tag(text: standing.darkvision > 0 ? "Darkvision \(standing.darkvision) ft" : "Dim light", tint: Palette.muted)],
                                 subtitle: "Perception is rolled twice and the worse die counts."))
        }
        // What the hero carries from scene to scene says how it ends; a fight adds its own
        // short-lived ones, and repeats the carried ones by id.
        let carried = standing.conditions
        rows += carried.map { held in
            SheetRow(id: "condition/\(held.condition)", title: rules.conditionName(held.condition),
                     tags: [SheetRow.Tag(text: "Condition", tint: Palette.ember)],
                     subtitle: held.ending.isEmpty ? nil : held.ending,
                     detail: rules.condition(held.condition))
        }
        rows += live.conditions.filter { id in !carried.contains { $0.condition == id } }.map { id in
            SheetRow(id: "condition/\(id)", title: rules.conditionName(id),
                     tags: [SheetRow.Tag(text: "Condition", tint: Palette.ember)],
                     detail: rules.condition(id))
        }
        if standing.isUp, let spell = standing.concentratingOn, !spell.isEmpty {
            rows.append(SheetRow(id: "holding", title: "Concentrating on \(spell)",
                                 tags: [SheetRow.Tag(text: "Concentration", tint: Palette.gold)],
                                 subtitle: "Each hit forces a Constitution save to keep it. It ends at 0 hit points, and with the fight."))
        }
        return rows
    }

    private func resourceRow(_ resource: ResourceUse) -> SheetRow {
        SheetRow(id: "resource/\(resource.id)", title: resource.name,
                 subtitle: resource.left == 0 ? "Spent until a rest." : nil,
                 valueNote: "\(resource.left) of \(resource.max) left",
                 pips: Pips(left: resource.left, max: resource.max),
                 spoken: "\(resource.name), \(resource.left) of \(resource.max) left",
                 detail: rules.feature(named: resource.name, classId: sheet.classId, className: nil))
    }

    /// The armour and shield in the hero's pack, by name; "Unarmored" when there is neither.
    private var worn: String {
        let pieces = sheet.equipment.filter { SRD.isArmor($0.id) }.map { $0.name.isEmpty ? SRD.name($0.id) : $0.name }
        return pieces.isEmpty ? "Unarmored" : pieces.joined(separator: ", ")
    }

    private var defenceRows: [SheetRow] {
        let ac = live?.standing.armorClass ?? sheet.armorClass
        let dice = max(sheet.level, 1)
        let left = min(dice, live?.standing.hitDiceLeft ?? sheet.hitDiceLeft)
        let exhaustion = live?.standing.exhaustion ?? sheet.exhaustion
        var rows = [
            SheetRow(id: "ac", title: "Armor Class", subtitle: worn, value: "\(ac)",
                     spoken: "Armor class \(ac), \(worn)"),
            SheetRow(id: "hp", title: "Hit point maximum", value: "\(live?.standing.maxHp ?? sheet.maxHp)"),
            SheetRow(id: "hd", title: "Hit Dice",
                     tags: [SheetRow.Tag(text: "d\(SRD.hitDie(forClass: sheet.classId))", tint: Palette.parchment)],
                     subtitle: "Spent on a short rest to heal. All return on a long rest.",
                     valueNote: "\(left) of \(dice) left",
                     pips: Pips(left: left, max: dice),
                     spoken: "Hit dice, \(left) of \(dice) left, d\(SRD.hitDie(forClass: sheet.classId))"),
        ]
        if exhaustion > 0 {
            rows.append(SheetRow(id: "exhaustion", title: "Exhaustion",
                                 tags: [SheetRow.Tag(text: "Level \(exhaustion) of 6", tint: Palette.ember)],
                                 subtitle: "\u{2212}\(exhaustion * 2) to every d20 roll, \u{2212}\(exhaustion * 5) ft of speed. At 6, death. A long rest removes one level.",
                                 value: "\(exhaustion)",
                                 spoken: "Exhaustion level \(exhaustion) of 6",
                                 detail: rules.condition("exhaustion")))
        }
        if let resists = live?.standing.resistances, !resists.isEmpty {
            rows.append(SheetRow(id: "resistances", title: "Resistances",
                                 tags: resists.map { SheetRow.Tag(text: SRD.name($0), tint: Palette.verdigris) },
                                 subtitle: "Takes half damage of \(resists.count == 1 ? "this kind" : "these kinds").",
                                 spoken: "Resists \(resists.map { SRD.name($0) }.joined(separator: ", ")) damage"))
        }
        if sheet.revivalPenalty > 0 {
            let penalty = sheet.revivalPenalty
            rows.append(SheetRow(id: "revival", title: "Weakened by the ordeal",
                                 tags: [SheetRow.Tag(text: "Raised from the dead", tint: Palette.ember)],
                                 subtitle: "\u{2212}\(penalty) to every d20 roll: attacks, checks and saves. Each long rest eases it by 1.",
                                 value: "\u{2212}\(penalty)",
                                 spoken: "Weakened by being raised from the dead, minus \(penalty) to every d 20 roll"))
        }
        return rows
    }

    private func save(_ id: String) -> some View {
        let proficient = sheet.savingThrows.contains(id)
        let bonus = sheet.saveBonuses[id]
        return HStack(spacing: 6) {
            Image(systemName: proficient ? "circle.fill" : "circle")
                .font(.system(size: 7))
            Text(SRD.ability(id))
                .font(.serif(.caption, weight: .semibold))
                .tracking(1.2)
            Spacer(minLength: 0)
            Text(SRD.signed(bonus))
                .font(.serif(.title3, weight: .bold))
                .monospacedDigit()
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .foregroundStyle(proficient ? Palette.gold : Palette.parchment.opacity(0.85))
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(Palette.surface, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Palette.gold.opacity(proficient ? 0.6 : 0.18), lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(SRD.abilityName(id)) saving throw, \(SRD.spoken(bonus))\(proficient ? ", proficient" : "")")
    }
}

// MARK: - Spells

/// What a caster casts with, the slots they have left, and the spells they have ready.
struct SpellsTab: View {
    let casting: Spellcasting
    /// Slots left per spell level from a game in progress. Nil works them out from the sheet.
    var slotsLeft: [Int]?
    let rules: RuleBook
    let open: (RuleDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 8) {
                StatCell(label: "Casting ability",
                         spoken: "Spellcasting ability, \(SRD.abilityName(casting.ability))") {
                    number(casting.ability.isEmpty ? "\u{2014}" : SRD.ability(casting.ability))
                }
                StatCell(label: "Spell save DC", spoken: "Spell save DC, \(casting.saveDc)") {
                    number("\(casting.saveDc)")
                }
                StatCell(label: "Spell attack", spoken: "Spell attack, \(SRD.spoken(casting.attackBonus))") {
                    number(SRD.signed(casting.attackBonus))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            if !slotRows.isEmpty {
                SheetSection(title: "Spell slots") {
                    SheetRowGroup(rows: slotRows)
                }
            }
            if let spell = casting.concentratingOn, !spell.isEmpty {
                SheetSection(title: "Concentrating on") {
                    SheetRowGroup(rows: [
                        SheetRow(id: "concentrating", title: rules.spellName(spell), strong: true,
                                 tags: [SheetRow.Tag(text: "Concentration", tint: Palette.gold)],
                                 subtitle: "Ends if they cast another concentration spell, or lose it to a hit.",
                                 detail: rules.spell(spell))
                    ], open: open)
                }
            }
            if !casting.cantrips.isEmpty {
                SheetSection(title: "Cantrips") {
                    SheetRowGroup(rows: casting.cantrips.map(row), open: open)
                }
            }
            if !casting.prepared.isEmpty {
                SheetSection(title: "Prepared spells") {
                    SheetRowGroup(rows: casting.prepared.map(row), open: open)
                }
            }
            if casting.cantrips.isEmpty && casting.prepared.isEmpty {
                SheetNote("No spells prepared.")
            }
        }
    }

    /// One row per spell level the caster has slots for: a pip each, spent ones dimmed.
    private var slotRows: [SheetRow] {
        let left = slotsLeft ?? casting.slotsLeft
        return casting.slots.enumerated().compactMap { index, most in
            guard most > 0 else { return nil }
            let remaining = min(most, max(0, left.indices.contains(index) ? left[index] : most))
            return SheetRow(id: "slots/\(index)", title: "\(SRD.ordinal(index + 1)) level",
                            subtitle: remaining == 0 ? "All spent until a long rest." : nil,
                            valueNote: "\(remaining) of \(most) left",
                            pips: Pips(left: remaining, max: most),
                            spoken: "\(SRD.ordinal(index + 1)) level slots, \(remaining) of \(most) left")
        }
    }

    private func number(_ text: String) -> some View {
        Text(text)
            .font(.serif(.title3, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    private func row(_ id: String) -> SheetRow {
        let name = rules.spellName(id)
        let line = rules.spellLine(id)
        var tags = rules.spellTags(id).map { SheetRow.Tag(text: $0, tint: Palette.verdigris) }
        if casting.concentratingOn == id { tags.insert(SheetRow.Tag(text: "Active", tint: Palette.gold), at: 0) }
        return SheetRow(
            id: "spell/\(id)",
            title: name,
            tags: tags,
            subtitle: line,
            spoken: ([name] + [line].compactMap { $0 } + tags.map(\.text)).joined(separator: ", "),
            detail: rules.spell(id))
    }
}

// MARK: - Gear

/// What the hero carries, what it weighs on them, what they can use, and what they have yet to pick.
struct GearTab: View {
    let sheet: CharacterSheet
    let attacks: [Attack]
    var live: LiveHero?

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if let standing = live?.standing, standing.capacity > 0 {
                SheetSection(title: "Load") { load(standing) }
            }
            SheetSection(title: "Equipment") {
                if sheet.equipment.isEmpty {
                    SheetNote("Nothing but the clothes on their back.")
                } else {
                    SheetRowGroup(rows: equipmentRows)
                }
            }
            SheetSection(title: "Coin") {
                let gold = live?.standing.gp ?? sheet.gp
                SheetRowGroup(rows: [
                    SheetRow(id: "gp", title: "Gold pieces", value: "\(SRD.coins(gold)) gp",
                             spoken: "\(SRD.coins(gold)) gold pieces"),
                ])
            }
            if !sheet.otherProficiencies.isEmpty {
                SheetSection(title: "Proficiencies") {
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(sheet.otherProficiencies, id: \.self) { id in
                            Text(Self.proficiency(id))
                                .font(.serif(.footnote, weight: .medium))
                                .foregroundStyle(Palette.parchment.opacity(0.9))
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .background(Palette.surface, in: Capsule(style: .circular))
                                .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(0.3), lineWidth: 0.75) }
                        }
                    }
                }
            }
            if !sheet.pendingChoices.isEmpty {
                SheetSection(title: "Still to choose") {
                    SheetRowGroup(rows: sheet.pendingChoices.enumerated().map { index, choice in
                        SheetRow(id: "pending/\(index)", title: choice.prefix(1).uppercased() + choice.dropFirst())
                    })
                }
            }
        }
    }

    /// Pounds carried against what the hero can carry; past that they drag along at 5 feet.
    private func load(_ standing: HeroStanding) -> some View {
        let over = standing.dragging
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(over ? "Dragging" : "Carried")
                    .font(.serif(.body, weight: over ? .semibold : .regular))
                    .foregroundStyle(over ? Palette.ember : Palette.parchment)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(SRD.pounds(standing.carried)).font(.serif(.title3, weight: .semibold))
                    Text("/ \(SRD.pounds(standing.capacity)) lb").font(.serif(.footnote)).foregroundStyle(Palette.muted)
                }
                .monospacedDigit()
            }
            HPBar(hp: Int(standing.carried.rounded()), maxHp: max(1, Int(standing.capacity.rounded())),
                  tint: over ? Palette.ember : Palette.gold, height: 6)
            Text(over
                 ? "Over their carrying capacity: speed drops to 5 ft. Past \(SRD.pounds(standing.dragLimit)) lb they can't move at all."
                 : "Past \(SRD.pounds(standing.capacity)) lb they drag along at 5 ft.")
                .font(.serif(.footnote))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Carrying \(SRD.pounds(standing.carried)) of \(SRD.pounds(standing.capacity)) pounds\(over ? ", dragging" : "")")
    }

    /// "tool-thieves-tools" → "Thieves Tools": the kind of proficiency is plain from the name.
    private static func proficiency(_ id: String) -> String {
        SRD.name(id.hasPrefix("tool-") ? String(id.dropFirst(5)) : id)
    }

    private func isWeapon(_ item: EquipmentItem) -> Bool {
        attacks.contains { attack in
            attack.name.compare(item.name, options: .caseInsensitive) == .orderedSame
                || attack.name.compare(SRD.name(item.id), options: .caseInsensitive) == .orderedSame
        }
    }

    /// Weapons and armour first, then everything else, each group in the order the sheet gives.
    private var equipmentRows: [SheetRow] {
        let ranked = sheet.equipment.enumerated().map { index, item in
            (index: index, item: item, rank: isWeapon(item) ? 0 : SRD.isArmor(item.id) ? 1 : 2)
        }
        return ranked.sorted { ($0.rank, $0.index) < ($1.rank, $1.index) }.map { entry in
            let name = entry.item.name.isEmpty ? SRD.name(entry.item.id) : entry.item.name
            let tag: SheetRow.Tag? = entry.rank == 0 ? .init(text: "Weapon", tint: Palette.gold)
                : entry.rank == 1 ? .init(text: "Armor", tint: Palette.verdigris) : nil
            return SheetRow(
                id: "item/\(entry.index)",
                title: name,
                tags: tag.map { [$0] } ?? [],
                value: entry.item.count > 1 ? "\u{00D7}\(entry.item.count)" : nil,
                spoken: entry.item.count > 1 ? "\(name), \(entry.item.count)" : name)
        }
    }
}

// MARK: - Story

/// Where the hero comes from and what their calling has taught them: species and its traits,
/// background and its feat, class features, and their own story.
struct StoryTab: View {
    let character: Character
    let sheet: CharacterSheet
    let catalog: Catalog?
    let rules: RuleBook
    let open: (RuleDetail) -> Void

    private func name(_ id: String, in list: KeyPath<Catalog, [CatalogOption]>) -> String {
        catalog?.name(id, in: list) ?? SRD.name(id)
    }

    var body: some View {
        let species = name(sheet.speciesId.isEmpty ? character.race : sheet.speciesId, in: \.races)
        let background = sheet.backgroundId.isEmpty ? "" : name(sheet.backgroundId, in: \.backgrounds)
        let className = name(sheet.classId.isEmpty ? character.characterClass : sheet.classId, in: \.classes)
        VStack(alignment: .leading, spacing: 22) {
            SheetSection(title: "Species") {
                SheetRowGroup(rows: [
                    SheetRow(id: "species", title: species, strong: true,
                             subtitle: [sheet.size, "Speed \(sheet.speed) ft"].filter { !$0.isEmpty }.joined(separator: " · "))
                ] + sheet.traits.map { id in
                    SheetRow(id: "trait/\(id)", title: rules.traitName(id), detail: rules.trait(id, species: species))
                }, open: open)
            }
            if !background.isEmpty || !sheet.feat.isEmpty {
                SheetSection(title: "Background") {
                    SheetRowGroup(rows: backgroundRows(background), open: open)
                }
            }
            SheetSection(title: "Class") {
                SheetRowGroup(rows: classRows(className), open: open)
            }
            if !sheet.feats.isEmpty {
                SheetSection(title: "Feats") {
                    SheetRowGroup(rows: sheet.feats.map { id in
                        SheetRow(id: "feat/\(id)", title: rules.featName(id), detail: rules.feat(id: id))
                    }, open: open)
                }
            }
            if !characterRows.isEmpty {
                SheetSection(title: "Character") {
                    SheetRowGroup(rows: characterRows)
                }
            }
            if !character.backstory.isEmpty {
                SheetSection(title: "Backstory") { SheetProse(text: character.backstory) }
            }
            if let appearance = character.appearance, !appearance.isEmpty {
                SheetSection(title: "As the dungeon master sees them") { SheetProse(text: appearance, italic: true) }
            }
        }
    }

    private func backgroundRows(_ background: String) -> [SheetRow] {
        var rows: [SheetRow] = []
        if !background.isEmpty {
            rows.append(SheetRow(id: "background", title: background, strong: true))
        }
        if !sheet.feat.isEmpty {
            rows.append(SheetRow(id: "feat", title: sheet.feat,
                                 tags: [SheetRow.Tag(text: "Origin feat", tint: Palette.gold)],
                                 detail: rules.feat(named: sheet.feat, background: background)))
        }
        return rows
    }

    /// The class and level, then each feature gained so far, once, in the order it was gained.
    private func classRows(_ className: String) -> [SheetRow] {
        let subclass = sheet.subclassId.flatMap { $0.isEmpty ? nil : SRD.name($0) }
        var rows = [SheetRow(id: "class", title: className, strong: true,
                             subtitle: ["Level \(sheet.level)", subclass].compactMap { $0 }.joined(separator: " · "))]
        var seen: [String] = []
        for feature in sheet.features where !seen.contains(feature) { seen.append(feature) }
        rows += seen.map { feature in
            let times = sheet.features.filter { $0 == feature }.count
            return SheetRow(id: "feature/\(feature)", title: feature,
                            tags: times > 1 ? [SheetRow.Tag(text: "\u{00D7}\(times)", tint: Palette.gold)] : [],
                            detail: rules.feature(named: feature, classId: sheet.classId, className: className))
        }
        return rows
    }

    private var characterRows: [SheetRow] {
        [("Gender", character.gender, \Catalog.genders),
         ("Temperament", character.temperament, \Catalog.temperaments),
         ("Alignment", character.alignment, \Catalog.alignments)]
            .filter { !$0.1.isEmpty }
            .map { label, id, list in
                SheetRow(id: label, title: name(id, in: list), tags: [SheetRow.Tag(text: label)],
                         spoken: "\(label), \(name(id, in: list))")
            }
    }
}
