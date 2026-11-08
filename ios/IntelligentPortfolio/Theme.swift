import SwiftUI
import CoreMotion

enum AppTheme {
    static let background = Color(red: 0.035, green: 0.047, blue: 0.043)
    static let panel = Color(red: 0.067, green: 0.086, blue: 0.075)
    static let line = Color(red: 0.18, green: 0.21, blue: 0.19)
    static let amber = Color(red: 1.0, green: 0.616, blue: 0.184)
    static let mint = Color(red: 0.322, green: 0.875, blue: 0.592)
    static let red = Color(red: 1.0, green: 0.435, blue: 0.38)
    static let muted = Color(red: 0.61, green: 0.65, blue: 0.62)
    /// A step above `panel`, for chips, selected segments and nested tiles.
    static let raised = Color(red: 0.098, green: 0.125, blue: 0.108)
    /// A cool secondary for neutral information and the third allocation colour.
    static let sky = Color(red: 0.373, green: 0.659, blue: 0.827)
    static let hairline = Color.white.opacity(0.07)

    static let radius: CGFloat = 16
    static let radiusSmall: CGFloat = 10

    /// Colours handed out to allocation slices and monograms, in a stable order.
    static let palette: [Color] = [amber, mint, sky, Color(red: 0.74, green: 0.60, blue: 0.95), Color(red: 0.95, green: 0.50, blue: 0.70), Color(red: 0.62, green: 0.70, blue: 0.40)]
    static func colour(at index: Int) -> Color { palette[((index % palette.count) + palette.count) % palette.count] }
}

struct PanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(AppTheme.panel, in: RoundedRectangle(cornerRadius: AppTheme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: AppTheme.radius, style: .continuous).stroke(AppTheme.hairline, lineWidth: 1))
    }
}

/// A small inset tile (stats, nested values) with softer corners than a panel.
struct TileModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(10)
            .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: AppTheme.radiusSmall, style: .continuous))
    }
}

extension View {
    func panel() -> some View { modifier(PanelModifier()) }
    func tile() -> some View { modifier(TileModifier()) }
}

/// Gain or loss as a pill. The arrow carries the direction too, so it never relies on colour alone.
struct PnLChip: View {
    let text: String
    let positive: Bool
    var body: some View {
        let colour = positive ? AppTheme.mint : AppTheme.red
        Label(text, systemImage: positive ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
            .font(.caption.weight(.semibold))
            .labelStyle(PnLLabelStyle())
            .foregroundStyle(colour)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(colour.opacity(0.14), in: Capsule())
            .accessibilityLabel("\(positive ? "Up" : "Down") \(text)")
    }
}

private struct PnLLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 8))
            configuration.title
        }
    }
}

/// A coloured circle with the first letters of a ticker.
struct Monogram: View {
    let symbol: String
    let colour: Color
    var size: CGFloat = 38
    var body: some View {
        Text(String(symbol.filter { $0.isLetter || $0.isNumber }.prefix(2)))
            .font(.system(size: size * 0.34, weight: .semibold, design: .rounded))
            .foregroundStyle(colour)
            .frame(width: size, height: size)
            .background(colour.opacity(0.16), in: Circle())
            .accessibilityHidden(true)
    }
}

/// A selectable capsule, for filters and segmented choices.
struct ChipStyle: ButtonStyle {
    var selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .foregroundStyle(selected ? AppTheme.amber : AppTheme.muted)
            .background(selected ? AppTheme.amber.opacity(0.16) : AppTheme.raised, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Section label used above groups of cards.
struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text).font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.muted).textCase(nil)
    }
}

/// Open or closed state of the US market as a small pill. Static on purpose: a looping animation here kept the nav bar redrawing and made paging and taps unreliable.
struct MarketPill: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let status = USMarketClock.status(context.date)
            HStack(spacing: 6) {
                Circle().fill(status.isOpen ? AppTheme.mint : AppTheme.muted).frame(width: 6, height: 6)
                Text(status.text.replacingOccurrences(of: "US market ", with: "Market "))
                    .font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(AppTheme.raised, in: Capsule())
        }
    }
}

struct ReadOnlyBadge: View {
    var body: some View {
        Label("READ-ONLY", systemImage: "lock.shield.fill")
            .font(.caption2.monospaced().bold())
            .foregroundStyle(AppTheme.mint)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .overlay(Capsule().stroke(AppTheme.mint.opacity(0.5)))
            .accessibilityLabel("Read only. No order access.")
    }
}


/// Layout thresholds for the resizable iPhone Duo scene. The scene can be a
/// narrow portrait phone, a wide unfolded canvas, or landscape, so layout
/// decisions follow the width actually offered rather than the device model.
enum AdaptiveLayout {
    static let splitThreshold: CGFloat = 620
    static let listPaneWidth: CGFloat = 400
    static let readableWidth: CGFloat = 760

    static func isWide(_ width: CGFloat) -> Bool { width >= splitThreshold }

