import SwiftUI
import Combine
import GRDB
import os
#if canImport(UIKit)
import WebKit
#endif

/// Global app state observable by all views.
/// Owns the core managers (database, crypto, sync) and exposes them to the view hierarchy.
///
/// Lifecycle:
///   1. QR pairing stores encryption seed + server URL in Keychain -> `isPaired = true`
///   2. Stytch OAuth stores JWT + user ID in Keychain -> `isAuthenticated = true`
///   3. When both paired AND authenticated, managers initialize using:
///      - Encryption seed (from QR) + Stytch user ID (from JWT) for key derivation
///      - Stytch user ID for WebSocket room routing
///   4. SyncManager connects and begins syncing
@MainActor
public final class AppState: ObservableObject {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "AppState")
    @Published public var isPaired: Bool = false
    @Published public var isConnected: Bool = false

    /// When true, views should show demo connection indicators (green desktop dot).
    public var screenshotMode: Bool = false

    /// The database manager. Available after both pairing and authentication.
    /// Views use this to set up GRDB ValueObservation for reactive updates.
    @Published public private(set) var databaseManager: DatabaseManager?

    /// Auth manager for Stytch OAuth.
    public let authManager = AuthManager()

    /// Voice mode agent. One instance shared across the app (iOS only).
    #if os(iOS)
    @Published public private(set) var voiceAgent: VoiceAgent?
    #endif

    private var cryptoManager: CryptoManager?
    public private(set) var syncManager: SyncManager?
    private var cancellables = Set<AnyCancellable>()
    private var jwtRefreshTimer: Timer?

    public init() {
        // Initialize analytics early so events can be captured throughout the lifecycle
        AnalyticsManager.shared.initialize()

        // Check if we have stored credentials (pairing state)
        isPaired = KeychainManager.hasEncryptionKey()

        // If both paired and authenticated from a previous session, set up and connect immediately
        if isPaired && authManager.isAuthenticated {
            setupManagers()
            connectIfReady()

            // Pre-warm a WKWebView so transcript loading is instant when the user
            // opens a session. Only worth doing when paired+authenticated (user can
            // navigate to sessions). Warming up at launch when unpaired causes the
            // WebContent process to hang and block gesture recognition on iPad.
            #if canImport(UIKit)
            TranscriptWebViewPool.shared.warmup()
            #endif
        }

        // Auto-connect when auth state changes
        observeAuth()
    }

    /// Initialize with pre-built managers (for testing and previews).
    public init(databaseManager: DatabaseManager) {
        self.databaseManager = databaseManager
        self.isPaired = true
        observeAuth()
    }

    /// Store pairing credentials from QR code.
    /// The QR code provides the encryption seed and server URL.
    /// The userId parameter is informational only (e.g., syncEmail from QR) -- the actual
    /// user ID for crypto and routing comes from Stytch auth.
    public func pair(with seed: String, serverUrl: String, userId: String, analyticsId: String? = nil) throws {
        try KeychainManager.storeEncryptionKey(seed: seed)
        try KeychainManager.storeServerUrl(serverUrl)
        // Store the QR userId as a fallback identifier (not used for crypto or routing)
        try KeychainManager.storeUserId(userId)
        isPaired = true

        // Link mobile analytics to desktop's PostHog identity
        AnalyticsManager.shared.setDistinctIdFromPairing(analyticsId)
        AnalyticsManager.shared.capture("mobile_pairing_completed")
        // If already authenticated (re-pairing scenario), set up managers and connect.
        // On fresh install this won't fire -- the auth observer handles post-login setup.
        if authManager.isAuthenticated {
            setupManagers()
            connectIfReady()
            #if canImport(UIKit)
            TranscriptWebViewPool.shared.warmup()
            #endif
        }
    }

    public func unpair() {
        AnalyticsManager.shared.capture("mobile_device_unpairing")
        AnalyticsManager.shared.reset()

        jwtRefreshTimer?.invalidate()
        jwtRefreshTimer = nil
        #if os(iOS)
        voiceAgent?.deactivate()
        voiceAgent = nil
        #endif
        syncManager?.disconnect()
        KeychainManager.deleteAll()
        authManager.logout()
        cryptoManager = nil
        databaseManager = nil
        syncManager = nil
        isPaired = false
        isConnected = false
    }

    /// Request a full index sync from the server.
    public func requestSync() {
        syncManager?.requestFullSync()
    }

    // MARK: - Auth Observation

    private func observeAuth() {
        // Forward authManager changes to AppState so SwiftUI re-renders ContentView.
        // SwiftUI doesn't observe nested ObservableObject properties automatically.
        authManager.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        authManager.$isAuthenticated
            .dropFirst()
            .sink { [weak self] authenticated in
                guard let self else { return }
                self.logger.info("isAuthenticated changed to \(authenticated)")
                if authenticated {
                    AnalyticsManager.shared.capture("mobile_login_completed")
                    self.setupManagersIfNeeded()
                    self.connectIfReady()
                    #if canImport(UIKit)
                    if !TranscriptWebViewPool.shared.hasWarmWebView {
                        TranscriptWebViewPool.shared.warmup()
                    }
                    #endif
                }
            }
            .store(in: &cancellables)
    }

    /// Set up managers if they haven't been initialized yet.
    private func setupManagersIfNeeded() {
        guard databaseManager == nil else {
            logger.debug("setupManagersIfNeeded: managers already initialized, skipping")
            return
        }
        setupManagers()
    }

    /// Connect to the sync server if both paired and authenticated.
    /// If the JWT is near expiration, refreshes it first before connecting.
    private func connectIfReady() {
        guard isPaired else {
            logger.debug("connectIfReady: not paired")
            return
        }
        guard authManager.isAuthenticated else {
            logger.debug("connectIfReady: not authenticated")
            return
        }
        guard let jwt = authManager.sessionJwt else {
            logger.warning("connectIfReady: no JWT")
            return
        }
        guard let authUserId = authManager.authUserId else {
            logger.warning("connectIfReady: no authUserId")
            return
        }
        guard let sync = syncManager else {
            logger.warning("connectIfReady: no syncManager")
            return
        }

        // Check if the JWT is expired or about to expire (within 60s).
        // Stytch JWTs have a 5-minute lifetime, and the auth callback JWT
        // may already be stale by the time pairing + auth completes.
        if isJWTExpiringSoon(jwt) {
            logger.info("connectIfReady: JWT expiring soon, refreshing first")
            Task {
                await refreshJWT()
            }
            return
        }

        logger.info("Connecting to sync server")
        sync.connect(authToken: jwt, authUserId: authUserId)
        startJWTRefreshTimer()
    }

    /// Check if a JWT's exp claim is within `margin` seconds of now.
    private func isJWTExpiringSoon(_ jwt: String, margin: TimeInterval = 60) -> Bool {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return true }

        // Decode the payload (base64url -> base64 -> Data -> JSON)
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = base64.count % 4
        if pad > 0 { base64 += String(repeating: "=", count: 4 - pad) }

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? Double else {
            return true // Can't parse, treat as expired
        }

        return Date(timeIntervalSince1970: exp).timeIntervalSinceNow < margin
    }

    // MARK: - JWT Refresh

    /// Stytch JWTs expire after ~5 minutes. Refresh every 4 minutes to stay connected.
    private func startJWTRefreshTimer() {
        jwtRefreshTimer?.invalidate()
        jwtRefreshTimer = Timer.scheduledTimer(withTimeInterval: 4 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshJWT()
            }
        }
    }

    private func refreshJWT() async {
        guard let serverUrl = KeychainManager.getServerUrl() else { return }
        let success = await authManager.refreshSession(serverUrl: serverUrl)
        if success {
            // Reconnect with fresh JWT
            connectIfReady()
        }
    }

    private func setupManagers() {
        guard let seed = KeychainManager.getEncryptionKey() else {
            logger.warning("setupManagers: no encryption key in Keychain")
            return
        }

        // Use the Stytch user ID for key derivation (must match desktop's salt).
        // The desktop derives: PBKDF2(seed, "nimbalyst:<stytchUserId>")
        // Require the Stytch authUserId -- the QR userId (email) uses a different salt
        // and would derive a wrong key, causing silent decryption failures.
        guard let userId = authManager.authUserId else {
            logger.debug("setupManagers: no Stytch authUserId yet, deferring until auth completes")
            return
        }
        logger.info("Initializing managers")

        // Set email on analytics profile if available from Stytch auth
        if let email = KeychainManager.getAuthEmail() {
            AnalyticsManager.shared.setEmail(email)
        }

        // Initialize CryptoManager with the correct userId for key derivation
        cryptoManager = CryptoManager(seed: seed, userId: userId)

        // Initialize DatabaseManager
        do {
            databaseManager = try DatabaseManager(path: DatabaseManager.defaultPath)
        } catch {
            logger.error("Failed to initialize DatabaseManager: \(error.localizedDescription)")
            return
        }

        // Initialize SyncManager
        guard let crypto = cryptoManager,
              let database = databaseManager,
              let serverUrl = KeychainManager.getServerUrl() else { return }

        let sync = SyncManager(crypto: crypto, database: database, serverUrl: serverUrl, userId: userId)
        syncManager = sync

        // Observe sync connection state
        sync.$isConnected
            .receive(on: DispatchQueue.main)
            .assign(to: &$isConnected)

        #if os(iOS)
        // Initialize voice agent
        let voice = VoiceAgent()
        voiceAgent = voice

        // Wire session completion notifications from SyncManager to VoiceAgent
        sync.onSessionCompleted = { [weak voice] sessionId, summary in
            Task { @MainActor in
                voice?.onSessionCompleted(sessionId: sessionId, summary: summary)
            }
        }

        // Wire settings sync to update VoiceAgent when settings arrive from desktop
        sync.onSettingsSynced = { [weak voice] _ in
            Task { @MainActor in
                voice?.settings = VoiceModeSettings.load()
            }
        }

        // Forward VoiceAgent state changes to trigger SwiftUI re-renders
        voice.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
        #endif
    }

    /// Configure the voice agent with a specific project context.
    /// Called when the user navigates to a project's session list.
    public func configureVoiceAgent(forProject projectId: String) {
        #if os(iOS)
        guard let voice = voiceAgent,
              let database = databaseManager,
              let sync = syncManager else { return }
        voice.configure(database: database, syncManager: sync, projectId: projectId)
        #endif
    }

    // MARK: - Screenshot Mode

    #if DEBUG
    /// Create an AppState configured for screenshot capture.
    /// Uses an in-memory database with realistic demo data, bypasses auth/pairing.
    public static func forScreenshots() -> AppState {
        let db = try! ScreenshotDataProvider.createPopulatedDatabase()
        let state = AppState(databaseManager: db)
        state.authManager.isAuthenticated = true
        state.isConnected = true
        state.screenshotMode = true
        return state
    }
    #endif
}
