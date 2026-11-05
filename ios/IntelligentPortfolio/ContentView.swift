import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            if !model.disclaimerAccepted {
                DisclaimerView()
            } else {
            switch model.connectionState {
            case .checking:
                ProgressView("Checking secure access…")
                    .tint(AppTheme.amber)
            case .disconnected, .pairing:
                ConnectionView()
            case .connected:
                TabView {
                    ScannerView()
                        .tabItem { Label("Scanner", systemImage: "chart.xyaxis.line") }
                    HoldingsView()
                        .tabItem { Label("Holdings", systemImage: "briefcase") }
                    MemoryView()
                        .tabItem { Label("Memory", systemImage: "brain.head.profile") }
                    AccountView()
                        .tabItem { Label("Account", systemImage: "person.crop.circle") }
                }
                .tint(AppTheme.amber)
            }
            }
            if model.deskActive, model.connectionState == .connected {
                DeskView().transition(.opacity).zIndex(1)
            }
        }
        .animation(.smooth(duration: 0.5), value: model.deskActive)
        .onAppear { model.updateStandByDetection() }
        .background(HingeReader { state, angle in
            // Only a change of state reaches the layouts; the live angle changes too often to publish.
            if model.fold != state { model.fold = state }
        })
        .alert("IntelligentPortfolio", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

/// US regular trading hours (9:30 AM to 4:00 PM New York, Monday to Friday). Market holidays and early closes are not
/// known to the app, so on those days the countdown is only a guess.
enum USMarketClock {
    struct Status { let isOpen: Bool; let text: String; let progress: Double? }

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    private static func duration(_ seconds: TimeInterval) -> String {
        let minutes = max(0, Int((seconds / 60).rounded(.up)))
        return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
    }

    static func status(_ now: Date) -> Status {
        let weekday = calendar.component(.weekday, from: now)
        func time(_ hour: Int, _ minute: Int, on day: Date) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        }
        let open = time(9, 30, on: now), close = time(16, 0, on: now)
        if (2...6).contains(weekday), now >= open, now < close {
            return Status(isOpen: true, text: "US market open · closes in \(duration(close.timeIntervalSince(now)))",
                          progress: now.timeIntervalSince(open) / close.timeIntervalSince(open))
        }
        for offset in 0...7 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: now), (2...6).contains(calendar.component(.weekday, from: day)) else { continue }
            let next = time(9, 30, on: day)
            guard next > now else { continue }
            let wait = next.timeIntervalSince(now)
            if wait < 24 * 3600 { return Status(isOpen: false, text: "US market closed · opens in \(duration(wait))", progress: nil) }
            let formatter = DateFormatter()
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "EEE h:mm a"
            return Status(isOpen: false, text: "US market closed · opens \(formatter.string(from: next)) ET", progress: nil)
        }
        return Status(isOpen: false, text: "US market closed", progress: nil)
    }
}

/// One flip-clock card. When its value changes, the old top half folds down to reveal the new one and the new bottom
/// half swings into place behind it, like a desk flip clock.
struct FlipTile: View {
    let value: String
    var width: CGFloat = 88
    var height: CGFloat = 78
    @State private var shown: String
    @State private var incoming: String
    @State private var topAngle = 0.0
    @State private var bottomAngle = 90.0

    init(value: String, width: CGFloat = 88, height: CGFloat = 78) {
        self.value = value; self.width = width; self.height = height
        _shown = State(initialValue: value); _incoming = State(initialValue: value)
    }

