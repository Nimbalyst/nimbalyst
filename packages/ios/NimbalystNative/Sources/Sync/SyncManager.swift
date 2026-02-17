import Foundation
import Combine
import os

/// Manages synchronization between the native app and the desktop via WebSocket.
/// Handles index room sync (projects + sessions) and session room sync (messages).
///
/// Architecture:
///   - Connects to the index room: `user:<userId>:index`
///   - Receives encrypted sessions and projects from the server
///   - Decrypts using CryptoManager and stores in SQLite via DatabaseManager
///   - SwiftUI views observe the database for reactive updates
@MainActor
public final class SyncManager: ObservableObject {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "SyncManager")

    private let crypto: CryptoManager
    private let database: DatabaseManager
    private let indexClient: WebSocketClient = {
        let client = WebSocketClient()
        client.sendsDeviceAnnounce = true
        return client
    }()
    private let sessionClient = WebSocketClient()
    private let decoder = JSONDecoder()

    @Published public var isConnected = false
    @Published public var connectedDevices: [DeviceInfo] = []

    /// The session ID currently connected to the session room, if any.
    @Published public var activeSessionId: String?

    /// Called when a session transitions from executing to idle (isExecuting: true -> false).
    /// Parameters: (sessionId, lastAssistantMessageSummary)
    public var onSessionCompleted: ((String, String) -> Void)?

    /// Called when settings are synced from the desktop (e.g., OpenAI API key, voice mode config).
    public var onSettingsSynced: ((SyncedSettings) -> Void)?

    /// Called with diagnostic info when session message sync completes (success or failure).
    /// Parameters: (sessionId, diagnostic)
    public var onSessionSyncDiagnostic: ((String, SessionSyncDiagnostic) -> Void)?

    private var serverUrl: String
    private var userId: String
    /// The Stytch user ID for room routing (from JWT sub claim). May differ from pairing userId.
    private var authUserId: String?
    private var authToken: String?

    /// Buffer for paginated sync responses before committing to DB.
    private var sessionSyncBuffer: [ServerMessageEntry] = []

    public init(crypto: CryptoManager, database: DatabaseManager, serverUrl: String, userId: String) {
        self.crypto = crypto
        self.database = database
        self.serverUrl = serverUrl
        self.userId = userId

        setupIndexClient()
        setupSessionClient()
        setupPushTokenForwarding()
    }

    // MARK: - Connection

    /// Connect to the index room and begin syncing.
    /// The `authUserId` is the Stytch user ID from the JWT's `sub` claim, used for room ID construction.
    /// This may differ from the pairing `userId` (which can be an email or analytics ID).
    public func connect(authToken: String, authUserId: String? = nil) {
        self.authToken = authToken
        self.authUserId = authUserId
        // Use the auth user ID for room routing (must match JWT), fall back to pairing userId
        let roomId = "user:\(effectiveUserId):index"
        indexClient.connect(serverUrl: serverUrl, roomId: roomId, authToken: authToken)
    }

    /// The user ID to use for room routing. Prefers authUserId (from JWT) over pairing userId.
    private var effectiveUserId: String {
        authUserId ?? userId
    }

    /// Disconnect from all rooms.
    public func disconnect() {
        leaveSessionRoom()
        indexClient.disconnect()
    }

    // MARK: - Session Room

    /// Join a session room to sync messages.
    public func joinSessionRoom(sessionId: String) {
        guard let authToken = authToken else {
            logger.warning("Cannot join session room: not authenticated")
            return
        }

        // Leave current session room if any
        if activeSessionId != nil {
            leaveSessionRoom()
        }

        activeSessionId = sessionId
        sessionSyncBuffer = []

        let roomId = "user:\(effectiveUserId):session:\(sessionId)"
        sessionClient.connect(serverUrl: serverUrl, roomId: roomId, authToken: authToken)
    }

    /// Leave the current session room.
    public func leaveSessionRoom() {
        sessionClient.disconnect()
        activeSessionId = nil
        sessionSyncBuffer = []
    }

    // MARK: - Index Client Setup

    private func setupIndexClient() {
        indexClient.onConnectionStateChanged = { [weak self] connected in
            Task { @MainActor in
                self?.isConnected = connected
                if connected {
                    self?.requestIndexSync()
                    // Re-register push token on reconnect
                    if let token = NotificationManager.shared.deviceToken {
                        self?.registerPushToken(token)
                    }
                }
            }
        }

        indexClient.onMessage = { [weak self] data in
            Task { @MainActor in
                self?.handleIndexMessage(data)
            }
        }
    }

    /// Request a full index sync. Called by AppState on pull-to-refresh.
    public func requestFullSync() {
        requestIndexSync()
    }

    /// Request the full index (projects + sessions) from the server.
    private func requestIndexSync() {
        let request = IndexSyncRequest(projectId: nil)
        if let data = try? JSONEncoder().encode(request),
           let json = String(data: data, encoding: .utf8) {
            indexClient.sendRaw(json)
        }
    }

    // MARK: - Message Handling

    private func handleIndexMessage(_ data: Data) {
        // First, determine the message type
        guard let envelope = try? decoder.decode(ServerMessage.self, from: data) else {
            logger.warning("Could not decode message type")
            return
        }

        switch envelope.type {
        case "indexSyncResponse":
            handleIndexSyncResponse(data)
        case "indexBroadcast":
            handleIndexBroadcast(data)
        case "indexDeleteBroadcast":
            handleIndexDeleteBroadcast(data)
        case "projectBroadcast":
            handleProjectBroadcast(data)
        case "createSessionResponseBroadcast":
            handleCreateSessionResponse(data)
        case "devicesList":
            handleDevicesList(data)
        case "deviceJoined":
            handleDeviceJoined(data)
        case "deviceLeft":
            handleDeviceLeft(data)
        case "settingsSyncBroadcast":
            handleSettingsSyncBroadcast(data)
        case "error":
            handleServerError(data)
        default:
            logger.info("Unhandled message type: \(envelope.type)")
        }
    }

    // MARK: - Index Sync Response

    private func handleIndexSyncResponse(_ data: Data) {
        guard let response = try? decoder.decode(IndexSyncResponse.self, from: data) else {
            logger.error("Failed to decode index_sync_response")
            return
        }

        if let total = response.totalSessionCount, total != response.sessions.count {
            logger.warning("INDEX TRUNCATION DETECTED! Server COUNT(*)=\(total) but received \(response.sessions.count) sessions")
        }
        logger.info("Index sync received: \(response.sessions.count) sessions, \(response.projects.count) projects (server total: \(response.totalSessionCount.map(String.init) ?? "unknown"))")

        // Process projects
        for serverProject in response.projects {
            processServerProject(serverProject)
        }

        // Process sessions - track success/failure counts
        var processedCount = 0
        var failedDecryptCount = 0
        for serverSession in response.sessions {
            if processServerSessionWithResult(serverSession) {
                processedCount += 1
            } else {
                failedDecryptCount += 1
            }
        }
        if failedDecryptCount > 0 {
            logger.warning("Session processing: \(processedCount) succeeded, \(failedDecryptCount) failed to decrypt")
        }

        // Recalculate project stats from session data (more reliable than server-side stats)
        do {
            try database.refreshAllProjectStats()
        } catch {
            logger.error("Failed to refresh project stats: \(error.localizedDescription)")
        }

        // Update sync state watermark
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let syncState = SyncState(roomId: "index", lastCursor: nil, lastSequence: 0, lastSyncedAt: now)
        try? database.updateSyncState(syncState)
    }

    // MARK: - Process Server Entries

    private func processServerProject(_ entry: ServerProjectEntry) {
        // Decrypt project ID (uses fixed IV for deterministic matching)
        guard let projectId = crypto.decryptOrNil(
            encryptedBase64: entry.encryptedProjectId,
            ivBase64: entry.projectIdIv
        ) else {
            logger.warning("Failed to decrypt project ID")
            return
        }

        // Always use last path component as project name.
        // The server stores encrypted_project_id as the name placeholder,
        // so decrypting it gives the full workspace path (not a human-friendly name).
        let name = (projectId as NSString).lastPathComponent

        let project = Project(
            id: projectId,
            name: name,
            sessionCount: entry.sessionCount ?? 0,
            lastUpdatedAt: entry.lastActivityAt
        )

        do {
            try database.upsertProject(project)
        } catch {
            logger.error("Failed to upsert project: \(error.localizedDescription)")
        }
    }

    private func processServerSession(_ entry: ServerSessionEntry) {
        _ = processServerSessionWithResult(entry)
    }

    /// Process a server session entry, returning true on success, false on decrypt failure.
    @discardableResult
    private func processServerSessionWithResult(_ entry: ServerSessionEntry) -> Bool {
        // Decrypt project ID to find the parent project
        guard let projectId = crypto.decryptOrNil(
            encryptedBase64: entry.encryptedProjectId,
            ivBase64: entry.projectIdIv
        ) else {
            logger.warning("Failed to decrypt project ID for session \(entry.sessionId)")
            return false
        }

        // Ensure the project exists (don't overwrite if it already has data from processServerProject)
        if (try? database.writer.read({ db in try Project.fetchOne(db, id: projectId) })) == nil {
            let projectName = (projectId as NSString).lastPathComponent
            let project = Project(id: projectId, name: projectName, lastUpdatedAt: entry.updatedAt)
            try? database.upsertProject(project)
        }

        // Decrypt session title
        let titleDecrypted = crypto.decryptOrNil(
            encryptedBase64: entry.encryptedTitle,
            ivBase64: entry.titleIv
        )

        // Preserve local isExecuting/lastReadAt when the server entry doesn't include them
        let existing = try? database.session(byId: entry.sessionId)

        // Decrypt client metadata (context usage, etc.)
        var clientMeta: ClientMetadata?
        if let encryptedMeta = entry.encryptedClientMetadata,
           let metaIv = entry.clientMetadataIv,
           let metaJson = crypto.decryptOrNil(encryptedBase64: encryptedMeta, ivBase64: metaIv),
           let metaData = metaJson.data(using: .utf8) {
            clientMeta = try? JSONDecoder().decode(ClientMetadata.self, from: metaData)
        }

        let session = Session(
            id: entry.sessionId,
            projectId: projectId,
            titleEncrypted: entry.encryptedTitle,
            titleIv: entry.titleIv,
            titleDecrypted: titleDecrypted,
            provider: entry.provider,
            model: entry.model,
            mode: entry.mode,
            isExecuting: entry.isExecuting ?? existing?.isExecuting ?? false,
            hasQueuedPrompts: entry.hasPendingPrompt ?? false,
            contextTokens: clientMeta?.currentContext?.tokens ?? existing?.contextTokens,
            contextWindow: clientMeta?.currentContext?.contextWindow ?? existing?.contextWindow,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastReadAt: entry.lastReadAt ?? existing?.lastReadAt,
            lastMessageAt: entry.lastMessageAt ?? existing?.lastMessageAt
        )

        do {
            try database.upsertSession(session)
            // Update the project's lastUpdatedAt if this session is more recent
            try database.updateProjectLastActivity(projectId: projectId, activityAt: entry.updatedAt)
            return true
        } catch {
            logger.error("Failed to upsert session: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Real-time Broadcasts

    private func handleIndexBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(IndexBroadcast.self, from: data) else {
            logger.error("Failed to decode index_broadcast")
            return
        }
        processServerSession(broadcast.session)
    }

    private func handleIndexDeleteBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(IndexDeleteBroadcast.self, from: data) else {
            logger.error("Failed to decode index_delete_broadcast")
            return
        }
        logger.info("Session deleted: \(broadcast.sessionId)")

        do {
            // Look up project before deleting so we can refresh count
            let projectId = try database.session(byId: broadcast.sessionId)?.projectId
            try database.deleteSession(broadcast.sessionId)
            if let projectId {
                try database.refreshSessionCount(forProject: projectId)
            }
        } catch {
            logger.error("Failed to delete session: \(error.localizedDescription)")
        }
    }

    private func handleProjectBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(ProjectBroadcast.self, from: data) else {
            logger.error("Failed to decode project_broadcast")
            return
        }
        processServerProject(broadcast.project)
    }

    private func handleCreateSessionResponse(_ data: Data) {
        guard let broadcast = try? decoder.decode(CreateSessionResponseBroadcast.self, from: data) else {
            logger.error("Failed to decode create_session_response_broadcast")
            return
        }
        if broadcast.response.success {
            logger.info("Session created: \(broadcast.response.sessionId ?? "unknown")")
        } else {
            logger.error("Session creation failed: \(broadcast.response.error ?? "unknown error")")
        }
        // TODO: Notify UI of create session result
    }

    // MARK: - Device Presence

    private func handleDevicesList(_ data: Data) {
        struct DevicesListMessage: Codable {
            let devices: [DeviceInfo]
        }
        guard let msg = try? decoder.decode(DevicesListMessage.self, from: data) else { return }
        connectedDevices = msg.devices
    }

    private func handleDeviceJoined(_ data: Data) {
        struct DeviceJoinedMessage: Codable {
            let device: DeviceInfo
        }
        guard let msg = try? decoder.decode(DeviceJoinedMessage.self, from: data) else { return }
        if !connectedDevices.contains(where: { $0.deviceId == msg.device.deviceId }) {
            connectedDevices.append(msg.device)
        }
    }

    private func handleDeviceLeft(_ data: Data) {
        struct DeviceLeftMessage: Codable {
            let deviceId: String
        }
        guard let msg = try? decoder.decode(DeviceLeftMessage.self, from: data) else { return }
        connectedDevices.removeAll { $0.deviceId == msg.deviceId }
    }

    // MARK: - Settings Sync

    private func handleSettingsSyncBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(SettingsSyncBroadcast.self, from: data) else {
            logger.error("Failed to decode settingsSyncBroadcast")
            return
        }

        let payload = broadcast.settings
        logger.info("Received settings sync from device: \(payload.deviceId), version: \(payload.version)")

        // Decrypt the settings JSON using the shared encryption key
        guard let settingsJson = crypto.decryptOrNil(
            encryptedBase64: payload.encryptedSettings,
            ivBase64: payload.settingsIv
        ) else {
            logger.error("Failed to decrypt synced settings")
            return
        }

        guard let settingsData = settingsJson.data(using: .utf8),
              let settings = try? JSONDecoder().decode(SyncedSettings.self, from: settingsData) else {
            logger.error("Failed to parse decrypted settings JSON")
            return
        }

        logger.info("Decrypted settings: version=\(settings.version), hasOpenAIKey=\(settings.openaiApiKey != nil)")

        // Store the OpenAI API key in the Keychain
        if let apiKey = settings.openaiApiKey, !apiKey.isEmpty {
            try? KeychainManager.storeOpenAIApiKey(apiKey)
            logger.info("Stored OpenAI API key from desktop sync")
            NotificationCenter.default.post(name: .init("OpenAIApiKeySynced"), object: nil)
        }

        #if os(iOS)
        // Store voice mode settings if present
        if let voiceMode = settings.voiceMode {
            var currentSettings = VoiceModeSettings.load()
            if let voice = voiceMode.voice {
                currentSettings.voice = voice
            }
            if let delay = voiceMode.submitDelayMs {
                currentSettings.promptConfirmationDelay = TimeInterval(delay) / 1000.0
            }
            currentSettings.save()
        }
        #endif

        onSettingsSynced?(settings)
    }

    // MARK: - Error Handling

    private func handleServerError(_ data: Data) {
        guard let error = try? decoder.decode(ServerError.self, from: data) else { return }
        logger.error("Server error [\(error.code)]: \(error.message)")
    }

    // MARK: - Session Client Setup

    private func setupSessionClient() {
        sessionClient.onConnectionStateChanged = { [weak self] connected in
            Task { @MainActor in
                if connected {
                    self?.requestSessionSync()
                }
            }
        }

        sessionClient.onMessage = { [weak self] data in
            Task { @MainActor in
                self?.handleSessionMessage(data)
            }
        }
    }

    private func requestSessionSync() {
        guard let sessionId = activeSessionId else { return }

        // Check if we have a sync watermark for this session
        let sinceSeq: Int?
        if let state = try? database.syncState(forRoom: sessionId) {
            sinceSeq = state.lastSequence > 0 ? state.lastSequence : nil
        } else {
            sinceSeq = nil
        }

        let request = SessionSyncRequest(sinceSeq: sinceSeq)
        if let data = try? JSONEncoder().encode(request),
           let json = String(data: data, encoding: .utf8) {
            sessionClient.sendRaw(json)
        }
    }

    private func handleSessionMessage(_ data: Data) {
        guard let envelope = try? decoder.decode(ServerMessage.self, from: data) else {
            let rawPreview = String(data: data.prefix(200), encoding: .utf8) ?? "<binary>"
            logger.warning("Could not decode session message type — raw: \(rawPreview)")
            return
        }

        switch envelope.type {
        case "syncResponse":
            handleSessionSyncResponse(data)
        case "messageBroadcast":
            handleMessageBroadcast(data)
        case "metadataBroadcast":
            handleMetadataBroadcast(data)
        case "error":
            handleServerError(data)
        default:
            logger.info("Unhandled session message type: \(envelope.type)")
        }
    }

    // MARK: - Session Sync Response

    private func handleSessionSyncResponse(_ data: Data) {
        let response: SessionSyncResponse
        do {
            response = try decoder.decode(SessionSyncResponse.self, from: data)
        } catch {
            let rawPreview = String(data: data.prefix(500), encoding: .utf8) ?? "<binary>"
            logger.error("Failed to decode session syncResponse: \(error.localizedDescription) — raw: \(rawPreview)")
            if let sessionId = activeSessionId {
                onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                    totalServerMessages: 0, decryptedCount: 0, storedCount: 0,
                    failedMessageIds: [], failedSequences: [],
                    error: "Sync response decode failed: \(error.localizedDescription)"
                ))
            }
            return
        }

        // Buffer messages for batch insert
        sessionSyncBuffer.append(contentsOf: response.messages)

        if response.hasMore, let cursor = response.cursor {
            // Request next page
            let sinceSeq = Int(cursor)
            let request = SessionSyncRequest(sinceSeq: sinceSeq)
            if let data = try? JSONEncoder().encode(request),
               let json = String(data: data, encoding: .utf8) {
                sessionClient.sendRaw(json)
            }
        } else {
            // All pages received - decrypt and store
            commitSessionMessages()
        }
    }

    private func commitSessionMessages() {
        guard let sessionId = activeSessionId else { return }

        let totalCount = sessionSyncBuffer.count
        var failedIds: [String] = []
        var failedSeqs: [Int] = []

        let messages = sessionSyncBuffer.compactMap { entry -> Message? in
            let msg = decryptServerMessage(entry, sessionId: sessionId)
            if msg == nil {
                failedIds.append(entry.id)
                failedSeqs.append(entry.sequence)
            }
            return msg
        }

        sessionSyncBuffer = []

        // Log decryption results
        if !failedIds.isEmpty {
            logger.error("Decryption failed for \(failedIds.count)/\(totalCount) messages in session \(sessionId). Failed sequences: \(failedSeqs.prefix(10))")
        }

        do {
            try database.appendMessages(messages)

            // Update sync watermark to max sequence
            if let maxSeq = messages.map(\.sequence).max() {
                let now = Int(Date().timeIntervalSince1970 * 1000)
                let syncState = SyncState(
                    roomId: sessionId,
                    lastCursor: nil,
                    lastSequence: maxSeq,
                    lastSyncedAt: now
                )
                try database.updateSyncState(syncState)
            }

            logger.info("Stored \(messages.count)/\(totalCount) messages for session \(sessionId)")

            // Report diagnostics
            if messages.isEmpty && totalCount > 0 {
                logger.error("All \(totalCount) messages failed decryption for session \(sessionId)")
                onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                    totalServerMessages: totalCount, decryptedCount: 0, storedCount: 0,
                    failedMessageIds: failedIds, failedSequences: failedSeqs,
                    error: "All \(totalCount) messages failed decryption"
                ))
            } else if messages.isEmpty && totalCount == 0 {
                logger.info("Session sync returned 0 messages for session \(sessionId) — transcript may not exist on server")
                onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                    totalServerMessages: 0, decryptedCount: 0, storedCount: 0,
                    failedMessageIds: [], failedSequences: [],
                    error: nil
                ))
            } else if !failedIds.isEmpty {
                onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                    totalServerMessages: totalCount, decryptedCount: messages.count,
                    storedCount: messages.count,
                    failedMessageIds: failedIds, failedSequences: failedSeqs,
                    error: "\(failedIds.count) of \(totalCount) messages failed decryption"
                ))
            } else {
                onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                    totalServerMessages: totalCount, decryptedCount: messages.count,
                    storedCount: messages.count,
                    failedMessageIds: [], failedSequences: [],
                    error: nil
                ))
            }
        } catch {
            logger.error("Failed to store session messages: \(error.localizedDescription)")
            onSessionSyncDiagnostic?(sessionId, SessionSyncDiagnostic(
                totalServerMessages: totalCount, decryptedCount: messages.count, storedCount: 0,
                failedMessageIds: failedIds, failedSequences: failedSeqs,
                error: "Database write failed: \(error.localizedDescription)"
            ))
        }
    }

    // MARK: - Real-time Session Messages

    private func handleMessageBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(MessageBroadcast.self, from: data),
              let sessionId = activeSessionId else {
            let rawPreview = String(data: data.prefix(200), encoding: .utf8) ?? "<binary>"
            logger.error("Failed to decode messageBroadcast — raw: \(rawPreview)")
            return
        }

        guard let message = decryptServerMessage(broadcast.message, sessionId: sessionId) else {
            // decryptServerMessage already logs the specific error
            return
        }

        do {
            try database.appendMessage(message)

            // Update sync watermark
            let now = Int(Date().timeIntervalSince1970 * 1000)
            let syncState = SyncState(
                roomId: sessionId,
                lastCursor: nil,
                lastSequence: message.sequence,
                lastSyncedAt: now
            )
            try database.updateSyncState(syncState)
        } catch {
            logger.error("Failed to store broadcast message: \(error.localizedDescription)")
        }
    }

    private func handleMetadataBroadcast(_ data: Data) {
        guard let broadcast = try? decoder.decode(MetadataBroadcast.self, from: data),
              let sessionId = activeSessionId else {
            return
        }

        // Update session metadata in the database
        do {
            if var session = try database.session(byId: sessionId) {
                let wasExecuting = session.isExecuting

                if let isExecuting = broadcast.metadata.isExecuting {
                    session.isExecuting = isExecuting
                }
                if let provider = broadcast.metadata.provider {
                    session.provider = provider
                }
                if let model = broadcast.metadata.model {
                    session.model = model
                }
                if let mode = broadcast.metadata.mode {
                    session.mode = mode
                }
                // Decrypt client metadata (context usage, etc.)
                if let encryptedMeta = broadcast.metadata.encryptedClientMetadata,
                   let metaIv = broadcast.metadata.clientMetadataIv,
                   let metaJson = crypto.decryptOrNil(encryptedBase64: encryptedMeta, ivBase64: metaIv),
                   let metaData = metaJson.data(using: .utf8),
                   let clientMeta = try? JSONDecoder().decode(ClientMetadata.self, from: metaData) {
                    if let ctx = clientMeta.currentContext {
                        session.contextTokens = ctx.tokens
                        session.contextWindow = ctx.contextWindow
                    }
                }
                if let updatedAt = broadcast.metadata.updatedAt {
                    session.updatedAt = updatedAt
                }
                try database.upsertSession(session)

                // Detect execution completion (isExecuting: true -> false)
                if wasExecuting && !session.isExecuting {
                    let messages = try database.messages(forSession: sessionId)
                    let lastAssistant = messages.last { $0.source == "assistant" }
                    let summary = String((lastAssistant?.contentDecrypted ?? "Task completed").prefix(200))
                    onSessionCompleted?(sessionId, summary)
                }
            }
        } catch {
            logger.error("Failed to update session metadata: \(error.localizedDescription)")
        }
    }

    // MARK: - Message Decryption

    private func decryptServerMessage(_ entry: ServerMessageEntry, sessionId: String) -> Message? {
        let decrypted: String?
        do {
            decrypted = try crypto.decrypt(encryptedBase64: entry.encryptedContent, ivBase64: entry.iv)
        } catch {
            logger.error("Failed to decrypt message \(entry.id) seq=\(entry.sequence) in session \(sessionId): \(error.localizedDescription). encryptedContent length=\(entry.encryptedContent.count), iv length=\(entry.iv.count)")
            return nil
        }

        return Message(
            id: entry.id,
            sessionId: sessionId,
            sequence: entry.sequence,
            source: entry.source,
            direction: entry.direction,
            encryptedContent: entry.encryptedContent,
            iv: entry.iv,
            contentDecrypted: decrypted,
            metadataJson: nil,
            createdAt: entry.createdAt
        )
    }

    // MARK: - Send Prompt

    /// Send a prompt to the current session via the queued prompts system.
    /// Desktop picks up prompts from index_update broadcasts (not session room messages).
    public func sendPrompt(sessionId: String, text: String) throws {
        guard let session = try database.session(byId: sessionId) else {
            throw SyncError.sessionNotFound
        }

        let now = Int(Date().timeIntervalSince1970 * 1000)
        let promptId = UUID().uuidString

        // Encrypt the prompt text
        let encryptedPrompt = try crypto.encrypt(plaintext: text)

        let queuedPrompt = EncryptedQueuedPrompt(
            id: promptId,
            encryptedPrompt: encryptedPrompt.encrypted,
            iv: encryptedPrompt.iv,
            timestamp: now,
            source: "keyboard"
        )

        // Build the encrypted project ID for the index entry
        let encryptedProjectId = try crypto.encryptProjectId(session.projectId)

        // Send index_update with queued prompt via the index room
        let indexEntry = IndexUpdateEntry(
            sessionId: sessionId,
            encryptedProjectId: encryptedProjectId,
            projectIdIv: CryptoManager.projectIdIvBase64,
            encryptedTitle: session.titleEncrypted,
            titleIv: session.titleIv,
            provider: session.provider ?? "claude-code",
            model: session.model,
            mode: session.mode,
            messageCount: (try? database.messages(forSession: sessionId).count) ?? 0,
            lastMessageAt: now,
            createdAt: session.createdAt,
            updatedAt: now,
            isExecuting: session.isExecuting,
            queuedPromptCount: 1,
            encryptedQueuedPrompts: [queuedPrompt]
        )

        let indexMessage = IndexUpdateMessage(session: indexEntry)
        if let data = try? JSONEncoder().encode(indexMessage),
           let json = String(data: data, encoding: .utf8) {
            indexClient.sendRaw(json)
        }

        // Store the prompt locally for immediate display in transcript
        let localSeq = try database.nextSequence(forSession: sessionId)
        let localMessage = Message(
            id: promptId,
            sessionId: sessionId,
            sequence: localSeq,
            source: "user",
            direction: "input",
            encryptedContent: encryptedPrompt.encrypted,
            iv: encryptedPrompt.iv,
            contentDecrypted: text,
            createdAt: now
        )
        try database.appendMessage(localMessage)
    }

    // MARK: - Interactive Prompt Responses

    /// Send a session_control message to the desktop via the index room.
    /// Used for interactive prompt responses (AskUserQuestion, ToolPermission, ExitPlanMode, GitCommit).
    public func sendSessionControlMessage(sessionId: String, messageType: String, payload: [String: Any]? = nil) {
        let controlPayload = SessionControlPayload(
            sessionId: sessionId,
            messageType: messageType,
            payload: payload.map { dict in
                dict.mapValues { AnyCodable($0) }
            },
            timestamp: Int(Date().timeIntervalSince1970 * 1000),
            sentBy: "mobile"
        )

        let message = SessionControlMessage(message: controlPayload)
        if let data = try? JSONEncoder().encode(message),
           let json = String(data: data, encoding: .utf8) {
            indexClient.sendRaw(json)
            logger.info("Sent session_control: \(messageType) for session \(sessionId)")
        }
    }

    /// Append a tool result to the session room for transcript storage.
    /// Some interactive responses (AskUserQuestion, ToolPermission) persist the response
    /// as a system message so it appears in the transcript.
    public func appendToolResult(sessionId: String, toolResultId: String, content: String) {
        guard let encryptedContent = try? crypto.encrypt(plaintext: content) else {
            logger.error("Failed to encrypt tool result content")
            return
        }

        let entry = ServerMessageEntry(
            id: toolResultId,
            sequence: 0, // Server assigns the real sequence
            createdAt: Int(Date().timeIntervalSince1970 * 1000),
            source: "system",
            direction: "input",
            encryptedContent: encryptedContent.encrypted,
            iv: encryptedContent.iv,
            metadata: nil
        )

        let request = AppendMessageRequest(message: entry)
        if let data = try? JSONEncoder().encode(request),
           let json = String(data: data, encoding: .utf8) {
            sessionClient.sendRaw(json)
            logger.info("Appended tool result \(toolResultId) to session room")
        }
    }

    enum SyncError: Error {
        case sessionNotFound
    }

    /// Diagnostic information from a session message sync operation.
    public struct SessionSyncDiagnostic {
        public let totalServerMessages: Int
        public let decryptedCount: Int
        public let storedCount: Int
        public let failedMessageIds: [String]
        public let failedSequences: [Int]
        public let error: String?
    }

    // MARK: - Session Actions

    // MARK: - Push Token Registration

    private func setupPushTokenForwarding() {
        NotificationManager.shared.onTokenReceived = { [weak self] token in
            Task { @MainActor in
                self?.registerPushToken(token)
            }
        }
        // If a token was already received before SyncManager was created, use it now.
        // This handles the case where NotificationManager.shared was accessed early
        // (e.g., from SettingsView) and got a token before the callback was set.
        if let existingToken = NotificationManager.shared.deviceToken {
            registerPushToken(existingToken)
        }
    }

    /// Send the APNs push token to the sync server.
    public func registerPushToken(_ token: String) {
        let message = NotificationManager.makeRegisterTokenMessage(
            token: token,
            deviceId: WebSocketClient.deviceId
        )
        if let data = try? JSONEncoder().encode(message),
           let json = String(data: data, encoding: .utf8) {
            indexClient.sendRaw(json)
            logger.info("Registered push token with server")
        }
    }

    /// Mark a session as read locally and push lastReadAt through the sync server.
    public func markSessionRead(sessionId: String) {
        let now = Int(Date().timeIntervalSince1970 * 1000)

        // Update local SQLite
        do {
            try database.markSessionRead(sessionId)
        } catch {
            logger.error("Failed to mark session read locally: \(error.localizedDescription)")
        }

        // Push lastReadAt through index update to server
        guard let session = try? database.session(byId: sessionId) else { return }
        do {
            let encryptedProjectId = try crypto.encryptProjectId(session.projectId)

            // Build a minimal index update with lastReadAt
            var entry: [String: Any] = [
                "sessionId": session.id,
                "encryptedProjectId": encryptedProjectId,
                "projectIdIv": CryptoManager.projectIdIvBase64,
                "provider": session.provider ?? "unknown",
                "messageCount": 0,
                "lastMessageAt": session.lastMessageAt ?? session.updatedAt,
                "createdAt": session.createdAt,
                "updatedAt": now,
                "isExecuting": session.isExecuting,
                "lastReadAt": now,
            ]

            // Encrypt title if available
            if let title = session.titleDecrypted {
                let result = try crypto.encrypt(plaintext: title)
                entry["encryptedTitle"] = result.encrypted
                entry["titleIv"] = result.iv
            }

            let message: [String: Any] = [
                "type": "indexUpdate",
                "session": entry,
            ]

            if let data = try? JSONSerialization.data(withJSONObject: message),
               let json = String(data: data, encoding: .utf8) {
                indexClient.sendRaw(json)
            }
        } catch {
            logger.error("Failed to push lastReadAt to server: \(error.localizedDescription)")
        }
    }

    /// Request the desktop to create a new session in a project.
    public func createSession(projectId: String, initialPrompt: String? = nil) throws {
        let encryptedProjectId = try crypto.encryptProjectId(projectId)

        var encryptedPrompt: String?
        var promptIv: String?
        if let prompt = initialPrompt {
            let result = try crypto.encrypt(plaintext: prompt)
            encryptedPrompt = result.encrypted
            promptIv = result.iv
        }

        let request = CreateSessionRequestMessage(
            request: EncryptedCreateSessionRequest(
                requestId: UUID().uuidString,
                encryptedProjectId: encryptedProjectId,
                projectIdIv: CryptoManager.projectIdIvBase64,
                encryptedInitialPrompt: encryptedPrompt,
                initialPromptIv: promptIv,
                timestamp: Int(Date().timeIntervalSince1970 * 1000)
            )
        )

        if let data = try? JSONEncoder().encode(request),
           let json = String(data: data, encoding: .utf8) {
            indexClient.sendRaw(json)
        }
    }
}
