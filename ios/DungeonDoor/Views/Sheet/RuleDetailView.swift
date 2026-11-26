import SwiftUI

/// A rule worth explaining on a tap: a skill, a spell, a species trait, a feat, a class feature,
/// a condition.
struct RuleDetail: Identifiable, Hashable {
    struct Fact: Hashable {
        var label: String
        var value: String
    }

    let id: String
    var title: String
    /// One muted line under the title: "Level 1 Abjuration", "Strength skill".
    var subtitle: String?
    var tags: [String] = []
    /// A spell's casting time, range, components and duration.
    var facts: [Fact] = []
    /// SRD text: one paragraph per line, `**bold**` around a rule's name. Nil when the reference
    /// hasn't been fetched (or doesn't know the id).
    var description: String?
}

/// Names and explanations for the ids on a sheet, from the rules reference when there is one and
/// from the ids themselves when there isn't.
struct RuleBook {
    let reference: Reference?

    // MARK: Skills

    func skillName(_ id: String) -> String {
        named(reference?.skills[id]?.name) ?? SRD.name(id)
    }

    func skillAbility(_ id: String) -> String? {
        named(reference?.skills[id]?.ability) ?? SRD.ability(forSkill: id)
    }

    func skill(_ id: String, bonus: Int?, proficient: Bool) -> RuleDetail {
        var line = skillAbility(id).map { "\(SRD.abilityName($0)) skill" } ?? "Skill"
        if let bonus { line += " · \(SRD.signed(bonus))" }
        if proficient { line += " · Proficient" }
        return RuleDetail(id: "skill/\(id)", title: skillName(id), subtitle: line,
                          description: named(reference?.skills[id]?.description))
    }

    // MARK: Spells

    func spellName(_ id: String) -> String {
        named(reference?.spells[id]?.name) ?? SRD.name(id)
    }

