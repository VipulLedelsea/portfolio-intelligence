import SwiftUI

enum AppTheme {
    static let background = Color(red: 0.035, green: 0.047, blue: 0.043)
    static let panel = Color(red: 0.067, green: 0.086, blue: 0.075)
    static let line = Color(red: 0.18, green: 0.21, blue: 0.19)
    static let amber = Color(red: 1.0, green: 0.616, blue: 0.184)
    static let mint = Color(red: 0.322, green: 0.875, blue: 0.592)
    static let red = Color(red: 1.0, green: 0.435, blue: 0.38)
    static let muted = Color(red: 0.61, green: 0.65, blue: 0.62)
}

struct PanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(AppTheme.panel)
            .overlay(Rectangle().stroke(AppTheme.line, lineWidth: 1))
    }
}

extension View {
    func panel() -> some View { modifier(PanelModifier()) }
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
    static func sideShift(strip: CGFloat) -> CGFloat { strip / 2 - sideCentreFromEdge }

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
