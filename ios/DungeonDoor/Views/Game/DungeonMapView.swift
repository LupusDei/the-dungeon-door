import SwiftUI

/// What an area is called, in as few words as will do.
enum DungeonNames {
    /// "Long hall (40 x 20 ft.)" → "Long hall".
    static func short(_ area: DungeonArea) -> String {
        let cut = area.name.firstIndex(of: "(").map { String(area.name[..<$0]) } ?? area.name
        let trimmed = cut.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? (area.name.isEmpty ? "A place" : area.name) : trimmed
    }

    /// What a room is called on the map: what it is for ("Narthex") says more in less room than
    /// its shape does.
    static func label(_ area: DungeonArea) -> String {
        if let purpose = area.purpose?.trimmingCharacters(in: .whitespaces), !purpose.isEmpty { return purpose }
        return short(area)
    }
}

/// What the party has seen of the dungeon. The server sends the areas they have entered and each
/// one's exits, with no coordinates, so the map is laid out here: the first area at the top, and
/// each way on a step further down. Below the map, the place that's tapped.
struct DungeonMapView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: GameSession
    /// The area whose details are on show; nil follows the party.
    @State private var selectedId: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let dungeon = session.state.rules?.dungeon, !dungeon.areas.isEmpty {
                        let shown = dungeon.area(selectedId) ?? dungeon.here ?? dungeon.areas[0]
                        VStack(alignment: .leading, spacing: 4) {
                            SectionLabel(dungeon.kind)
                            Text(dungeon.mode == "explore"
                                 ? "A dungeon that grows where you go. \(found(dungeon.areas.count)) so far."
                                 : "A mapped dungeon. \(found(dungeon.areas.count)) so far.")
                                .font(.proseSmall.italic())
                                .foregroundStyle(Palette.muted)
                        }
                        MapCanvas(dungeon: dungeon, selectedId: shown.id) { id in
                            withAnimation(.snappy) { selectedId = id }
                        }
                        MapLegend()
                        AreaDetails(area: shown, dungeon: dungeon)
                    } else {
                        Text("There is no map for this adventure.")
                            .font(.proseSmall.italic())
                            .foregroundStyle(Palette.muted)
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(AppConfig.launchScrollAnchor)
            .screenChrome()
            .navigationTitle("The Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func found(_ count: Int) -> String {
        count == 1 ? "1 place found" : "\(count) places found"
    }
}

// MARK: - Layout

/// Where everything on the map goes. A tree, breadth-first from the first area: each area sits
/// above the ways out of it, known areas and unexplored exits alike, and is centred over them.
struct MapLayout {
    struct Link: Hashable {
        let from: CGPoint
        let to: CGPoint
        let connection: String
        var isDoor: Bool { connection.contains("door") }
        var isBarred: Bool { MapLayout.isBarred(connection) }
    }

    /// An exit nobody has taken: a short dashed way to a "?" with the kind of way it is.
    struct Stub: Hashable, Identifiable {
        let id: String
        let from: CGPoint
        let at: CGPoint
        let connection: String
    }

    /// A way that has to be forced or unlocked ("locked-door", "stuck-door"); an "unlocked-door" is not one.
    static func isBarred(_ connection: String) -> Bool {
        if connection.contains("unlocked") { return false }
        return ["locked", "stuck", "barred", "blocked"].contains { connection.contains($0) }
    }

    static let column: CGFloat = 100
    static let row: CGFloat = 104
    static let margin = CGSize(width: 56, height: 40)
    /// An unexplored exit takes less room than an area.
    static let stubWidth: CGFloat = 0.8

    private(set) var size: CGSize = .zero
    private(set) var points: [String: CGPoint] = [:]
    private(set) var links: [Link] = []
    private(set) var stubs: [Stub] = []