    /// The system tab bar floats at the trailing edge as a pill about 47 points wide whose centre is 48.5 points from the
    /// screen edge. The chart-mode pill and the market-trend gauge share that width and centre line so they stack
    /// neatly above it. `shift` moves something centred in the reserved strip onto that line.
    static let sidePillWidth: CGFloat = 48
    static let sideCentreFromEdge: CGFloat = 48.5
    static func sideShift(strip: CGFloat, edge: HorizontalEdge) -> CGFloat {
        let shift = strip / 2 - sideCentreFromEdge
        return edge == .trailing ? shift : -shift
    }

    /// What the hinge reports. `unknown` on phones that don't fold and before the first update.
    enum FoldState { case unknown, partial, full }

    /// How the screen is laid out. `creaseDown`: half open with the crease running top to bottom, so the screen is cut
    /// into left and right halves exactly at the middle. `creaseAcross`: the crease runs left to right, so it is cut into
    /// top and bottom halves. `book`: fully unfolded, a fixed-width list beside a detail pane.
    enum Posture { case compact, book, creaseDown, creaseAcross }

    static func posture(_ size: CGSize, _ insets: EdgeInsets, _ fold: FoldState) -> Posture {
        guard isWide(size.width) else { return .compact }
        let tall = screenHeight(size, insets) / max(size.width, 1) >= tabletopAspect
        switch fold {
        case .partial: return tall ? .creaseAcross : .creaseDown
        case .full: return .book
        // Without a hinge reading, fall back to the shape of the window.
        case .unknown: return tall ? .creaseAcross : .book
        }
    }

    /// Half open with the crease running across the middle (tabletop): both screens are in use but the scene is taller
    /// than wide. Fully unfolded it is wider than tall (about 0.7 for height to width) and half open it measured about
    /// 1.4 including the system bars. iOS has no posture API, so the shape decides. Safe areas are added back so the
    /// ratio is the same wherever the check runs.
    static let tabletopAspect: CGFloat = 1.15
    static func screenHeight(_ size: CGSize, _ insets: EdgeInsets) -> CGFloat { size.height + insets.top + insets.bottom }
    static func isTabletop(_ size: CGSize, _ insets: EdgeInsets) -> Bool {
        isWide(size.width) && screenHeight(size, insets) / max(size.width, 1) >= tabletopAspect
    }
    /// Width of the left pane when the crease runs top to bottom. The crease is the middle of the whole screen, and on
    /// the Duo the system reserves a strip on one side, so the middle of the usable area is not the middle of the screen.
    static func creaseLeftWidth(_ size: CGSize, _ insets: EdgeInsets) -> CGFloat {
        max(200, (size.width + insets.leading + insets.trailing) / 2 - insets.leading - 0.5)
    }
    /// Heights of the part above the crease and the part below it (a 10 point band sits on the crease). The crease is
    /// the middle of the whole screen, so the top part measures from the screen top, behind the bars.
    static func creaseSplit(_ size: CGSize, _ insets: EdgeInsets) -> (top: CGFloat, bottom: CGFloat) {
        let top = max(180, screenHeight(size, insets) / 2 - insets.top - 5)
        return (top, max(120, size.height - top - 10))
    }
}

private struct ReadableWidthModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: AdaptiveLayout.readableWidth)
            .frame(maxWidth: .infinity)
    }
}

extension View {
    @ViewBuilder
    func refreshableIf(_ enabled: Bool, action: @escaping @Sendable () async -> Void) -> some View {
        if enabled { self.refreshable(action: action) } else { self }
    }

    /// Keeps long-form content to a comfortable measure on wide scenes.
    func readableWidth() -> some View { modifier(ReadableWidthModifier()) }
}

extension View {
    /// Liquid Glass on iOS 26 and later, a material with a hairline edge before that.
    @ViewBuilder
    func glass<S: Shape>(_ shape: S, tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            if let tint {
                self.glassEffect(.regular.tint(tint.opacity(0.75)).interactive(), in: shape)
            } else {
                self.glassEffect(.regular.interactive(), in: shape)
            }
        } else {
            self.background(.ultraThinMaterial, in: shape)
                .background(tint?.opacity(0.55) ?? Color.clear, in: shape)
                .overlay(shape.stroke(AppTheme.line, lineWidth: 1))
        }
    }
}

