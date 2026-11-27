import SwiftUI

/// The two quick-action buttons above "What do you do?", and the wheel each one opens.
///
/// A turn in a fight is mostly the same handful of things: strike, dodge, get away, cast. They are
/// all in `scene.actions` already (the server lists what this hero can and cannot do), and the Sheet
/// tab can declare any of them, but that is a tab away. These put them on the page the player is on:
/// the left button fans out the everyday actions, the right one the hero's spells and class
/// abilities. What cannot be done just now stays on the wheel, grey, and says why when touched. An
/// action that needs a target turns the wheel into its targets, so the whole turn is declared here.

/// Which button a wheel opened from.
enum WheelKind: String, Hashable {
    /// Attacks, the common actions (Dodge, Dash, Disengage, Hide…), moves and items.
    case actions
    /// Spells and class abilities.
    case powers
}

/// What goes on each wheel, in what order, and how an action reads on a small round button.
enum QuickActions {
    static func list(_ kind: WheelKind, in scene: GameScene) -> [LegalAction] {
        let wanted: Set<String> = kind == .actions ? ["attack", "common", "move", "item"] : ["spell", "feature"]
        var actions = scene.actions.filter { wanted.contains($0.kind) }
        // Outside a fight the server lists every fighting action as unavailable ("Not in a fight").
        // A wheel of them all in grey tells the player nothing, so they are left off it.
        if !scene.combat { actions.removeAll { !$0.available && $0.reason == notInAFight } }
        // The bare "Attack" is the weapons already on the wheel.
        if kind == .actions, actions.contains(where: { $0.kind == "attack" }) {
            actions.removeAll { $0.kind == "common" && $0.id.lowercased().hasSuffix(":attack") }
        }
        // Dash is on the wheel once: the action. Its squares are picked on the map.
        if actions.contains(where: { $0.kind == "common" && $0.id.lowercased().contains("dash") }) {
            actions.removeAll { $0.kind == "move" && $0.label == "Dash" }
        }
        // What the hero can do first, then the rest; inside each, the order a player reaches for them.
        return actions.enumerated().sorted { left, right in
            if left.element.available != right.element.available { return left.element.available }
            let (l, r) = (rank(left.element), rank(right.element))
            return l != r ? l < r : left.offset < right.offset
        }.map(\.element)
    }

    /// The server's reason for an action that only a fight allows (server/lib/play/legal.ts).
    private static let notInAFight = "Not in a fight"

    /// True when either wheel holds something this hero can do now: then the buttons are worth showing.
    static func worthShowing(in scene: GameScene) -> Bool {
        list(.actions, in: scene).contains(where: \.available) || list(.powers, in: scene).contains(where: \.available)
    }

    private static func rank(_ action: LegalAction) -> Int {
        let id = action.id.lowercased()
        switch action.kind {
        case "attack", "spell": return 0
        case "feature": return 1
        case "common":
            if id.contains("dodge") { return 1 }
            if id.contains("disengage") { return 2 }
            if id.contains("dash") { return 3 }
            if id.contains("hide") { return 4 }
            if id.contains("help") { return 5 }
            return 8
        case "move": return 6
        case "item": return 7
        default: return 9
        }
    }

    /// "Attack with Greatsword" is "Greatsword" on a button that already means attack.
    /// `among` is everything on the same wheel: the one foe a hero can close with needs no name.
    static func title(_ action: LegalAction, among: [LegalAction] = []) -> String {
        if action.kind == "move", action.label.hasPrefix("Move to ") {
            let where_ = String(action.label.dropFirst("Move to ".count))
            guard where_.hasPrefix("engage ") else { return "Move " + where_ }
            let closing = among.filter { $0.kind == "move" && $0.label.hasPrefix("Move to engage ") }.count
            return closing <= 1 ? "Engage" : "Engage " + where_.dropFirst("engage ".count)
        }
        for lead in ["Attack with ", "Cast ", "Drink ", "Use "] where action.label.hasPrefix(lead) && action.label.count > lead.count {
            let rest = String(action.label.dropFirst(lead.count))
            if rest.hasPrefix("an ") || rest.hasPrefix("a ") { return action.label }
            // Under a potion's picture, "Potion of Greater Healing" is "Greater Healing".
            return rest.hasPrefix("Potion of ") && rest.count > "Potion of ".count ? String(rest.dropFirst("Potion of ".count)) : rest
        }
        return action.label
    }