    init(dungeon: DungeonMap) {
        let areas = dungeon.areas
        guard let first = areas.first else { return }
        let known = Dictionary(areas.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        // Breadth-first from the entrance: who is reached from whom, and how deep.
        var parent: [String: String] = [:]
        var children: [String: [String]] = [:]
        var depth: [String: Int] = [first.id: 0]
        var roots = [first.id]
        var queue = [first.id]
        func explore() {
            while !queue.isEmpty {
                let id = queue.removeFirst()
                for exit in known[id]?.exits ?? [] {
                    guard let to = exit.to, known[to] != nil, depth[to] == nil else { continue }
                    depth[to] = (depth[id] ?? 0) + 1
                    parent[to] = id
                    children[id, default: []].append(to)
                    queue.append(to)
                }
            }
        }
        explore()
        // An area no known exit leads to (the party fell, or was carried): its own small tree.
        for area in areas where depth[area.id] == nil {
            depth[area.id] = 0
            roots.append(area.id)
            queue = [area.id]
            explore()
        }

        func untried(_ id: String) -> [DungeonExit] {
            (known[id]?.exits ?? []).filter { exit in exit.to.flatMap { known[$0] } == nil }
        }

        // Columns: leaves take the next free one, left to right; a parent sits over the middle of its own.
        var column: [String: CGFloat] = [:]
        var stubColumn: [String: CGFloat] = [:]
        var next: CGFloat = 0
        var deepest = 0
        func place(_ id: String) {
            var spans: [CGFloat] = []
            for child in children[id] ?? [] {
                place(child)
                if let x = column[child] { spans.append(x) }
            }
            for exit in untried(id) {
                let x = next + (Self.stubWidth - 1) / 2
                stubColumn["\(id)/\(exit.id)"] = x
                spans.append(x)
                next += Self.stubWidth
                deepest = max(deepest, (depth[id] ?? 0) + 1)
            }
            if let low = spans.min(), let high = spans.max() {
                column[id] = (low + high) / 2
            } else {
                column[id] = next
                next += 1
            }
            deepest = max(deepest, depth[id] ?? 0)
        }
        for root in roots { place(root) }

        func point(_ x: CGFloat, _ level: Int) -> CGPoint {
            CGPoint(x: Self.margin.width + x * Self.column, y: Self.margin.height + CGFloat(level) * Self.row)
        }
        let widest = max(column.values.max() ?? 0, stubColumn.values.max() ?? 0)
        size = CGSize(width: Self.margin.width * 2 + widest * Self.column,
                      height: Self.margin.height * 2 + CGFloat(deepest) * Self.row + 26)
        for area in areas {
            if let x = column[area.id] { points[area.id] = point(x, depth[area.id] ?? 0) }
        }

        // Ways between two known areas, once each (a door is listed on both of its sides).
        var drawn = Set<String>()
        for area in areas {
            guard let from = points[area.id] else { continue }
            for exit in area.exits {
                if let other = exit.to, other != area.id, let to = points[other] {
                    let pair = [area.id, other].sorted().joined(separator: "\u{1F}")
                    if drawn.insert(pair).inserted { links.append(Link(from: from, to: to, connection: exit.connection)) }
                } else if let x = stubColumn["\(area.id)/\(exit.id)"] {
                    stubs.append(Stub(id: "\(area.id)/\(exit.id)", from: from, at: point(x, (depth[area.id] ?? 0) + 1),
                                      connection: exit.connection))
                }
            }
        }
    }

    /// Where a scroll view of `viewport` should start so that `id` sits mid-view.
    func anchor(for id: String, in viewport: CGSize, canvas: CGSize) -> UnitPoint {
        guard let here = points[id] else { return .top }
        func start(_ at: CGFloat, _ view: CGFloat, _ whole: CGFloat) -> CGFloat {
            guard whole > view else { return 0.5 }
            return min(max(at - view / 2, 0), whole - view) / (whole - view)
        }
        return UnitPoint(x: start(here.x, viewport.width, canvas.width), y: start(here.y, viewport.height, canvas.height))
    }
}

// MARK: - The map

private struct MapCanvas: View {
    let dungeon: DungeonMap
    let selectedId: String?
    let select: (String) -> Void