    private func half(_ text: String, top: Bool) -> some View {
        Text(text)
            .font(.system(size: height * 0.74, weight: .bold, design: .rounded).monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .fixedSize()
            .foregroundStyle(Color(white: 0.96))
            .frame(width: width, height: height)
            .frame(width: width, height: height / 2, alignment: top ? .top : .bottom)
            .clipped()
            .background(LinearGradient(colors: top ? [Color(white: 0.17), Color(white: 0.10)] : [Color(white: 0.08), Color(white: 0.13)],
                                       startPoint: .top, endPoint: .bottom))
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) { half(incoming, top: true); half(shown, top: false) }
            half(shown, top: true)
                .rotation3DEffect(.degrees(topAngle), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: 0.6)
                .offset(y: -height / 4)
            half(incoming, top: false)
                .rotation3DEffect(.degrees(bottomAngle), axis: (x: 1, y: 0, z: 0), anchor: .top, perspective: 0.6)
                .offset(y: height / 4)
            Rectangle().fill(Color.black).frame(width: width, height: 2)
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color(white: 0.26), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 4, y: 2)
        .onChange(of: value) { _, new in flip(to: new) }
        .accessibilityLabel(value)
    }

    private func flip(to new: String) {
        incoming = new
        topAngle = 0; bottomAngle = 90
        withAnimation(.easeIn(duration: 0.26)) { topAngle = -90 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
            withAnimation(.easeOut(duration: 0.26)) { bottomAngle = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
                var reset = Transaction(); reset.disablesAnimations = true
                withTransaction(reset) { shown = new; topAngle = 0; bottomAngle = 90 }
            }
        }
    }
}

/// The desk clock: one flip card per digit, small AM and PM tags, and how long the US market stays open.
struct DeskClock: View {
    private static let digitWidth: CGFloat = 34, digitHeight: CGFloat = 54

    private static func text(_ format: String, _ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = format
        return formatter.string(from: date)
    }

    private func digits(_ value: String, slot: String) -> some View {
        HStack(spacing: 3) {
            ForEach(Array(value.enumerated()), id: \.offset) { index, character in
                FlipTile(value: String(character), width: Self.digitWidth, height: Self.digitHeight)
                    .id("\(slot)\(value.count)-\(index)")
            }
        }
    }

    private func marker(_ label: String, active: Bool) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .tracking(0.5)
            .foregroundStyle(active ? Color.black : AppTheme.muted.opacity(0.55))
            .frame(width: 30, height: (Self.digitHeight - 4) / 2)
            .background(RoundedRectangle(cornerRadius: 5).fill(active ? AppTheme.amber : Color(white: 0.09)))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(active ? AppTheme.amber : Color(white: 0.2), lineWidth: 1))
    }

    var body: some View {
        TimelineView(.everyMinute) { context in
            let now = context.date
            let isPM = Calendar.current.component(.hour, from: now) >= 12
            let market = USMarketClock.status(now)
            VStack(spacing: 9) {
                HStack(alignment: .center, spacing: 7) {
                    digits(Self.text("h", now), slot: "h")
                    VStack(spacing: 11) {
                        Circle().fill(AppTheme.muted.opacity(0.8)).frame(width: 5, height: 5)
                        Circle().fill(AppTheme.muted.opacity(0.8)).frame(width: 5, height: 5)
                    }
                    digits(Self.text("mm", now), slot: "m")
                    VStack(spacing: 4) { marker("AM", active: !isPM); marker("PM", active: isPM) }
                        .padding(.leading, 3)
                }
                HStack(spacing: 6) {
                    Circle().fill(market.isOpen ? AppTheme.mint : AppTheme.muted).frame(width: 7, height: 7)
                    Text(market.text).font(.system(size: 12, weight: .medium)).foregroundStyle(market.isOpen ? AppTheme.mint : AppTheme.muted)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                if let progress = market.progress {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color(white: 0.15))
                            Capsule().fill(LinearGradient(colors: [AppTheme.mint.opacity(0.55), AppTheme.mint], startPoint: .leading, endPoint: .trailing))
                                .frame(width: proxy.size.width * min(max(progress, 0), 1))
                        }
                    }
                    .frame(height: 4)
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }
}

/// A simple line chart of recent closes: the line draws itself from left to right, with a soft fill under it, a dashed
/// level at the starting value, and a dot on the latest point.
struct SparkLine: View {
    let values: [Double]
    let colour: Color
    @State private var drawn = 0.0

    private func points(in size: CGSize) -> [CGPoint] {
        guard values.count > 1, let low = values.min(), let high = values.max() else { return [] }
        let span = max(high - low, 0.0000001)
        return values.enumerated().map { index, value in
            CGPoint(x: size.width * CGFloat(index) / CGFloat(values.count - 1),
                    y: size.height * (0.92 - 0.84 * CGFloat((value - low) / span)))
        }
    }

