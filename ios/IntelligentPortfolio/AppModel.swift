import Foundation
import UIKit
import Combine

@MainActor
final class AppModel: ObservableObject {
    enum ConnectionState: Equatable {
        case checking
        case disconnected
        case pairing
        case connected
    }

    @Published var connectionState: ConnectionState = .checking
    @Published var pairing: PairingStart?
    @Published var discovery: DiscoveryResponse?
    @Published var analysis: AnalysisResponse?
    @Published var memory: MemoryResponse?
    @Published var market: Market = .us
    @Published var isScanning = false
    @Published var isAnalyzing = false
    @Published var errorMessage: String?
    @Published var isGuest = false
    @Published var holdings: HoldingsResponse?
    @Published var isLoadingHoldings = false
    @Published var holdingStats: HoldingStatsResponse?
    @Published var disclaimerAccepted = UserDefaults.standard.bool(forKey: AppModel.disclaimerKey)

    private static let disclaimerKey = "disclaimerAcceptedV1"
    private static let guestKey = "browsingWithoutAccount"

    private let api = APIClient.shared
    private var token: String?
    private var pairingTask: Task<Void, Never>?
    private var autoRefreshTask: Task<Void, Never>?

    func restoreSession() async {
        guard let stored = KeychainStore.load() else {
            if UserDefaults.standard.bool(forKey: Self.guestKey) { await enterGuest() } else { connectionState = .disconnected }
            return
        }
        do {
            let access = try await api.access(token: stored)
            guard access.subscribed else { throw APIError(error: "An active subscription is required.") }
            token = stored
            connectionState = .connected
            await refreshAll()
        } catch {
            KeychainStore.delete()
            connectionState = .disconnected
        }
    }

    /// Shows an error unless it only means a request was cancelled (view refreshed, pull-to-refresh released, task replaced).
    private func report(_ error: Error) {
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
        errorMessage = error.localizedDescription
    }

    func acceptDisclaimer() {
        UserDefaults.standard.set(true, forKey: Self.disclaimerKey)
        disclaimerAccepted = true
    }

    /// Lets someone try the scanner without an account while the service is free. The server decides:
    /// once a paywall is on, anonymous access is refused and this stays unavailable.
    func enterGuest() async {
        errorMessage = nil
        do {
            let access = try await api.access(token: nil)
            guard !access.paywallEnabled || access.subscribed else {
                UserDefaults.standard.set(false, forKey: Self.guestKey)
                errorMessage = "Browsing without an account is not available right now. Connect your account to continue."
                connectionState = .disconnected
                return
            }
            UserDefaults.standard.set(true, forKey: Self.guestKey)
            isGuest = true
            connectionState = .connected
            await refreshScanner()
        } catch {
            report(error)
            connectionState = .disconnected
        }
    }

    func leaveGuest() {
        autoRefreshTask?.cancel()
        UserDefaults.standard.set(false, forKey: Self.guestKey)
        isGuest = false
        discovery = nil
        analysis = nil
        memory = nil
        holdings = nil
        holdingStats = nil
        connectionState = .disconnected
    }

    func beginPairing() async {
        errorMessage = nil
        pairingTask?.cancel()
        do {
            let request = try await api.startPairing(deviceName: UIDevice.current.name)
            pairing = request
            connectionState = .pairing
            pairingTask = Task { [weak self] in await self?.pollPairing(request) }
        } catch {
            report(error)
            connectionState = .disconnected
        }
    }

    private func pollPairing(_ request: PairingStart) async {
        // Cloudflare returns fractional ISO-8601 timestamps. If a future server
        // format cannot be parsed, keep the screen available for the documented
        // ten-minute pairing window instead of dismissing it immediately.
        let expirationDate = PairingExpiryParser.date(from: request.expiresAt)
            ?? Date().addingTimeInterval(10 * 60)
        let pollingInterval = max(request.pollAfterSeconds, 2)

        while !Task.isCancelled, expirationDate > Date() {
            do {
                let status = try await api.pairingStatus(code: request.code, secret: request.pairingSecret)
                if status.approved, let newToken = status.token {
                    try KeychainStore.save(token: newToken)
                    token = newToken
                    isGuest = false
                    UserDefaults.standard.set(false, forKey: Self.guestKey)
                    pairing = nil
                    connectionState = .connected
                    await refreshAll()
                    return
                }
            } catch let error as APIError where error.error.localizedCaseInsensitiveContains("expired") {
                break
            } catch {
                // Transient polling failures are retried until the one-time code expires.
            }
            try? await Task.sleep(for: .seconds(pollingInterval))
        }
        pairing = nil
        connectionState = .disconnected
        errorMessage = "The pairing code expired. Generate a new one and try again."
    }