    /// "Evocation · Action · 120 feet": the line under a spell's name in a list.
    func spellLine(_ id: String) -> String? {
        guard let spell = reference?.spells[id] else { return nil }
        // "Bonus Action, which you take immediately after…" is a detail for the spell's own page.
        let time = spell.castingTime.split(separator: ",").first.map(String.init) ?? spell.castingTime
        let parts = [spell.school, time, spell.range].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    func spellTags(_ id: String) -> [String] {
        guard let spell = reference?.spells[id] else { return [] }
        return (spell.concentration ? ["Concentration"] : []) + (spell.ritual ? ["Ritual"] : [])
    }

    func spell(_ id: String) -> RuleDetail {
        guard let spell = reference?.spells[id] else {
            return RuleDetail(id: "spell/\(id)", title: SRD.name(id), subtitle: "Spell")
        }
        let kind = spell.level == 0 ? "\(spell.school) cantrip" : "Level \(spell.level) \(spell.school)"
        let facts = [("Casting time", spell.castingTime), ("Range", spell.range),
                     ("Components", spell.components), ("Duration", spell.duration)]
            .filter { !$0.1.isEmpty }
            .map { RuleDetail.Fact(label: $0.0, value: $0.1) }
        return RuleDetail(id: "spell/\(id)", title: spellName(id),
                          subtitle: kind.trimmingCharacters(in: .whitespaces), tags: spellTags(id),
                          facts: facts, description: named(spell.description))
    }

    // MARK: Traits, feats, conditions

    func traitName(_ id: String) -> String {
        named(reference?.traits[id]?.name) ?? SRD.name(id)
    }

    func trait(_ id: String, species: String) -> RuleDetail {
        RuleDetail(id: "trait/\(id)", title: traitName(id), subtitle: "\(species) trait",
                   description: named(reference?.traits[id]?.description))
    }

    func feat(named name: String, background: String) -> RuleDetail {
        let known = reference?.feat(named: name)
        return RuleDetail(id: "feat/\(name)", title: named(known?.name) ?? name,
                          subtitle: background.isEmpty ? "Origin feat" : "Origin feat · \(background)",
                          description: named(known?.description))
    }

    /// A feat taken when leveling, which the sheet lists by SRD id.
    func featName(_ id: String) -> String {
        named(reference?.feats[id]?.name) ?? SRD.name(id)
    }

    func feat(id: String) -> RuleDetail {
        RuleDetail(id: "feat/\(id)", title: featName(id), subtitle: "Feat",
                   description: named(reference?.feats[id]?.description))
    }

    /// A class or subclass feature, which the sheet lists by name.
    func feature(named name: String, classId: String, className: String?) -> RuleDetail {
        let known = reference?.feature(named: name, classId: classId)
        let kind = className ?? SRD.name(classId)
        return RuleDetail(id: "feature/\(classId)/\(name)", title: named(known?.name) ?? name,
                          subtitle: kind.isEmpty ? "Class feature" : "\(kind) feature",
                          description: named(known?.description))
    }

    func conditionName(_ id: String) -> String {
        named(reference?.conditions[id]?.name) ?? SRD.name(id)
    }

    func condition(_ id: String) -> RuleDetail {
        RuleDetail(id: "condition/\(id)", title: conditionName(id), subtitle: "Condition",
                   description: named(reference?.conditions[id]?.description))
    }

    /// The first rule on a sheet whose name contains `text`: a spell, a class feature, the origin
    /// feat, a species trait or a skill. For the `-sheetRule` launch argument.
    func rule(named text: String, on sheet: CharacterSheet, species: String) -> RuleDetail? {
        func matches(_ name: String) -> Bool { name.localizedCaseInsensitiveContains(text) }
        let spells = (sheet.spellcasting?.cantrips ?? []) + (sheet.spellcasting?.prepared ?? [])
        if let id = spells.first(where: { matches(spellName($0)) }) { return spell(id) }
        if let name = sheet.features.first(where: matches) { return feature(named: name, classId: sheet.classId, className: nil) }
        if matches(sheet.feat) { return feat(named: sheet.feat, background: SRD.name(sheet.backgroundId)) }
        if let id = sheet.traits.first(where: { matches(traitName($0)) }) { return trait(id, species: SRD.name(species)) }
        if let id = sheet.skillBonuses.keys.sorted().first(where: { matches(skillName($0)) }) {
            return skill(id, bonus: sheet.skillBonuses[id], proficient: sheet.skills.contains(id))
        }
        return nil
    }

    /// An empty string from the reference is as good as none.
    private func named(_ text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }
}

/// The one place rules text is read: a half-height sheet with the rule's name, what kind of thing
/// it is, its text, and the SRD's licence notice beneath it.
struct RuleDetailView: View {
    let detail: RuleDetail
    /// The SRD's CC-BY notice. The licence asks for it wherever the text is shown.
    let attribution: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(detail.title)
                        .font(.serif(.title2, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let subtitle = detail.subtitle {
                        Text(subtitle)
                            .font(.serif(.subheadline).italic())
                            .foregroundStyle(Palette.muted)
                    }
                    if !detail.tags.isEmpty {
                        HStack(spacing: 5) {
                            ForEach(detail.tags, id: \.self) { TagLabel($0) }
                        }
                        .padding(.top, 2)
                    }
                }
                if !detail.facts.isEmpty {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top),
                                        GridItem(.flexible(), spacing: 8, alignment: .top)], spacing: 8) {
                        ForEach(detail.facts, id: \.self) { fact in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(fact.label.uppercased())
                                    .font(.serif(.caption2, weight: .semibold))
                                    .tracking(1)
                                    .foregroundStyle(Palette.muted)
                                Text(fact.value)
                                    .font(.serif(.subheadline, weight: .semibold))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .card()
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                if let description = detail.description {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(Self.paragraphs(description).enumerated()), id: \.offset) { _, paragraph in
                            Text(paragraph)
                                .font(.serif(.body))
                                .lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .textSelection(.enabled)
                    if let attribution, !attribution.isEmpty {
                        Text(attribution)
                            .font(.system(.caption2))
                            .foregroundStyle(Palette.muted.opacity(0.8))
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 6)
                    }
                } else {
                    Text("The rules text for this hasn't reached the app yet.")
                        .font(.serif(.subheadline).italic())
                        .foregroundStyle(Palette.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 26)
            .padding(.bottom, 20)
        }
        .foregroundStyle(Palette.parchment)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Palette.ink)
    }

    /// One paragraph per line of the SRD's text, with `**bold**` turned into bold.
    static func paragraphs(_ text: String) -> [AttributedString] {
        text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { line in
                let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                return (try? AttributedString(markdown: line, options: options)) ?? AttributedString(line)
            }
    }
}