    static func symbol(_ action: LegalAction) -> String {
        let text = (action.id + " " + action.label).lowercased()
        switch action.kind {
        case "attack": return action.rangeFeet != nil ? "scope" : "figure.fencing"
        case "spell": return "sparkles"
        case "feature": return "star.circle.fill"
        case "item": return text.contains("potion") ? "cross.vial.fill" : "bag.fill"
        case "move":
            if text.contains("dash") { return "figure.run" }
            return text.contains("engage") ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"
        default:
            if text.contains("dodge") { return "shield.lefthalf.filled" }
            if text.contains("disengage") { return "arrow.uturn.backward" }
            if text.contains("dash") { return "figure.run" }
            if text.contains("hide") { return "eye.slash.fill" }
            if text.contains("help") { return "hand.raised.fill" }
            if text.contains("ready") { return "hourglass" }
            if text.contains("object") { return "shippingbox.fill" }
            if text.contains("break") { return "lock.open.fill" }
            if text.contains("attack") { return "figure.fencing" }
            return "circle.hexagongrid.fill"
        }
    }

    static func name(_ kind: WheelKind, in scene: GameScene) -> String {
        guard kind == .powers else { return "Actions" }
        // By what the hero has, not by what is on the wheel just now.
        let spells = scene.actions.contains { $0.kind == "spell" }
        let abilities = scene.actions.contains { $0.kind == "feature" }
        return spells && abilities ? "Spells & abilities" : spells ? "Spells" : "Abilities"
    }
}

/// The two buttons. Each reports where it sits so its wheel can fan out from it.
struct QuickActionBar: View {
    let scene: GameScene
    /// False while the table is not choosing: the buttons show, dimmed, and open nothing.
    let enabled: Bool
    var open: (WheelKind, CGRect) -> Void

    @State private var frames: [WheelKind: CGRect] = [:]

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            button(.actions, symbol: "figure.fencing")
            button(.powers, symbol: "sparkles")
        }
    }

    private func button(_ kind: WheelKind, symbol: String) -> some View {
        let actions = QuickActions.list(kind, in: scene)
        let ready = actions.filter(\.available).count
        let usable = enabled && !actions.isEmpty
        return Button {
            open(kind, frames[kind] ?? .zero)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(QuickActions.name(kind, in: scene))
                        .font(.serif(.subheadline, weight: .semibold))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(actions.isEmpty ? "None" : ready == 0 ? "None just now" : "\(ready) ready")
                        .font(.serif(.caption2))
                        .foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background(Palette.surface, in: .rect(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.gold.opacity(usable ? 0.6 : 0.2), lineWidth: 1) }
            .opacity(usable ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!usable)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(ActionWheel.space)) } action: { frames[kind] = $0 }
        .accessibilityLabel("\(QuickActions.name(kind, in: scene)), \(ready) ready")
        .accessibilityHint("Opens a wheel of them")
    }
}

/// A wheel of round buttons that fans out from the button that opened it. Open at six o'clock:
/// when there are more options than fit, that is where they come and go as the wheel is turned.
struct ActionWheel: View {
    /// The coordinate space the wheel and its buttons' frames share (set on the story page).
    static let space = "storyPage"

    let kind: WheelKind
    let title: String
    let actions: [LegalAction]
    /// The middle of the button that opened it, in `space`.
    let origin: CGPoint
    /// Declares the action with these targets (none for an action that names no one).
    var declare: (LegalAction, [String]) -> Void
    /// A move that is made on the map.
    var openMap: (LegalAction) -> Void
    var close: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 70 points at the default text size, a little more as the text grows (the wheel grows with it).
    @ScaledMetric(relativeTo: .caption2) private var scaledChip: CGFloat = 70

    /// 0 at the button, 1 on the wheel: the fan-out.
    @State private var spread: CGFloat = 0
    /// How far the wheel has been turned, in slots (0 shows the first options; negative brings on later ones).
    @State private var turn: CGFloat = AppConfig.wheelTurnArgument.map { -CGFloat($0) } ?? 0
    /// A turn in progress: the finger's last angle, and the turn before the ends hold it back.
    @State private var dragging: (last: CGFloat, raw: CGFloat)?
    /// The action whose targets the wheel is showing.
    @State private var aiming: LegalAction?
    @State private var picked: [String] = []
    /// Why a grey option cannot be taken, once it has been touched.
    @State private var note: String?

    private var chip: CGFloat { min(scaledChip, 84) }
    /// The gap at six o'clock, in degrees.
    fileprivate static let gap: CGFloat = 70