    func refreshAll() async {
        await refreshScanner()
        await refreshMemory()
        await refreshHoldings()
    }

    /// `manual` accepts only very fresh server data, so a pull or tap really re-checks the market.
    func refreshHoldings(manual: Bool = false) async {
        guard let token else { holdings = nil; return }
        isLoadingHoldings = true
        defer { isLoadingHoldings = false }
        do { holdings = try await api.holdings(token: token, refresh: manual) }
        catch { report(error) }
    }

    /// How long the Holdings tab waits before re-checking: a minute while a market is open, ten when closed.
    var holdingsRefreshInterval: Duration { .seconds(max(30, holdings?.refreshAfterSeconds ?? 300)) }

    func refreshHoldingStats() async {
        guard let token else { holdingStats = nil; return }
        do { holdingStats = try await api.holdingStats(token: token) }
        catch { report(error) }
    }

    /// Returns true when the holding was saved, so the entry sheet can close.
    func addHolding(symbol: String, market: String, shares: Double, price: Double, boughtAt: String) async -> Bool {
        guard let token else { return false }
        do {
            try await api.addHolding(AddHoldingBody(symbol: symbol, market: market, shares: shares, price: price, boughtAt: boughtAt), token: token)
            await refreshHoldings()
            await refreshHoldingStats()
            return true
        } catch {
            report(error)
            return false
        }
    }

    /// Returns true when the extra shares were recorded, so the entry sheet can close.
    func increaseHolding(id: String, shares: Double, price: Double) async -> Bool {
        guard let token else { return false }
        do {
            try await api.increaseHolding(IncreaseHoldingBody(id: id, shares: shares, price: price), token: token)
            await refreshHoldings()
            await refreshHoldingStats()
            return true
        } catch {
            report(error)
            return false
        }
    }

    /// Returns true when the sale was recorded. Selling every share closes the position.
    func sellHolding(id: String, shares: Double, price: Double) async -> Bool {
        guard let token else { return false }
        do {
            try await api.sellHolding(SellHoldingBody(id: id, shares: shares, price: price), token: token)
            await refreshHoldings()
            await refreshHoldingStats()
            return true
        } catch {
            report(error)
            return false
        }
    }

    func removeHolding(id: String) async {
        guard let token else { return }
        do {
            try await api.removeHolding(id: id, token: token)
            await refreshHoldings()
            await refreshHoldingStats()
        } catch { report(error) }
    }

    func selectMarket(_ newMarket: Market) async {
        guard newMarket != market else { return }
        market = newMarket
        discovery = nil
        analysis = nil
        await refreshScanner()
    }

    /// Reads the latest scan. BSE and forex scans are produced by the server on its own
    /// schedule, so this only reads the stored result and re-checks every few minutes.
    func refreshScanner(manual: Bool = false, fromTimer: Bool = false) async {
        // The timer calls this from inside autoRefreshTask, so cancelling it here would cancel the request itself.
        if !fromTimer { autoRefreshTask?.cancel() }
        let requested = market
        isScanning = true
        defer { isScanning = false }
        do {
            let result = try await api.discover(market: requested, token: token, refresh: manual && !requested.isAutomatic)
            guard requested == market else { return }
            discovery = result
            errorMessage = nil
        } catch {
            guard requested == market else { return }
            report(error)
        }
        if requested.isAutomatic {
            let warming = discovery?.warmingUp == true
            autoRefreshTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(warming ? 15 : 300))
                guard !Task.isCancelled else { return }
                await self?.refreshScanner(fromTimer: true)
            }
        }
    }

    func analyze(symbol: String) async {
        isAnalyzing = true
        analysis = nil
        defer { isAnalyzing = false }
        do {
            analysis = try await api.analyze(symbol: symbol, market: market, token: token)
            await refreshMemory()
        } catch { report(error) }
    }

    func refreshMemory() async {
        guard let token else { memory = nil; return }
        do { memory = try await api.memory(token: token) }
        catch { report(error) }
    }

    func disconnect() async {
        pairingTask?.cancel()
        autoRefreshTask?.cancel()
        if let token { try? await api.revoke(token: token) }
        KeychainStore.delete()
        token = nil
        discovery = nil
        analysis = nil
        memory = nil
        holdings = nil
        holdingStats = nil
        connectionState = .disconnected
    }

    /// Erases this account's research history and sessions on the server, then disconnects the device.
    func deleteAccountData() async {
        guard let token else { return }
        do {
            try await api.deleteAccountData(token: token)
            pairingTask?.cancel()
            autoRefreshTask?.cancel()
            KeychainStore.delete()
            self.token = nil
            discovery = nil
            analysis = nil
            memory = nil
        holdings = nil
        holdingStats = nil
            connectionState = .disconnected
        } catch { report(error) }
    }
}

