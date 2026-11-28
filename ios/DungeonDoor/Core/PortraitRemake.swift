import Foundation

/// A hero's portrait while it is being painted or repainted (docs/api.md, POST /api/portrait). The
/// painting on file stays the one a save keeps until the player accepts a new one: a remake is shown
/// beside it as a candidate, to keep or to drop. Nothing here saves; the screen that holds it does.
struct PortraitRemake {
    struct Painting: Equatable {
        var appearance: String?
        var portraitUrl: String?

        init(appearance: String?, portraitUrl: String?) {
            self.appearance = appearance
            self.portraitUrl = portraitUrl
        }

        init(_ result: PortraitResult) {
            self.init(appearance: result.appearance, portraitUrl: result.portraitUrl)
        }
    }

    /// What a save stores.
    private(set) var kept: Painting
    /// A new painting the player hasn't kept or dropped yet.
    private(set) var candidate: Painting?
    /// The painting the hero came in with.
    private let original: Painting
    /// The Look (`description`) each painting was made from, so an edited Look is painted fresh.
    private var keptFrom: String
    private var candidateFrom: String?

    init(_ hero: Character) {
        kept = Painting(appearance: hero.appearance, portraitUrl: hero.portraitUrl)
        original = kept
        keptFrom = hero.description
    }

    var shown: Painting { candidate ?? kept }
    var hasPainting: Bool { shown.portraitUrl != nil }
    var awaitingChoice: Bool { candidate != nil }
    /// A painting other than the hero's own has been kept.
    var changed: Bool { kept != original }

    var paintLabel: String { hasPainting ? "Repaint" : "Paint portrait" }
    var saveLabel: String { kept.portraitUrl == nil && !awaitingChoice ? "Seal without portrait" : "Keep & save" }

    /// The body of a paint request. A repaint revises the painting on show with the note; a first
    /// painting, or one after the Look was rewritten, is described fresh from the hero.
    func request(description: String, note: String) -> (previousAppearance: String?, note: String?) {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let sameLook = description == (candidateFrom ?? keptFrom)
        let previous = shown.portraitUrl != nil && sameLook ? shown.appearance : nil
        return (previous, trimmed.isEmpty ? nil : trimmed)
    }

    /// A painting came back. The first one is simply kept; a repaint waits for the player's choice.
    mutating func painted(_ result: PortraitResult, from description: String? = nil) {
        let painting = Painting(result)
        if kept.portraitUrl == nil && candidate == nil {
            kept = painting
            keptFrom = description ?? keptFrom
        } else {
            candidate = painting
            candidateFrom = description ?? candidateFrom ?? keptFrom
        }
    }

    mutating func keepNew() {
        guard let candidate else { return }
        kept = candidate
        keptFrom = candidateFrom ?? keptFrom
        self.candidate = nil
        candidateFrom = nil
    }

    mutating func backToLast() {
        candidate = nil
        candidateFrom = nil
    }

    /// The hero with the kept painting, ready to save.
    func applied(to hero: Character) -> Character {
        var hero = hero
        hero.appearance = kept.appearance
        hero.portraitUrl = kept.portraitUrl
        return hero
    }
}
