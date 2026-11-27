import SwiftUI

/// On a hero's page: the way to the adventures they have been on.
struct QuestsLink: View {
    @Environment(AppModel.self) private var model
    let hero: Character
    @State private var quests: [Adventure]?

    var body: some View {
        NavigationLink {
            HeroQuestsView(hero: hero, loaded: quests)
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "book.pages.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Palette.gold)
                    .frame(width: 30)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Quests").font(.serif(.headline, weight: .semibold))
                    Text(summary)
                        .font(.serif(.footnote))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.muted)
                    .accessibilityHidden(true)
            }
            .padding(14)
            .card()
        }
        .buttonStyle(.plain)
        .task(id: hero.id) { quests = try? await model.api.adventures(characterId: hero.id) }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the adventures \(hero.name) has been on")
    }

    private var summary: String {
        guard let quests else { return "The adventures \(hero.name) has been on, with their pictures and how they ended." }
        guard let latest = quests.first else { return "No adventures yet. The ones \(hero.name) goes on are kept here." }
        let count = quests.count == 1 ? "1 adventure" : "\(quests.count) adventures"
        return "\(count). Latest: \(latest.name)."
    }
}

/// A hero's adventures, most recently played first.
struct HeroQuestsView: View {
    @Environment(AppModel.self) private var model
    let hero: Character
    /// What the link on the hero's page had already fetched, shown while the list is fetched again.
    var loaded: [Adventure]?
    @State private var quests: [Adventure]?
    @State private var error: String?
    /// `-openQuest <CODE|latest>`: the record to go straight on to, once the list has come (screenshot checks).
    @State private var launched: Adventure?
    @State private var launchHandled = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let quests = quests ?? loaded {
                    if quests.isEmpty {
                        Text("\(hero.name) has not been on an adventure yet. Open a door or knock on a friend's, and it will be kept here: every scene, its picture, and how it ended.")
                            .font(.prose.italic())
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .card()
                    }
                    ForEach(quests) { quest in
                        NavigationLink { QuestRecordView(quest: quest) } label: { QuestCard(quest: quest) }
                            .buttonStyle(.plain)
                    }
                } else if error == nil {
                    ProgressView().tint(Palette.gold).frame(maxWidth: .infinity).padding(40)
                }
                ErrorLine(text: error)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(AppConfig.launchScrollAnchor)
        .screenChrome()
        .navigationTitle("\(hero.name)'s quests")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(item: $launched) { QuestRecordView(quest: $0) }
    }

    private func load() async {
        do {
            let fresh = try await model.api.adventures(characterId: hero.id)
            quests = fresh
            error = nil
            if !launchHandled, let asked = AppConfig.openQuestArgument {
                launchHandled = true
                launched = asked.lowercased() == "latest" ? fresh.first : fresh.first { $0.code == asked.uppercased() }
            }
        } catch {
            if (quests ?? loaded) == nil { self.error = "The chronicles wouldn't open: \(error.localizedDescription)" }
        }
    }
}

/// One adventure in the list: its picture, its name, when, and how it came out.
private struct QuestCard: View {
    @Environment(AppModel.self) private var model
    let quest: Adventure

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let cover = quest.coverURL {
                // Part of the card: the pictures open large on the adventure's own page.
                Color.clear
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay {
                        AsyncImage(url: cover, transaction: Transaction(animation: .easeIn(duration: 0.4))) { phase in
                            if case .success(let image) = phase { image.resizable().scaledToFill() } else { Palette.raised }
                        }
                    }
                    .clipShape(.rect(cornerRadius: 10))
                    .accessibilityHidden(true)
            }
            Text(quest.name)
                .font(.serif(.title3, weight: .bold))
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            QuestVerdict(quest: quest)
            Text(facts)
                .font(.serif(.footnote))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .accessibilityElement(children: .combine)
    }

    private var facts: String {
        var parts: [String] = []
        if let day = quest.day { parts.append(day) }
        if let master = model.catalog?.dungeonMaster(quest.dungeonMaster)?.name { parts.append("told by \(master)") }
        parts.append(quest.party.isEmpty ? "alone" : "with \(quest.party.formatted(.list(type: .and)))")
        let pictures = quest.images.count
        if pictures > 0 { parts.append(pictures == 1 ? "1 picture" : "\(pictures) pictures") }
        return parts.joined(separator: " · ")
    }
}

/// How it came out, as a coloured line: ember for a death, gold for an ending, muted for one left unfinished.
private struct QuestVerdict: View {
    let quest: Adventure

