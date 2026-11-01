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

    private let api = APIClient.shared
    private var token: String?
    private var pairingTask: Task<Void, Never>?
    private var autoRefreshTask: Task<Void, Never>?

    func restoreSession() async {
        guard let stored = KeychainStore.load() else {
            connectionState = .disconnected
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

    func beginPairing() async {
        errorMessage = nil
        pairingTask?.cancel()
        do {
            let request = try await api.startPairing(deviceName: UIDevice.current.name)
            pairing = request
            connectionState = .pairing
            pairingTask = Task { [weak self] in await self?.pollPairing(request) }
        } catch {
            errorMessage = error.localizedDescription
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
    func refreshScanner(manual: Bool = false) async {
        guard let token else { return }
        autoRefreshTask?.cancel()
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
            errorMessage = error.localizedDescription
        }
        if requested.isAutomatic {
            let warming = discovery?.warmingUp == true
            autoRefreshTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(warming ? 15 : 300))
                guard !Task.isCancelled else { return }
                await self?.refreshScanner()
            }
        }
    }

    func analyze(symbol: String) async {
        guard let token else { return }
        isAnalyzing = true
        analysis = nil
        defer { isAnalyzing = false }
        do {
            analysis = try await api.analyze(symbol: symbol, market: market, token: token)
            await refreshMemory()
        } catch { errorMessage = error.localizedDescription }
    }

    func refreshMemory() async {
        guard let token else { return }
        do { memory = try await api.memory(token: token) }
        catch { errorMessage = error.localizedDescription }
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
        connectionState = .disconnected
    }
}