    var body: some View {
        GeometryReader { geo in
            let pts = points(in: geo.size)
            if let first = pts.first, let last = pts.last {
                let line = Path { path in path.addLines(pts) }
                let area = Path { path in
                    path.addLines(pts)
                    path.addLine(to: CGPoint(x: last.x, y: geo.size.height))
                    path.addLine(to: CGPoint(x: first.x, y: geo.size.height))
                    path.closeSubpath()
                }
                ZStack {
                    Path { path in path.move(to: CGPoint(x: 0, y: first.y)); path.addLine(to: CGPoint(x: geo.size.width, y: first.y)) }
                        .stroke(Color(white: 0.28), style: StrokeStyle(lineWidth: 1, dash: [4, 5]))
                    area.fill(LinearGradient(colors: [colour.opacity(0.32), colour.opacity(0)], startPoint: .top, endPoint: .bottom))
                        .mask(alignment: .leading) { Rectangle().frame(width: geo.size.width * drawn) }
                    line.trim(from: 0, to: drawn)
                        .stroke(colour, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    Circle().fill(colour).frame(width: 11, height: 11).position(last).opacity(drawn >= 1 ? 1 : 0)
                    Circle().stroke(colour.opacity(0.45), lineWidth: 2).frame(width: 22, height: 22).position(last).opacity(drawn >= 1 ? 1 : 0)
                }
            }
        }
        .onAppear { withAnimation(.easeOut(duration: 1.2)) { drawn = 1 } }
    }
}

/// The desk display for tent mode. The screen is split down the middle: the left half cycles through the market
/// trends, the right half through the fresh setups with their buy ranges. One timer drives both halves, so every five
/// seconds they slide left together. The strip along the top holds the position dots and the flip clock.
struct DeskView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tick = 0
    private let timer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()
    private let stripHeight: CGFloat = 112
    /// The real safe area of the window; the view itself ignores it so the black fills the whole screen.
    private var windowInsets: UIEdgeInsets {
        (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first?.safeAreaInsets ?? .zero
    }

    private var trends: [MarketTrend] {
        model.discovery?.allMarketTrends.flatMap { $0.isEmpty ? nil : $0 }
            ?? model.discovery?.marketTrends
            ?? model.discovery?.marketTrend.map { [$0] }
            ?? []
    }
    private var picks: [Candidate] { Array((model.discovery?.candidates ?? []).prefix(10)) }

    var body: some View {
        // Held upright the screen is cut into a top and a bottom half, on its side into a left and a right half. It
        // follows the shape of the screen, so turning the phone rearranges it.
        GeometryReader { geo in
            if geo.size.width > geo.size.height { sideBySide } else { stacked(topInset: windowInsets.top, bottomInset: windowInsets.bottom) }
        }
        .background(Color.black.ignoresSafeArea())
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1) { withAnimation { model.dismissDesk() } }
        .onReceive(timer) { _ in withAnimation(.smooth(duration: 0.9)) { tick += 1 } }
        .task {
            // Keep the data fresh while the phone sits there.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(300))
                await model.refreshScanner()
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    /// Landscape: markets on the left, setups on the right, the flip clock over the right half.
    private var sideBySide: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                HStack { dots(count: trends.count); Spacer() }
                    .padding(.leading, 24).padding(.top, 20)
                    .frame(height: stripHeight, alignment: .top)
                pane(count: trends.count, empty: "Loading markets…") { marketSlide(trends[$0]) }
            }
            Rectangle().fill(AppTheme.line).frame(width: 2)
            VStack(spacing: 0) {
                HStack(alignment: .top) { dots(count: picks.count); Spacer(); DeskClock() }
                    .padding(.horizontal, 24).padding(.top, 16)
                    .frame(height: stripHeight, alignment: .top)
                pane(count: picks.count, empty: "No fresh setups right now") { stockSlide(picks[$0]) }
            }
        }
    }

    /// Portrait: the clock across the top, then markets above and setups below, split at the middle.
    private func stacked(topInset: CGFloat, bottomInset: CGFloat) -> some View {
        VStack(spacing: 0) {
            DeskClock()
                .frame(maxWidth: .infinity)
                .padding(.top, topInset + 10).padding(.bottom, 12)
            pane(count: trends.count, empty: "Loading markets…") { marketSlide(trends[$0]) }
                .overlay(alignment: .topLeading) { dots(count: trends.count).padding(.leading, 20).padding(.top, 4) }
            Rectangle().fill(AppTheme.line).frame(height: 2)
            pane(count: picks.count, empty: "No fresh setups right now") { stockSlide(picks[$0]) }
                .overlay(alignment: .topLeading) { dots(count: picks.count).padding(.leading, 20).padding(.top, 8) }
                .padding(.bottom, bottomInset)
        }
    }

    /// Small dots showing which slide is up, so the pace of the rotation is visible.
    private func dots(count: Int) -> some View {
        HStack(spacing: 6) {
            ForEach(0..<min(count, 12), id: \.self) { index in
                Capsule()
                    .fill(index == tick % max(count, 1) ? AppTheme.amber : Color(white: 0.2))
                    .frame(width: index == tick % max(count, 1) ? 18 : 6, height: 6)
            }
        }
        .animation(.smooth(duration: 0.5), value: tick)
    }

    /// One half of the screen: the current slide, replaced by the next one sliding in from the right. The slide is
    /// shrunk to fit when the room under the top strip is short, as it is in landscape.
    private func pane<Content: View>(count: Int, empty: String, @ViewBuilder content: @escaping (Int) -> Content) -> some View {
        GeometryReader { geo in
            ZStack {
                if count > 0 {
                    content(tick % count)
                        .id(tick)
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                } else {
                    Text(empty).font(.title3).foregroundStyle(AppTheme.muted)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(min(1, geo.size.height / 440, geo.size.width / 440))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func marketSlide(_ trend: MarketTrend) -> some View {
        VStack(spacing: 14) {
            Text(trend.shortLabel).font(.system(size: 24, weight: .semibold)).tracking(3).foregroundStyle(AppTheme.muted)
            if let spark = trend.spark, spark.count > 1 {
                SparkLine(values: spark, colour: trendColour(trend.state))
                    .frame(maxWidth: 400)
                    .frame(height: 78)
            }
            TrendRing(trend: trend, spin: 0, flip: 0)
                .scaleEffect(2.0)
                .frame(width: 54 * 2.0, height: 54 * 2.0)
            Text(trend.stateWord).font(.system(size: 40, weight: .bold)).foregroundStyle(trendColour(trend.state))
            if let change = trend.dayChangePct {
                Text(String(format: "%+.2f%% today", change))
                    .font(.system(size: 28, weight: .medium, design: .monospaced))
                    .foregroundStyle(change >= 0 ? AppTheme.mint : AppTheme.red)
            }
            if let breadth = trend.breadthDailyPct {
                VStack(spacing: 6) {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(AppTheme.line)
                            Capsule().fill(trendColour(trend.state)).frame(width: proxy.size.width * min(max(breadth, 0), 100) / 100)
                        }
                    }
                    .frame(height: 10)
                    Text("\(Int(breadth))% of stocks in daily uptrends · ADX \(Int(trend.adx))")
                        .font(.callout).foregroundStyle(AppTheme.muted)
                }
                .frame(maxWidth: 380)
            }
        }
        .padding(28)
    }

    private func stockSlide(_ c: Candidate) -> some View {
        let directionColour = c.direction == "SHORT" ? AppTheme.red : AppTheme.mint
        return VStack(spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(c.symbol).font(.system(size: 58, weight: .bold, design: .monospaced))
                Text(c.direction).font(.title2.bold()).foregroundStyle(directionColour)
            }
            Text(c.company).font(.title3).foregroundStyle(AppTheme.muted).lineLimit(1)
            Text(PriceFormat.string(c.price, prefix: c.currencySymbol, decimals: c.priceDecimals))
                .font(.system(size: 44, weight: .semibold))
            if let range = c.buyRange {
                BuyRangeBar(range: range, currency: c.currencySymbol, decimals: c.priceDecimals)
                    .frame(maxWidth: 420)
            }
            if let closing = c.windowClosesAt.flatMap(PairingExpiryParser.date(from:)) {
                Text("Entry window: \(shortLeft(closing))").font(.title3).foregroundStyle(AppTheme.amber)
            }
        }
        .padding(28)
    }
}