    var body: some View {
        let layout = MapLayout(dungeon: dungeon)
        let height = min(max(layout.size.height, 230), 440)
        GeometryReader { geo in
            // A small dungeon sits in the middle of the view; a big one scrolls.
            let canvas = CGSize(width: max(layout.size.width, geo.size.width), height: max(layout.size.height, geo.size.height))
            let shift = CGSize(width: (canvas.width - layout.size.width) / 2, height: (canvas.height - layout.size.height) / 2)
            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                ZStack {
                    Canvas { context, _ in
                        context.translateBy(x: shift.width, y: shift.height)
                        for link in layout.links {
                            var line = Path()
                            line.move(to: link.from)
                            line.addLine(to: link.to)
                            context.stroke(line, with: .color(Palette.gold.opacity(0.5)),
                                           style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            if link.isDoor {
                                // A door: a small block across the way, ember when it's barred.
                                let middle = CGPoint(x: (link.from.x + link.to.x) / 2, y: (link.from.y + link.to.y) / 2)
                                let door = CGRect(x: middle.x - 4, y: middle.y - 4, width: 8, height: 8)
                                context.fill(Path(roundedRect: door, cornerRadius: 2),
                                             with: .color(link.isBarred ? Palette.ember : Palette.gold))
                            }
                        }
                        for stub in layout.stubs {
                            var line = Path()
                            line.move(to: stub.from)
                            line.addLine(to: stub.at)
                            context.stroke(line, with: .color(Palette.muted.opacity(0.9)),
                                           style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 5]))
                        }
                    }
                    .frame(width: canvas.width, height: canvas.height)
                    ForEach(layout.stubs) { stub in
                        StubMark(connection: stub.connection)
                            .position(x: stub.at.x + shift.width, y: stub.at.y + shift.height)
                    }
                    ForEach(dungeon.areas) { area in
                        if let point = layout.points[area.id] {
                            AreaMark(area: area, here: area.id == dungeon.at, selected: area.id == selectedId) {
                                select(area.id)
                            }
                            .position(x: point.x + shift.width, y: point.y + shift.height)
                        }
                    }
                }
                .frame(width: canvas.width, height: canvas.height)
            }
            .defaultScrollAnchor(layout.anchor(for: dungeon.at, in: geo.size, canvas: canvas))
        }
        .frame(height: height)
        .background(Palette.surface, in: .rect(cornerRadius: 14))
        .clipShape(.rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.gold.opacity(0.3)) }
    }
}

/// One area on the map: a rounded square with its name beneath. The party's area wears a gold
/// ring; a cleared one a tick.
private struct AreaMark: View {
    let area: DungeonArea
    let here: Bool
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if here {
                    Circle()
                        .strokeBorder(Palette.gold, lineWidth: 2.5)
                        .frame(width: 52, height: 52)
                        .shadow(color: Palette.gold.opacity(0.7), radius: 6)
                } else if selected {
                    Circle()
                        .strokeBorder(Palette.parchment.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .frame(width: 50, height: 50)
                }
                AreaGlyph(area: area, here: here)
            }
            .frame(width: 56, height: 56)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            Text(DungeonNames.label(area))
                .font(.system(size: 10.5, weight: here ? .semibold : .medium, design: .serif))
                .foregroundStyle(here ? Palette.gold : Palette.parchment.opacity(0.85))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: MapLayout.column - 8, alignment: .top)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
                .background(Palette.surface.opacity(0.85))
                .offset(y: 55)
                .allowsHitTesting(false)
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var label: String {
        var parts = [DungeonNames.label(area)]
        if here { parts.append("the party is here") }
        parts.append(area.cleared ? "cleared" : "not cleared")
        return parts.joined(separator: ", ")
    }
}

private struct AreaGlyph: View {
    let area: DungeonArea
    var here = false
    var scale: CGFloat = 1

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8 * scale).fill(area.cleared ? Palette.ink : Palette.raised)
            RoundedRectangle(cornerRadius: 8 * scale)
                .strokeBorder(Palette.gold.opacity(area.cleared ? 0.45 : 0.95), lineWidth: 1.5)
            if here {
                Image(systemName: "figure.walk")
                    .font(.system(size: 15 * scale, weight: .semibold))
                    .foregroundStyle(Palette.gold)
            } else if area.cleared {
                Image(systemName: "checkmark")
                    .font(.system(size: 12 * scale, weight: .bold))
                    .foregroundStyle(Palette.verdigris)
            }
        }
        .frame(width: 36 * scale, height: 36 * scale)
        .overlay(alignment: .topTrailing) {
            // The party is standing in it, so the walker has the middle: the tick moves to the corner.
            if here && area.cleared {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12 * scale))
                    .foregroundStyle(Palette.verdigris, Palette.ink)
                    .offset(x: 5 * scale, y: -5 * scale)
            }
        }
    }
}