extension View {
    /// An opaque bar in the app background, so content scrolling underneath is hidden instead of showing through blurred.
    func solidNavigationBar() -> some View {
        self.toolbarBackground(AppTheme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}


/// Feeds the hinge state (open, partly open, angle) into the model. Only on iOS 27.1 or later and only on a device
/// that has a hinge; elsewhere nothing is reported and the layouts fall back to the window shape.
struct HingeReader: UIViewRepresentable {
    let onChange: (AdaptiveLayout.FoldState, Double?) -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        if #available(iOS 27.1, *) {
            let handler = onChange
            view.addInteraction(UIHingeInteraction { _, update in
                guard let hinge = update.hinge else { handler(.unknown, nil); return }
                switch hinge.status {
                case .closed, .partiallyOpen: handler(.partial, Double(hinge.angle))
                case .fullyOpen: handler(.full, Double(hinge.angle))
                default: handler(.unknown, Double(hinge.angle))
                }
            })
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}


/// The strip the Duo reserves for system status. It is on the trailing edge one way up and on the leading edge when
/// the phone is turned the other way, so both edges are measured and the wider one is used.
struct SideInsets: Equatable {
    var leading: CGFloat = 0
    var trailing: CGFloat = 0
    var strip: (edge: HorizontalEdge, width: CGFloat)? {
        if trailing >= 56 { return (.trailing, trailing) }
        if leading >= 56 { return (.leading, leading) }
        return nil
    }
    static func == (a: SideInsets, b: SideInsets) -> Bool { a.leading == b.leading && a.trailing == b.trailing }
}

struct SideInsetsKey: PreferenceKey {
    static let defaultValue = SideInsets()
    static func reduce(value: inout SideInsets, nextValue: () -> SideInsets) {
        let next = nextValue()
        value = SideInsets(leading: max(value.leading, next.leading), trailing: max(value.trailing, next.trailing))
    }
}

extension View {
    /// Reports this view's leading and trailing safe-area insets.
    func reportSideInsets(_ update: @escaping (SideInsets) -> Void) -> some View {
        background(GeometryReader { proxy in
            Color.clear.preference(key: SideInsetsKey.self, value: SideInsets(leading: proxy.safeAreaInsets.leading, trailing: proxy.safeAreaInsets.trailing))
        })
        .onPreferenceChange(SideInsetsKey.self) { update($0) }
    }
}

/// Puts content in the reserved strip on whichever edge it is, lined up with the system tab bar.
struct SideStrip<Content: View>: View {
    let edge: HorizontalEdge
    let width: CGFloat
    let top: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 0) {
            if edge == .trailing { Spacer(minLength: 0) }
            content
                .frame(width: width)
                .offset(x: AdaptiveLayout.sideShift(strip: width, edge: edge))
            if edge == .leading { Spacer(minLength: 0) }
        }
        .padding(.top, top)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: edge == .trailing ? .topTrailing : .topLeading)
        .ignoresSafeArea(.container, edges: edge == .trailing ? .trailing : .leading)
    }
}


/// When the desk display starts and stops on its own, modelled on Apple's StandBy but without needing a charger: the
/// phone is on its side (landscape) and sitting still. Turning it upright or picking it up ends it. iOS gives apps no
/// signal for StandBy itself, so these conditions are read directly.
enum StandByRule {
    /// How long the phone must sit still before the display starts, so carrying it in landscape never triggers it.
    static let stillSecondsToStart: TimeInterval = 2

    static func decide(active: Bool, landscape: Bool, stillFor: TimeInterval, pickedUp: Bool) -> Bool {
        guard landscape else { return false }
        if active { return !pickedUp }
        return stillFor >= stillSecondsToStart
    }
}

/// Watches orientation and movement and reports whether the StandBy-style conditions hold.
@MainActor
final class StandByDetector {
    private let motion = CMMotionManager()
    private var loop: Task<Void, Never>?
    private var lastMovement = Date()
    private var landscape = false
    private var active = false
    private var onChange: (Bool) -> Void = { _ in }

    func start(onChange: @escaping (Bool) -> Void) {
        stop()
        self.onChange = onChange
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 0.2
            motion.startDeviceMotionUpdates()
        }
        lastMovement = Date()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                self?.evaluate()
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    func stop() {
        loop?.cancel(); loop = nil
        motion.stopDeviceMotionUpdates()
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
        if active { active = false; onChange(false) }
    }

    private func evaluate() {
        let device = UIDevice.current
        // Lying flat or unknown keeps the last known side, as StandBy does.
        switch device.orientation {
        case .landscapeLeft, .landscapeRight: landscape = true
        case .portrait, .portraitUpsideDown: landscape = false
        default: break
        }
        var pickedUp = false
        if let data = motion.deviceMotion {
            let shake = (data.userAcceleration.x * data.userAcceleration.x + data.userAcceleration.y * data.userAcceleration.y + data.userAcceleration.z * data.userAcceleration.z).squareRoot()
            let spin = (data.rotationRate.x * data.rotationRate.x + data.rotationRate.y * data.rotationRate.y + data.rotationRate.z * data.rotationRate.z).squareRoot()
            if shake > 0.04 || spin > 0.3 { lastMovement = Date() }
            pickedUp = shake > 0.25 || spin > 1.5
        }
        let next = StandByRule.decide(active: active, landscape: landscape,
                                      stillFor: Date().timeIntervalSince(lastMovement), pickedUp: pickedUp)
        if next != active { active = next; onChange(next) }
    }
}