    var body: some View {
        GeometryReader { geo in
            let ring = Ring(size: geo.size, origin: origin, chip: chip, count: options.count)
            ZStack {
                Color.black.opacity(0.72 * Double(min(spread * 1.5, 1)))
                    .contentShape(Rectangle())
                    .onTapGesture(perform: dismiss)
                    .accessibilityHidden(true)
                dial(ring)
                hub(ring)
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    let angle = ring.angle(of: index, turn: turn)
                    Button { tap(option) } label: {
                        WheelChip(title: option.title, symbol: option.symbol, enabled: option.enabled,
                                  selected: option.selected, size: chip)
                    }
                    .buttonStyle(.plain)
                    .opacity(ring.visibility(angle))
                    .allowsHitTesting(ring.visibility(angle) > 0.6)
                    .modifier(FanOut(progress: spread, origin: origin, center: ring.center, radius: ring.radius, degrees: angle))
                    .animation(reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.28).delay(Double(index) * 0.022), value: spread)
                    .accessibilityHidden(ring.visibility(angle) <= 0.6)
                    .accessibilityLabel(option.spoken)
                    .accessibilityHint(option.enabled ? "" : (option.reason ?? "Not now"))
                }
            }
            .contentShape(Rectangle())
            // Ahead of the buttons: a finger that turns the wheel by one of them does not also press it.
            .highPriorityGesture(spin(ring), including: turns(ring) ? .all : .subviews)
            .onAppear {
                if let aim = AppConfig.wheelAimArgument, let action = actions.first(where: { $0.label.localizedCaseInsensitiveContains(aim) }) { aiming = action }
                if reduceMotion { spread = 1 } else { withAnimation(.spring(duration: 0.5, bounce: 0.28)) { spread = 1 } }
            }
        }
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape, dismiss)
    }

    // MARK: What is on the wheel

    private struct Option: Identifiable {
        let id: String
        let title: String
        let symbol: String
        var enabled = true
        var selected = false
        var reason: String?
        var spoken: String
        var action: LegalAction?
        var target: LegalTarget?
    }

    private var options: [Option] {
        if let aiming {
            return aiming.targets.map {
                Option(id: "target:\($0.id)", title: $0.name, symbol: "scope", selected: picked.contains($0.id), spoken: $0.name, target: $0)
            }
        }
        return actions.map {
            Option(id: $0.id, title: QuickActions.title($0, among: actions), symbol: QuickActions.symbol($0), enabled: $0.available,
                   reason: $0.reason, spoken: $0.label, action: $0)
        }
    }

    private var many: Bool { aiming?.picks == "many" }
    private var limit: Int { aiming.map { $0.limit ?? $0.targets.count } ?? 0 }

    private func tap(_ option: Option) {
        if let target = option.target, let aiming {
            guard many else { return send(aiming, [target.id]) }
            if let at = picked.firstIndex(of: target.id) { picked.remove(at: at) } else if picked.count < limit { picked.append(target.id) }
            return
        }
        guard let action = option.action else { return }
        guard action.available else {
            note = action.reason ?? "Not just now"
            return
        }
        if action.kind == "move", !action.squares.isEmpty {
            openMap(action)
            return
        }
        if action.picks == "none" || action.targets.isEmpty { return send(action, []) }
        if action.targets.count == 1 { return send(action, [action.targets[0].id]) }
        // More than one it could name: the wheel becomes its targets.
        note = nil
        picked = []
        refan { aiming = action; turn = 0 }
    }

    private func send(_ action: LegalAction, _ targets: [String]) {
        declare(action, targets)
    }

    private func dismiss() {
        if aiming != nil {
            refan { aiming = nil; picked = []; turn = 0 }
        } else {
            close()
        }
    }

    /// Folds the wheel in, changes what is on it, and fans it out again.
    private func refan(_ change: @escaping () -> Void) {
        guard !reduceMotion else { return change() }
        withAnimation(.easeIn(duration: 0.14)) { spread = 0.35 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
            change()
            withAnimation(.spring(duration: 0.45, bounce: 0.3)) { spread = 1 }
        }
    }

    // MARK: The middle of the wheel

    /// The wheel's face: a dark disc the words in the middle sit on, and the track the buttons ride.
    private func dial(_ ring: Ring) -> some View {
        let middle = CGPoint(x: origin.x + (ring.center.x - origin.x) * spread, y: origin.y + (ring.center.y - origin.y) * spread)
        return ZStack {
            Circle()
                .fill(Palette.ink.opacity(0.94))
                .frame(width: (ring.radius * 2 - chip - 8) * spread, height: (ring.radius * 2 - chip - 8) * spread)
            Circle()
                .trim(from: ActionWheel.gap / 720, to: 1 - ActionWheel.gap / 720)
                .stroke(Palette.gold.opacity(0.22), style: StrokeStyle(lineWidth: 1, dash: [2, 5]))
                .rotationEffect(.degrees(90))
                .frame(width: ring.radius * 2 * spread, height: ring.radius * 2 * spread)
        }
        .position(middle)
        .opacity(Double(min(spread * 1.4, 1)))
        .animation(reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.2), value: spread)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func hub(_ ring: Ring) -> some View {
        VStack(spacing: 6) {
            Text(aiming.map { QuickActions.title($0) } ?? title)
                .font(.serif(.headline, weight: .bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let hint = hint(ring) {
                Text(hint)
                    .font(.serif(.caption))
                    .foregroundStyle(note == nil ? Palette.muted : Palette.ember)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if many {
                Button("Send (\(picked.count) of \(limit))") { if let aiming { send(aiming, picked) } }
                    .font(.serif(.subheadline, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Palette.gold, in: Capsule())
                    .opacity(picked.isEmpty ? 0.4 : 1)
                    .disabled(picked.isEmpty)
                    .buttonStyle(.plain)
                    .accessibilityLabel("Send, \(picked.count) of up to \(limit) chosen")
            }
            Button(action: dismiss) {
                Image(systemName: aiming == nil ? "xmark" : "arrow.uturn.backward")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.gold)
                    .frame(width: 40, height: 40)
                    .background(Palette.surface, in: Circle())
                    .overlay { Circle().strokeBorder(Palette.gold.opacity(0.5), lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(aiming == nil ? "Close the wheel" : "Back to \(title.lowercased())")
        }
        // The middle of a wheel is only so big: its words stop growing where they would spill onto the buttons.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .frame(width: max(ring.radius * 2 - chip - 44, 110))
        .position(x: origin.x + (ring.center.x - origin.x) * spread, y: origin.y + (ring.center.y - origin.y) * spread)
        .opacity(Double(min(spread * 1.4, 1)))
        .animation(reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.2), value: spread)
    }

    /// One short line under the title: why a grey option cannot be taken, or what to do next.
    private func hint(_ ring: Ring) -> String? {
        if let note { return note }
        if aiming != nil { return many ? nil : "Choose a target" }
        return turns(ring) ? "Turn the wheel for more" : nil
    }

    // MARK: Turning it

    private func turns(_ ring: Ring) -> Bool { options.count > ring.slots }

    /// A drag around the middle turns the wheel, when it holds more than it can show. The wheel
    /// follows the finger, coasts a little way on a flick, and comes to rest on a whole slot.
    private func spin(_ ring: Ring) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .local)
            .onChanged { drag in
                guard turns(ring) else { return }
                let now = Ring.degrees(from: ring.center, to: drag.location)
                var track = dragging ?? (last: Ring.degrees(from: ring.center, to: drag.startLocation), raw: turn)
                track.raw += Ring.shortest(now - track.last) / ring.step
                track.last = now
                dragging = track
                turn = ring.held(track.raw, among: options.count)
            }
            .onEnded { drag in
                guard let track = dragging else { return }
                dragging = nil
                let coast = Ring.shortest(Ring.degrees(from: ring.center, to: drag.predictedEndLocation) - track.last) / ring.step
                withAnimation(.spring(duration: 0.45, bounce: 0.2)) { turn = ring.settled(track.raw + coast, among: options.count) }
            }
    }
}

/// Where everything on the wheel goes. Angles are degrees clockwise from twelve o'clock; the wheel
/// is open for `ActionWheel.gap` degrees around six.
private struct Ring {
    let center: CGPoint
    let radius: CGFloat
    /// Degrees from one slot to the next.
    let step: CGFloat
    /// How many options show at once.
    let slots: Int
    /// The first slot's angle (the last is its mirror image).
    let first: CGFloat

    init(size: CGSize, origin: CGPoint, chip: CGFloat, count: Int) {
        let margin: CGFloat = 10
        let fits = min(size.width, size.height) / 2 - chip / 2 - margin
        // Bigger buttons ride a bigger wheel, where the screen has room for one.
        radius = max(min(150 + (chip - 70), fits), chip)
        // As near the button as the wheel fits: across the middle, and no higher or lower than it must be.
        let reach = radius + chip / 2 + margin
        center = CGPoint(x: size.width / 2, y: min(max(origin.y - radius * 0.35, reach), max(size.height - reach, reach)))
        let arc: CGFloat = 360 - ActionWheel.gap
        let half: CGFloat = min((chip / 2 + 3) / radius, 1)
        let least: CGFloat = 2 * asin(half) * 180 / .pi
        let most = max(Int(arc / least) + 1, 2)
        slots = most
        if count >= most {
            step = arc / CGFloat(most - 1)
            first = -arc / 2
        } else {
            // Fewer than fit: spread about the top, no wider apart than looks like one wheel.
            let even: CGFloat = arc / CGFloat(max(count - 1, 1))
            let apart: CGFloat = max(least, 52)
            step = min(even, apart)
            first = -step * CGFloat(count - 1) / 2
        }
    }

    func angle(of index: Int, turn: CGFloat) -> CGFloat { first + (CGFloat(index) + turn) * step }

    /// 1 on the wheel, fading to 0 over half a slot as an option turns into the gap.
    func visibility(_ angle: CGFloat) -> Double {
        let edge = (360 - ActionWheel.gap) / 2
        let over = abs(angle) - edge
        return over <= 0 ? 1 : Double(max(0, 1 - over / (step * 0.5)))
    }

    /// The turn while a finger is on it: free between the ends, stiff past them.
    func held(_ turn: CGFloat, among count: Int) -> CGFloat {
        let low = -CGFloat(max(count - slots, 0))
        if turn > 0 { return turn * 0.3 }
        if turn < low { return low + (turn - low) * 0.3 }
        return turn
    }

    /// The turn it comes to rest at: a whole slot, between the ends.
    func settled(_ turn: CGFloat, among count: Int) -> CGFloat {
        min(0, max(-CGFloat(max(count - slots, 0)), turn.rounded()))
    }

    static func degrees(from center: CGPoint, to point: CGPoint) -> CGFloat {
        atan2(point.x - center.x, center.y - point.y) * 180 / .pi
    }

    /// The same turn the short way round: between -180 and 180 degrees.
    static func shortest(_ degrees: CGFloat) -> CGFloat {
        let wrapped = degrees.truncatingRemainder(dividingBy: 360)
        return wrapped > 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped
    }
}

/// Carries a button from where the wheel opened to its place on it, along a spiral: the middle
/// glides from the button to the wheel's centre while the arm grows and swings round.
private struct FanOut: ViewModifier, Animatable {
    var progress: CGFloat
    let origin: CGPoint
    let center: CGPoint
    let radius: CGFloat
    let degrees: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        let middle = CGPoint(x: origin.x + (center.x - origin.x) * progress, y: origin.y + (center.y - origin.y) * progress)
        let swing = (degrees - (1 - progress) * 130) * .pi / 180
        let arm = radius * progress
        return content
            .scaleEffect(0.25 + 0.75 * min(progress, 1.15))
            .opacity(Double(min(max(progress * 1.8, 0), 1)))
            .position(x: middle.x + arm * sin(swing), y: middle.y - arm * cos(swing))
    }
}

/// One round button on the wheel.
private struct WheelChip: View {
    let title: String
    let symbol: String
    var enabled = true
    var selected = false
    let size: CGFloat

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.27, weight: .semibold))
                .foregroundStyle(selected ? Palette.ink : enabled ? Palette.gold : Palette.muted)
            // One word stays on one line, shrunk if it must be, instead of breaking in the middle.
            Text(title)
                .font(.system(.caption2, design: .serif, weight: .semibold))
                .lineLimit(title.contains(" ") ? 2 : 1)
                .minimumScaleFactor(0.6)
                .allowsTightening(true)
                .multilineTextAlignment(.center)
                .foregroundStyle(selected ? Palette.ink : enabled ? Palette.parchment : Palette.muted)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .padding(.horizontal, 5)
        .frame(width: size, height: size)
        .background(selected ? Palette.gold : Palette.surface, in: Circle())
        .overlay { Circle().strokeBorder(enabled ? Palette.gold.opacity(selected ? 1 : 0.75) : Palette.muted.opacity(0.35), lineWidth: 1.5) }
        .shadow(color: .black.opacity(0.5), radius: 5, y: 2)
        .opacity(enabled ? 1 : 0.55)
        .contentShape(Circle())
    }
}