/// An exit nobody has taken yet.
private struct StubMark: View {
    let connection: String

    var body: some View {
        ZStack {
            Circle().fill(Palette.surface)
            Circle().strokeBorder(Palette.muted, style: StrokeStyle(lineWidth: 1.25, dash: [3, 3]))
            Image(systemName: AreaDetails.symbol(for: connection))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Palette.muted)
        }
        .frame(width: 24, height: 24)
        .overlay(alignment: .top) {
            Text(SRD.phrase(connection))
                .font(.system(size: 9.5, design: .serif).italic())
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: MapLayout.column * MapLayout.stubWidth - 6, alignment: .top)
                .fixedSize(horizontal: false, vertical: true)
                .offset(y: 27)
        }
        .accessibilityLabel("Unexplored: \(SRD.phrase(connection))")
    }
}

private struct MapLegend: View {
    var body: some View {
        FlowLayout(spacing: 14, lineSpacing: 8) {
            item("You are here") {
                Image(systemName: "figure.walk").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.gold)
            }
            item("Cleared") {
                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.verdigris)
            }
            item("Door") {
                RoundedRectangle(cornerRadius: 2).fill(Palette.gold).frame(width: 8, height: 8)
            }
            item("Barred") {
                RoundedRectangle(cornerRadius: 2).fill(Palette.ember).frame(width: 8, height: 8)
            }
            item("Unexplored") {
                Circle().strokeBorder(Palette.muted, style: StrokeStyle(lineWidth: 1.25, dash: [3, 3])).frame(width: 13, height: 13)
            }
        }
        .accessibilityHidden(true)
    }

    private func item(_ text: String, @ViewBuilder mark: () -> some View) -> some View {
        HStack(spacing: 5) {
            mark().frame(minWidth: 14, minHeight: 14)
            Text(text).font(.caption2).foregroundStyle(Palette.muted)
        }
    }
}

// MARK: - Details

private struct AreaDetails: View {
    let area: DungeonArea
    let dungeon: DungeonMap

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                AreaGlyph(area: area, here: area.id == dungeon.at, scale: 0.9)
                    .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 6) {
                    if let purpose = area.purpose, !purpose.isEmpty {
                        Text(purpose)
                            .font(.display(19))
                            .fixedSize(horizontal: false, vertical: true)
                        if !area.name.isEmpty {
                            Text(area.name)
                                .font(.proseSmall)
                                .foregroundStyle(Palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        Text(area.name.isEmpty ? "A place" : area.name)
                            .font(.display(19))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    FlowLayout(spacing: 5, lineSpacing: 5) {
                        if area.id == dungeon.at { TagLabel("You are here", tint: Palette.gold) }
                        if area.cleared { TagLabel("Cleared") } else { TagLabel("Not cleared", tint: Palette.ember) }
                    }
                }
                Spacer(minLength: 0)
            }
            if !area.exits.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("WAYS OUT")
                        .font(.system(size: 10.5, weight: .semibold, design: .serif))
                        .tracking(1.8)
                        .foregroundStyle(Palette.muted)
                    ForEach(area.exits) { exit in
                        let destination = dungeon.area(exit.to)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: Self.symbol(for: exit.connection))
                                .font(.system(size: 12))
                                .foregroundStyle(Palette.gold)
                                .frame(width: 18)
                            Text(SRD.phrase(exit.connection)).font(.proseSmall)
                            Spacer(minLength: 8)
                            Text(destination.map { "to \(DungeonNames.label($0))" } ?? "Unexplored")
                                .font(destination == nil ? .footnote.italic() : .footnote)
                                .foregroundStyle(Palette.muted)
                                .multilineTextAlignment(.trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .card()
    }

    static func symbol(for connection: String) -> String {
        if MapLayout.isBarred(connection) { return "lock.fill" }
        if connection.contains("secret") { return "eye.slash" }
        if connection.contains("stairs") { return "stairs" }
        if connection.contains("door") { return "door.left.hand.closed" }
        return "arrow.forward"
    }
}