    var body: some View {
        Label(quest.verdict, systemImage: symbol)
            .font(.serif(.subheadline, weight: .semibold))
            .foregroundStyle(tint)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var symbol: String {
        quest.result?.fell == true ? "leaf.fill" : quest.ended ? "checkmark.seal.fill" : "hourglass"
    }

    private var tint: Color {
        quest.result?.fell == true ? Palette.ember : quest.ended ? Palette.gold : Palette.muted
    }
}

/// One past adventure, read back: how it came out, its pictures, every scene and the ending.
struct QuestRecordView: View {
    @Environment(AppModel.self) private var model
    let quest: Adventure
    @State private var story: GameState?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                heading
                outcome
                if quest.imageURLs.count > 1 { gallery }
                if let story {
                    scenes(story)
                } else if error == nil {
                    ProgressView().tint(Palette.gold).frame(maxWidth: .infinity).padding(24)
                }
                ErrorLine(text: error)
            }
            .padding(20)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(AppConfig.launchScrollAnchor)
        .screenChrome()
        .navigationTitle("Quest")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            story = try await model.api.game(quest.code, since: nil)
            error = nil
        } catch {
            self.error = "The story wouldn't open: \(error.localizedDescription)"
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(quest.name)
                .font(.serif(.title, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(byline)
                .font(.serif(.subheadline))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var byline: String {
        var parts: [String] = []
        if let day = quest.day { parts.append(day) }
        if let master = model.catalog?.dungeonMaster(quest.dungeonMaster)?.name { parts.append("told by \(master)") }
        if let hero = quest.hero?.name, !hero.isEmpty {
            parts.append(quest.party.isEmpty ? "\(hero), alone" : "\(hero) with \(quest.party.formatted(.list(type: .and)))")
        }
        return parts.joined(separator: " · ")
    }

    /// The result: how the hero came out, what they gained, and who did not come back.
    private var outcome: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("How it came out")
            VStack(alignment: .leading, spacing: 8) {
                QuestVerdict(quest: quest)
                if let result = quest.result {
                    Text(gains(result))
                        .font(.serif(.footnote))
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    let others = result.fallen.filter { $0 != quest.hero?.name }
                    if !others.isEmpty {
                        Text("\(others.formatted(.list(type: .and))) did not come back.")
                            .font(.serif(.footnote))
                            .foregroundStyle(Palette.ember)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func gains(_ result: Adventure.Outcome) -> String {
        let scenes = quest.scenes == 1 ? "1 scene" : "\(quest.scenes) scenes"
        let levels = result.levelsGained == 0 ? "no new level"
            : result.levelsGained == 1 ? "1 level gained" : "\(result.levelsGained) levels gained"
        return "\(scenes) · \(result.xpGained) XP earned · \(levels)"
    }

    /// Every picture painted on the way, small; a tap shows one large.
    private var gallery: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Pictures")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(quest.imageURLs.enumerated()), id: \.offset) { index, url in
                        Color.clear
                            .frame(width: 132, height: 99)
                            .overlay {
                                AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.4))) { phase in
                                    if case .success(let image) = phase { image.resizable().scaledToFill() } else { Palette.raised }
                                }
                            }
                            .clipShape(.rect(cornerRadius: 9))
                            .overlay { RoundedRectangle(cornerRadius: 9).stroke(Palette.gold.opacity(0.4), lineWidth: 1) }
                            .generatedImageViewer(url: url, title: "Picture \(index + 1) of \(quest.imageURLs.count)")
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }

    /// The story as the game kept it: each scene with its picture, what the party did and what came
    /// of it, then the epilogue.
    @ViewBuilder private func scenes(_ story: GameState) -> some View {
        ForEach(story.chronicle ?? []) { entry in
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Scene \(entry.index + 1)")
                Text(entry.title)
                    .font(.serif(.title2, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                if entry.imageURL != nil { IllustrationView(url: entry.imageURL, paintingLabel: "No painting survived") }
                if !entry.choiceLabel.isEmpty {
                    Text("The party chose: \(entry.choiceLabel)")
                        .font(.proseSmall.weight(.semibold))
                        .foregroundStyle(Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(entry.roleplay.enumerated()), id: \.offset) { _, line in
                    (Text(line.characterName + ": ").bold() + Text(line.text))
                        .font(.proseSmall)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(entry.outcome)
                    .font(.prose)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        if let last = story.scene, last.isFinale {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("The ending")
                Text(last.title)
                    .font(.serif(.title2, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                if last.imageURL != nil { IllustrationView(url: last.imageURL, paintingLabel: "No painting survived") }
                Text(last.narration)
                    .font(.prose)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if !quest.ended {
            Text("This adventure was not finished. It can still be picked up from the door with its code, \(quest.code), while the party is there.")
                .font(.prose.italic())
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
