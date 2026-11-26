import SwiftUI

/// On a dead hero's page: a temple will raise them between adventures, for a price. The hero's own
/// purse can pay, or another of the player's living heroes; the card says who can and has them do
/// it. The price is the server's (SRD 5.2: a Raise Dead service and its diamond).
struct TempleCard: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    /// What the temple asks, in gold pieces.
    static let price = 2_500.0

    @State private var payer: Character?
    @State private var busy = false
    @State private var error: String?

    /// The hero's own purse first, then the player's other living heroes, richest first.
    private var purses: [Character] {
        let others = model.characters
            .filter { $0.id != hero.id && !$0.isFallen && $0.sheet != nil }
            .sorted { ($0.sheet?.gp ?? 0) > ($1.sheet?.gp ?? 0) }
        return [hero] + others
    }

    private var able: [Character] { purses.filter { ($0.sheet?.gp ?? 0) >= Self.price } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("The temple")
            Text("A temple will raise \(hero.name) from the dead for \(Self.gold(Self.price)). \(hero.name) comes back with 1 hit point and \u{2212}4 on every d20 roll, which eases by 1 with each long rest.")
                .font(.serif(.subheadline))
                .foregroundStyle(Palette.parchment.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            if able.isEmpty {
                Label {
                    Text(shortfall).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "bag")
                }
                .font(.serif(.footnote))
                .foregroundStyle(Palette.muted)
            } else {
                ForEach(Array(able.enumerated()), id: \.element.id) { index, purse in
                    Button {
                        payer = purse
                    } label: {
                        HStack(spacing: 8) {
                            Text(purse.id == hero.id ? "Pay from \(hero.name)'s own purse" : "Pay from \(purse.name)'s purse")
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Text(Self.gold(purse.sheet?.gp ?? 0)).monospacedDigit()
                        }
                    }
                    .buttonStyle(GildedButtonStyle(prominent: index == 0))
                    .disabled(busy)
                    .accessibilityHint("Asks before paying \(Self.gold(Self.price))")
                }
            }
            if busy {
                HStack(spacing: 10) {
                    ProgressView().tint(Palette.gold)
                    Text("The rite is under way…").font(.serif(.footnote)).foregroundStyle(Palette.muted)
                }
            }
            ErrorLine(text: error)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .confirmationDialog("Raise \(hero.name) for \(Self.gold(Self.price))?",
                            isPresented: Binding(get: { payer != nil }, set: { if !$0 { payer = nil } }),
                            titleVisibility: .visible, presenting: payer) { purse in
            Button("Pay \(Self.gold(Self.price)) and raise \(hero.name)") { raise(paidBy: purse) }
            Button("Not now", role: .cancel) {}
        } message: { purse in
            Text(purse.id == hero.id
                 ? "The gold comes out of \(hero.name)'s own purse."
                 : "The gold comes out of \(purse.name)'s purse.")
        }
    }

    /// Why nobody can pay: what the fullest purse holds, and where gold comes from.
    private var shortfall: String {
        let richest = purses.max { ($0.sheet?.gp ?? 0) < ($1.sheet?.gp ?? 0) } ?? hero
        let holds = Self.gold(richest.sheet?.gp ?? 0)
        let lead = purses.count > 1
            ? "None of your heroes can pay yet. The fullest purse is \(richest.name)'s, with \(holds)."
            : "\(hero.name)'s purse holds \(holds), which is not enough yet."
        return "\(lead) Gold found on an adventure goes home with the hero who carried it, and any of your living heroes can pay."
    }

    /// "2,500 gp", "12.5 gp".
    private static func gold(_ amount: Double) -> String {
        guard amount.isFinite, abs(amount) < 1e15 else { return "0 gp" }
        if amount == amount.rounded() { return "\(Int(amount).formatted(.number)) gp" }
        return "\(SRD.coins(amount)) gp"
    }

    private func raise(paidBy purse: Character) {
        busy = true
        error = nil
        Task {
            do { try await model.raise(hero, paidBy: purse) } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
