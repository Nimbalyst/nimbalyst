#if os(iOS)
import Foundation
import os

/// Core voice mode orchestrator. Manages the OpenAI Realtime API connection,
/// audio pipeline, tool dispatch, and state machine for voice interactions.
///
/// One instance per project, owned by `AppState`. The voice agent is project-scoped:
/// it knows about all sessions and can route prompts to any of them.
@MainActor
public final class VoiceAgent: ObservableObject {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "VoiceAgent")

    // MARK: - State

    public enum State: Equatable {
        case disconnected       // Voice mode off
        case connecting         // Establishing OpenAI WebSocket
        case listening          // Actively listening for user speech
        case processing         // Voice agent is thinking / calling tools
        case speaking           // Voice agent is speaking response
        case idle               // Connected but timed out, waiting for reactivation
    }

    @Published public private(set) var state: State = .disconnected
    @Published public var activeSessionId: String?
    @Published public private(set) var pendingPrompt: PendingPrompt?

    public struct PendingPrompt: Identifiable {
        public let id = UUID()
        public let sessionId: String
        public let sessionTitle: String
        public let prompt: String
        public let submittedAt: Date
        public let delay: TimeInterval
    }

    // MARK: - Configuration

    @Published public var settings: VoiceModeSettings

    // MARK: - Dependencies

    private var database: DatabaseManager?
    private weak var syncManager: SyncManager?
    private var projectId: String?

    // MARK: - Internal Components

    private var realtimeClient: RealtimeClient?
    private let audioPipeline = AudioPipeline()

    // MARK: - Timers

    private var idleTimer: Timer?
    private var pendingPromptTimer: Timer?

    // MARK: - Queued Notifications

    /// When the agent is actively listening, completion notifications are queued.
    private var queuedCompletions: [(sessionId: String, summary: String)] = []

    // MARK: - Init

    public init() {
        self.settings = VoiceModeSettings.load()
    }

    /// Configure the voice agent with project-level dependencies.
    public func configure(
        database: DatabaseManager,
        syncManager: SyncManager,
        projectId: String
    ) {
        self.database = database
        self.syncManager = syncManager
        self.projectId = projectId
    }

    // MARK: - Activate / Deactivate

    /// Start or resume voice mode. Establishes the OpenAI Realtime connection
    /// and begins listening for user speech.
    public func activate() {
        guard let apiKey = KeychainManager.getOpenAIApiKey(), !apiKey.isEmpty else {
            logger.error("Cannot activate voice mode: no OpenAI API key")
            return
        }

        switch state {
        case .idle:
            // Resume from idle - start listening again
            resumeFromIdle()
            return

        case .disconnected:
            break // Continue with full connection setup

        default:
            // Already active
            return
        }

        state = .connecting

        Task {
            // Request microphone permission
            let granted = await audioPipeline.requestMicrophonePermission()
            guard granted else {
                logger.error("Microphone permission denied")
                state = .disconnected
                return
            }

            do {
                try audioPipeline.configureAudioSession()
            } catch {
                logger.error("Failed to configure audio session: \(error.localizedDescription)")
                state = .disconnected
                return
            }

            // Set up the Realtime client
            let client = RealtimeClient(apiKey: apiKey)
            client.voice = "alloy"
            client.instructions = buildCompactInstructions()
            client.tools = buildCoreToolDefinitions()
            client.vadThreshold = settings.vadThreshold
            client.silenceDurationMs = settings.silenceDurationMs

            // Wire callbacks
            setupClientCallbacks(client)

            self.realtimeClient = client
            client.connect()
        }
    }

    /// Stop voice mode entirely. Disconnects from OpenAI and releases audio resources.
    public func deactivate() {
        cancelIdleTimer()
        cancelPendingPromptTimer()
        realtimeClient?.disconnect()
        realtimeClient = nil
        audioPipeline.shutdown()
        pendingPrompt = nil
        queuedCompletions.removeAll()
        state = .disconnected
    }

    // MARK: - Pending Prompt Actions

    /// Cancel the pending prompt before it auto-submits.
    public func cancelPendingPrompt() {
        guard pendingPrompt != nil else { return }
        cancelPendingPromptTimer()
        let cancelled = pendingPrompt
        pendingPrompt = nil

        // Inform the voice agent that the prompt was cancelled
        if let cancelled {
            realtimeClient?.sendUserMessage(
                text: "[SYSTEM: User cancelled the pending prompt to session \"\(cancelled.sessionTitle)\": \"\(cancelled.prompt)\"]"
            )
        }
    }

    /// Confirm and send the pending prompt immediately (skip countdown).
    public func confirmPendingPrompt() {
        guard let prompt = pendingPrompt else { return }
        cancelPendingPromptTimer()
        submitPromptToSession(prompt)
        pendingPrompt = nil
    }

    // MARK: - Completion Notifications

    /// Called when a coding agent finishes a turn. If voice mode is idle,
    /// announces the result and transitions to listening.
    public func onSessionCompleted(sessionId: String, summary: String) {
        guard settings.autoAnnounceCompletions else { return }

        switch state {
        case .idle:
            // Wake up and announce
            let sessionTitle = sessionTitle(for: sessionId) ?? "Unknown session"
            realtimeClient?.sendUserMessage(
                text: "[INTERNAL: Session \"\(sessionTitle)\" completed: \(summary)]"
            )
            state = .processing
            resetIdleTimer()

        case .listening, .processing:
            // Queue for later
            queuedCompletions.append((sessionId: sessionId, summary: summary))

        default:
            break
        }
    }

    // MARK: - Realtime Client Callbacks

    private func setupClientCallbacks(_ client: RealtimeClient) {
        client.onConnected = { [weak self] in
            guard let self else { return }
            self.logger.info("Realtime connected, waiting for session config...")
        }

        client.onSessionReady = { [weak self] in
            guard let self else { return }
            self.logger.info("Session configured, starting capture")
            do {
                try self.audioPipeline.startCapture()
                self.state = .listening
                self.resetIdleTimer()
            } catch {
                self.logger.error("Failed to start capture: \(error.localizedDescription)")
                self.deactivate()
            }
        }

        client.onDisconnected = { [weak self] in
            guard let self else { return }
            if self.state != .disconnected {
                self.logger.warning("Realtime connection lost unexpectedly")
                self.deactivate()
            }
        }

        client.onAudioDelta = { [weak self] base64Audio in
            guard let self else { return }
            if self.state != .speaking {
                self.state = .speaking
                self.cancelIdleTimer()
            }
            self.audioPipeline.enqueuePlayback(base64Audio: base64Audio)
        }

        client.onAudioDone = { [weak self] in
            self?.audioPipeline.markEndOfPlayback()
        }

        audioPipeline.onAudioCaptured = { [weak self] base64Audio in
            Task { @MainActor in
                self?.realtimeClient?.sendAudio(base64Audio)
            }
        }

        audioPipeline.onPlaybackFinished = { [weak self] in
            guard let self else { return }
            self.state = .listening
            self.resetIdleTimer()
            self.processQueuedCompletions()
        }

        client.onResponseCreated = { [weak self] in
            guard let self else { return }
            if self.state == .listening {
                self.state = .processing
                self.cancelIdleTimer()
            }
        }

        client.onResponseDone = { [weak self] in
            guard let self else { return }
            // If no audio was produced (text-only or tool-only response), go back to listening
            if self.state == .processing {
                self.state = .listening
                self.resetIdleTimer()
            }
        }

        client.onSpeechStarted = { [weak self] in
            guard let self else { return }
            // User started speaking - interrupt agent playback if active
            self.audioPipeline.stopPlayback()
            if self.realtimeClient?.hasActiveResponse == true {
                self.realtimeClient?.cancelResponse()
            }
            self.state = .listening
            self.cancelIdleTimer()
        }

        client.onSpeechStopped = { [weak self] in
            guard let self else { return }
            self.state = .processing
        }

        client.onFunctionCall = { [weak self] name, arguments, callId in
            self?.handleToolCall(name: name, arguments: arguments, callId: callId)
        }

        client.onError = { [weak self] type, message in
            self?.logger.error("Realtime error [\(type)]: \(message)")
        }

        client.onTokenUsage = { [weak self] usage in
            self?.logger.info(
                "Token usage: in=\(usage.inputTokens) out=\(usage.outputTokens) audio_in=\(usage.inputAudioTokens) audio_out=\(usage.outputAudioTokens)"
            )
        }
    }

    // MARK: - Tool Handling

    private func handleToolCall(name: String, arguments: String, callId: String) {
        let args = parseArguments(arguments)

        switch name {
        case "submit_prompt":
            handleSubmitPrompt(args: args, callId: callId)
        case "list_sessions":
            handleListSessions(callId: callId)
        case "switch_session":
            handleSwitchSession(args: args, callId: callId)
        case "get_session_summary":
            handleGetSessionSummary(args: args, callId: callId)
        case "stop_voice_session":
            handleStopVoiceSession(callId: callId)
        case "ask_coding_agent":
            handleAskCodingAgent(args: args, callId: callId)
        default:
            logger.info("Unknown tool call: \(name)")
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Unknown tool: \(name)\"}"
            )
        }
    }

    private func handleSubmitPrompt(args: [String: Any], callId: String) {
        let prompt = args["prompt"] as? String ?? ""
        let sessionId = args["session_id"] as? String ?? activeSessionId

        guard let sessionId, !prompt.isEmpty else {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Missing prompt or session_id\"}"
            )
            return
        }

        let title = sessionTitle(for: sessionId) ?? "Session"

        // Set pending prompt (shows confirmation card)
        pendingPrompt = PendingPrompt(
            sessionId: sessionId,
            sessionTitle: title,
            prompt: prompt,
            submittedAt: Date(),
            delay: settings.promptConfirmationDelay
        )

        // Start auto-submit countdown
        pendingPromptTimer = Timer.scheduledTimer(
            withTimeInterval: settings.promptConfirmationDelay,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                self?.autoSubmitPendingPrompt()
            }
        }

        realtimeClient?.sendFunctionCallResult(
            callId: callId,
            output: "{\"success\":true,\"message\":\"Prompt queued for session \\\"\(title)\\\". Waiting for user confirmation (\(Int(settings.promptConfirmationDelay))s countdown).\"}"
        )
    }

    private func handleListSessions(callId: String) {
        guard let database, let projectId else {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"No project configured\"}"
            )
            return
        }

        do {
            let sessions = try database.sessions(forProject: projectId)
            let sessionList = sessions.map { session -> [String: Any] in
                var info: [String: Any] = [
                    "id": session.id,
                    "title": session.titleDecrypted ?? "Untitled",
                    "provider": session.provider ?? "unknown",
                    "model": session.model ?? "unknown",
                    "isExecuting": session.isExecuting,
                    "lastActivity": RelativeTimestamp.format(epochMs: session.updatedAt),
                ]
                if session.id == activeSessionId {
                    info["isFocused"] = true
                }
                return info
            }

            let resultData = try JSONSerialization.data(withJSONObject: [
                "success": true,
                "sessions": sessionList,
            ])
            let resultString = String(data: resultData, encoding: .utf8) ?? "{}"
            realtimeClient?.sendFunctionCallResult(callId: callId, output: resultString)
        } catch {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Failed to list sessions\"}"
            )
        }
    }

    private func handleSwitchSession(args: [String: Any], callId: String) {
        guard let sessionId = args["session_id"] as? String else {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Missing session_id\"}"
            )
            return
        }

        activeSessionId = sessionId
        let title = sessionTitle(for: sessionId) ?? "Unknown"

        realtimeClient?.sendFunctionCallResult(
            callId: callId,
            output: "{\"success\":true,\"message\":\"Switched to session \\\"\(title)\\\"\"}"
        )
    }

    private func handleGetSessionSummary(args: [String: Any], callId: String) {
        let sessionId = args["session_id"] as? String ?? activeSessionId

        guard let sessionId, let database else {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"No session specified\"}"
            )
            return
        }

        do {
            guard let session = try database.session(byId: sessionId) else {
                realtimeClient?.sendFunctionCallResult(
                    callId: callId,
                    output: "{\"success\":false,\"error\":\"Session not found\"}"
                )
                return
            }

            let messages = try database.messages(forSession: sessionId)
            let lastAssistantMessage = messages.last { $0.source == "assistant" }

            var summary: [String: Any] = [
                "success": true,
                "title": session.titleDecrypted ?? "Untitled",
                "provider": session.provider ?? "unknown",
                "model": session.model ?? "unknown",
                "isExecuting": session.isExecuting,
                "messageCount": messages.count,
                "lastActivity": RelativeTimestamp.format(epochMs: session.updatedAt),
            ]

            if let lastMsg = lastAssistantMessage?.contentDecrypted {
                // Truncate to first 500 chars for the summary
                let truncated = String(lastMsg.prefix(500))
                summary["lastAssistantMessage"] = truncated
            }

            let resultData = try JSONSerialization.data(withJSONObject: summary)
            let resultString = String(data: resultData, encoding: .utf8) ?? "{}"
            realtimeClient?.sendFunctionCallResult(callId: callId, output: resultString)
        } catch {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Failed to get session summary\"}"
            )
        }
    }

    private func handleAskCodingAgent(args: [String: Any], callId: String) {
        let question = args["question"] as? String ?? ""
        let sessionId = args["session_id"] as? String ?? activeSessionId

        guard let sessionId, !question.isEmpty else {
            realtimeClient?.sendFunctionCallResult(
                callId: callId,
                output: "{\"success\":false,\"error\":\"Missing question or session_id\"}"
            )
            return
        }

        // Route the question as a prompt to the coding session
        let title = sessionTitle(for: sessionId) ?? "Session"
        pendingPrompt = PendingPrompt(
            sessionId: sessionId,
            sessionTitle: title,
            prompt: question,
            submittedAt: Date(),
            delay: settings.promptConfirmationDelay
        )

        pendingPromptTimer = Timer.scheduledTimer(
            withTimeInterval: settings.promptConfirmationDelay,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                self?.autoSubmitPendingPrompt()
            }
        }

        realtimeClient?.sendFunctionCallResult(
            callId: callId,
            output: "{\"success\":true,\"message\":\"Question queued for session \\\"\(title)\\\". Waiting for user confirmation.\"}"
        )
    }

    private func handleStopVoiceSession(callId: String) {
        realtimeClient?.sendFunctionCallResult(
            callId: callId,
            output: "{\"success\":true,\"message\":\"Voice session ending\"}"
        )

        // Give the agent time to say goodbye, then deactivate
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.deactivate()
        }
    }

    // MARK: - Idle Management

    private func resetIdleTimer() {
        cancelIdleTimer()
        idleTimer = Timer.scheduledTimer(
            withTimeInterval: settings.idleTimeout,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                self?.transitionToIdle()
            }
        }
    }

    private func cancelIdleTimer() {
        idleTimer?.invalidate()
        idleTimer = nil
    }

    private func transitionToIdle() {
        guard state == .listening else { return }
        logger.info("Voice mode going idle after \(self.settings.idleTimeout)s timeout")
        audioPipeline.stopCapture()
        state = .idle
    }

    private func resumeFromIdle() {
        logger.info("Resuming voice mode from idle")
        do {
            try audioPipeline.startCapture()
            state = .listening
            resetIdleTimer()
        } catch {
            logger.error("Failed to resume capture: \(error.localizedDescription)")
            deactivate()
        }
    }

    // MARK: - Pending Prompt Submission

    private func autoSubmitPendingPrompt() {
        guard let prompt = pendingPrompt else { return }
        submitPromptToSession(prompt)
        pendingPrompt = nil
    }

    private func submitPromptToSession(_ prompt: PendingPrompt) {
        guard let syncManager else {
            logger.error("Cannot submit prompt: no SyncManager")
            return
        }

        Task {
            do {
                try await syncManager.sendPrompt(sessionId: prompt.sessionId, text: prompt.prompt)
                logger.info("Submitted voice prompt to session \(prompt.sessionId)")
            } catch {
                logger.error("Failed to submit prompt: \(error.localizedDescription)")
            }
        }
    }

    private func cancelPendingPromptTimer() {
        pendingPromptTimer?.invalidate()
        pendingPromptTimer = nil
    }

    // MARK: - Queued Completions

    private func processQueuedCompletions() {
        guard !queuedCompletions.isEmpty else { return }
        let completions = queuedCompletions
        queuedCompletions.removeAll()

        for completion in completions {
            let title = sessionTitle(for: completion.sessionId) ?? "Unknown"
            realtimeClient?.sendUserMessage(
                text: "[INTERNAL: Session \"\(title)\" completed: \(completion.summary)]"
            )
        }
    }

    // MARK: - Instructions & Tools

    /// Compact instructions matching the Capacitor pattern - no dynamic session data.
    private func buildCompactInstructions() -> String {
        var context = """
        You are a voice assistant on a mobile device for the Nimbalyst coding workspace. You relay requests between the user and coding agents on their desktop.

        Tools:
        - submit_agent_prompt: Queue a coding task for the desktop agent
        - ask_coding_agent: Ask the coding agent a question
        - stop_voice_session: End the conversation

        Keep responses brief and conversational. Never read code verbatim.
        """

        if let projectId {
            let projectName = (projectId as NSString).lastPathComponent
            context += "\nProject: \(projectName)"
        }

        if let activeSessionId {
            let title = sessionTitle(for: activeSessionId) ?? "Untitled"
            context += "\nThe user is viewing session: \"\(title)\""
        }

        return context
    }

    /// Core tools matching the Capacitor implementation exactly (3 tools).
    private func buildCoreToolDefinitions() -> [[String: Any]] {
        [
            [
                "type": "function",
                "name": "submit_agent_prompt",
                "description": "Queue a coding task for the desktop coding agent. The user will see the task and can review/cancel it before it runs.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "prompt": [
                            "type": "string",
                            "description": "The coding task to send to the desktop agent.",
                        ],
                    ],
                    "required": ["prompt"],
                ] as [String: Any],
            ],
            [
                "type": "function",
                "name": "ask_coding_agent",
                "description": "Ask the coding agent a question. Use when you need information about the project, files, or implementation.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "question": [
                            "type": "string",
                            "description": "The question to ask the coding agent.",
                        ],
                    ],
                    "required": ["question"],
                ] as [String: Any],
            ],
            [
                "type": "function",
                "name": "stop_voice_session",
                "description": "End the voice conversation when the user says goodbye or wants to stop.",
                "parameters": [
                    "type": "object",
                    "properties": [:] as [String: Any],
                    "required": [] as [String],
                ] as [String: Any],
            ],
        ]
    }

    // MARK: - Helpers

    private func sessionTitle(for sessionId: String) -> String? {
        try? database?.session(byId: sessionId)?.titleDecrypted
    }

    private func parseArguments(_ json: String) -> [String: Any] {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return dict
    }
}

// MARK: - Voice Mode Settings

public struct VoiceModeSettings: Codable {
    public var voice: String
    public var idleTimeout: TimeInterval
    public var autoAnnounceCompletions: Bool
    public var vadThreshold: Double
    public var silenceDurationMs: Int
    public var promptConfirmationDelay: TimeInterval

    public init(
        voice: String = "sage",
        idleTimeout: TimeInterval = 30,
        autoAnnounceCompletions: Bool = true,
        vadThreshold: Double = 0.5,
        silenceDurationMs: Int = 500,
        promptConfirmationDelay: TimeInterval = 5
    ) {
        self.voice = voice
        self.idleTimeout = idleTimeout
        self.autoAnnounceCompletions = autoAnnounceCompletions
        self.vadThreshold = vadThreshold
        self.silenceDurationMs = silenceDurationMs
        self.promptConfirmationDelay = promptConfirmationDelay
    }

    private static let userDefaultsKey = "voiceModeSettings"

    public static func load() -> VoiceModeSettings {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey),
              let settings = try? JSONDecoder().decode(VoiceModeSettings.self, from: data) else {
            return VoiceModeSettings()
        }
        return settings
    }

    public func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: VoiceModeSettings.userDefaultsKey)
        }
    }
}
#endif
