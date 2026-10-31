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
    @Published var isScanning = false
    @Published var isAnalyzing = false
    @Published var errorMessage: String?

    private let api = APIClient.shared
    private var token: String?
    private var pairingTask: Task<Void, Never>?

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
        while !Task.isCancelled, ISO8601DateFormatter().date(from: request.expiresAt) ?? .distantPast > Date() {
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
            try? await Task.sleep(for: .seconds(2))
        }
        pairing = nil
        connectionState = .disconnected
        errorMessage = "The pairing code expired. Generate a new one and try again."
    }

    func refreshAll() async {
        await refreshScanner()
        await refreshMemory()
    }

    func refreshScanner() async {
        guard let token else { return }
        isScanning = true
        defer { isScanning = false }
        do {
            discovery = try await api.discover(token: token)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func analyze(symbol: String) async {
        guard let token else { return }
        isAnalyzing = true
        analysis = nil
        defer { isAnalyzing = false }
        do {
            analysis = try await api.analyze(symbol: symbol, token: token)
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
        if let token { try? await api.revoke(token: token) }
        KeychainStore.delete()
        token = nil
        discovery = nil
        analysis = nil
        memory = nil
        connectionState = .disconnected
    }
}

