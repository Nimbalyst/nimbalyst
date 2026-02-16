import SwiftUI
import GRDB

/// Session detail view with an embedded web transcript and native compose bar.
///
/// Uses GRDB observation to reactively update when:
/// - Session metadata changes (title, executing state)
/// - New messages are synced or appended
///
/// The transcript is rendered by a WKWebView running the shared AgentTranscriptPanel
/// from @nimbalyst/runtime. Swift sends pre-decrypted messages to JS, and JS renders
/// them with full tool call, code block, and interactive widget support.
///
/// Joins the session room on appear and leaves on disappear.
public struct SessionDetailView: View {
    @EnvironmentObject var appState: AppState
    let session: Session

    /// Live session data from GRDB observation.
    @State private var liveSession: Session?
    @State private var sessionCancellable: AnyDatabaseCancellable?

    /// Live message list from GRDB observation.
    @State private var messages: [Message] = []
    @State private var messagesCancellable: AnyDatabaseCancellable?

    /// Compose bar state.
    @State private var composeText = ""

    /// Controller for transcript web view actions (scroll, prompts).
    #if canImport(UIKit)
    @StateObject private var transcriptController = TranscriptController()
    #endif

    /// Cached prompt list for the jump-to-prompt menu.
    @State private var promptList: [PromptEntry] = []

    /// Whether the transcript web view has loaded and rendered its first data.
    @State private var isTranscriptReady = false

    private var displaySession: Session {
        liveSession ?? session
    }

    public init(session: Session) {
        self.session = session
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Status bar
            statusBar

            // Web transcript (iOS) or native fallback (macOS)
            #if canImport(UIKit)
            ZStack {
                TranscriptWebView(
                    session: displaySession,
                    messages: messages,
                    onSendPrompt: sendPrompt,
                    onInteractiveResponse: handleInteractiveResponse,
                    controller: transcriptController,
                    onReady: {
                        withAnimation(.easeOut(duration: 0.2)) {
                            isTranscriptReady = true
                        }
                    }
                )

                if !isTranscriptReady {
                    VStack(spacing: 12) {
                        ProgressView()
                            .controlSize(.regular)
                            .tint(NimbalystColors.primary)
                        Text("Loading transcript...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0x1a/255, green: 0x1a/255, blue: 0x1a/255))
                }
            }
            #else
            nativeMessageList
            #endif

            // Compose bar
            ComposeBar(
                text: $composeText,
                isExecuting: displaySession.isExecuting,
                onSend: sendPrompt
            )
        }
        .navigationTitle(displaySession.titleDecrypted ?? "Session")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleMenu {
            Button {
                transcriptController.scrollToTop()
            } label: {
                Label("Scroll to Top", systemImage: "arrow.up")
            }
        }
        #endif
        .toolbar {
            if let voice = appState.voiceAgent, voice.state != .disconnected {
                ToolbarItem(placement: .principal) {
                    VoiceStatusPill(state: voice.state)
                }
            }
            ToolbarItem(placement: .primaryAction) {
                sessionMenu
            }
        }
        .onAppear {
            startObserving()
            // Mark session as read when viewing it
            appState.syncManager?.markSessionRead(sessionId: session.id)
            AnalyticsManager.shared.capture("mobile_session_viewed")
        }
        .task {
            // Join session room async to avoid blocking navigation transition
            appState.syncManager?.joinSessionRoom(sessionId: session.id)
        }
        .onDisappear {
            sessionCancellable?.cancel()
            messagesCancellable?.cancel()
            appState.syncManager?.leaveSessionRoom()
        }
        .onChange(of: messages.count) { _ in
            refreshPromptList()
        }
    }

    // MARK: - Status Bar

    private var hasStatusInfo: Bool {
        displaySession.isExecuting || displaySession.hasQueuedPrompts || displaySession.contextUsagePercent != nil
    }

    @ViewBuilder
    private var statusBar: some View {
        if hasStatusInfo {
            HStack(spacing: 12) {
                if displaySession.isExecuting {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(NimbalystColors.primary)
                        Text("Executing...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else if displaySession.hasQueuedPrompts {
                    HStack(spacing: 6) {
                        Image(systemName: "clock.fill")
                            .foregroundStyle(NimbalystColors.warning)
                            .font(.caption)
                        Text("Prompt queued")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if let pct = displaySession.contextUsagePercent {
                    ContextUsageBar(percent: pct)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial)
        }
    }

    // MARK: - Session Menu

    private var sessionMenu: some View {
        Menu {
            #if canImport(UIKit)
            // Jump to prompt submenu
            if !promptList.isEmpty {
                Menu {
                    ForEach(promptList) { prompt in
                        Button {
                            transcriptController.scrollToMessage(messageId: prompt.id)
                        } label: {
                            Text(prompt.text)
                        }
                    }
                } label: {
                    Label("Jump to Prompt", systemImage: "text.line.first.and.arrowtriangle.forward")
                }
            }
            #endif

            if let voice = appState.voiceAgent {
                Button {
                    if voice.state == .disconnected {
                        voice.activeSessionId = session.id
                        voice.activate()
                    } else {
                        voice.deactivate()
                    }
                } label: {
                    if voice.state == .disconnected {
                        Label("Start Voice Mode", systemImage: "mic.fill")
                    } else {
                        Label("Stop Voice Mode", systemImage: "mic.slash")
                    }
                }
            }

            if let provider = displaySession.provider,
               let model = displaySession.model {
                Section {
                    Label(provider, systemImage: "cpu")
                    Label(model, systemImage: "sparkle")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: - Native Message List (macOS fallback)

    #if !canImport(UIKit)
    private var nativeMessageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(messages) { message in
                        MessageBubbleView(message: message)
                            .id(message.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .onChange(of: messages.count) { _ in
                if let lastId = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }
    #endif

    // MARK: - Prompt List

    private func refreshPromptList() {
        #if canImport(UIKit)
        transcriptController.getPromptList { prompts in
            DispatchQueue.main.async {
                self.promptList = prompts.enumerated().map { index, dict in
                    let id = dict["id"] as? String ?? ""
                    let text = dict["text"] as? String ?? "Prompt \(index + 1)"
                    let createdAt = dict["createdAt"] as? Int ?? 0
                    let displayText = text.isEmpty ? "Prompt \(index + 1)" : text
                    return PromptEntry(id: id, text: "#\(index + 1): \(displayText)", createdAt: createdAt)
                }
            }
        }
        #endif
    }

    // MARK: - Observation

    private func startObserving() {
        guard let db = appState.databaseManager else { return }

        let sessionId = session.id

        // Observe session metadata
        let sessionObservation = ValueObservation.tracking { db in
            try Session.fetchOne(db, id: sessionId)
        }
        sessionCancellable = sessionObservation.start(
            in: db.writer,
            onError: { error in
                print("Session observation error: \(error)")
            },
            onChange: { updatedSession in
                liveSession = updatedSession
            }
        )

        // Observe messages
        let messageObservation = ValueObservation.tracking { db in
            try Message
                .filter(Message.Columns.sessionId == sessionId)
                .order(Message.Columns.sequence)
                .fetchAll(db)
        }
        messagesCancellable = messageObservation.start(
            in: db.writer,
            onError: { error in
                print("Message observation error: \(error)")
            },
            onChange: { newMessages in
                messages = newMessages
            }
        )
    }

    // MARK: - Actions

    private func sendPrompt(_ text: String) {
        guard let syncManager = appState.syncManager else { return }

        do {
            try syncManager.sendPrompt(sessionId: session.id, text: text)
            AnalyticsManager.shared.capture("mobile_ai_message_sent", properties: [
                "hasAttachments": false,
            ])
        } catch {
            print("Failed to send prompt: \(error)")
        }
    }

    private func handleInteractiveResponse(_ action: String, _ promptId: String, _ body: [String: Any]) {
        guard let syncManager = appState.syncManager else { return }

        switch action {
        case "askUserQuestionSubmit":
            let answers = body["answers"] as? [String: String] ?? [:]
            syncManager.sendSessionControlMessage(
                sessionId: session.id,
                messageType: "prompt_response",
                payload: [
                    "promptType": "ask_user_question",
                    "promptId": promptId,
                    "response": ["answers": answers],
                ]
            )
            // Persist response to transcript
            if let json = try? JSONSerialization.data(withJSONObject: ["answers": answers]),
               let jsonStr = String(data: json, encoding: .utf8) {
                syncManager.appendToolResult(sessionId: session.id, toolResultId: promptId, content: jsonStr)
            }
            AnalyticsManager.shared.capture("mobile_ask_user_question_response", properties: [
                "action": "submitted",
                "question_count": answers.count,
            ])

        case "toolPermissionSubmit":
            let response = body["response"] as? [String: Any] ?? [:]
            syncManager.sendSessionControlMessage(
                sessionId: session.id,
                messageType: "prompt_response",
                payload: [
                    "promptType": "tool_permission",
                    "promptId": promptId,
                    "response": response,
                ]
            )
            // Persist response to transcript
            if let json = try? JSONSerialization.data(withJSONObject: response),
               let jsonStr = String(data: json, encoding: .utf8) {
                syncManager.appendToolResult(sessionId: session.id, toolResultId: promptId, content: jsonStr)
            }
            AnalyticsManager.shared.capture("mobile_tool_permission_response", properties: [
                "decision": response["decision"] as? String ?? "unknown",
                "scope": response["scope"] as? String ?? "unknown",
            ])

        case "exitPlanModeApprove":
            syncManager.sendSessionControlMessage(
                sessionId: session.id,
                messageType: "prompt_response",
                payload: [
                    "promptType": "exit_plan_mode",
                    "promptId": promptId,
                    "response": ["approved": true],
                ]
            )
            AnalyticsManager.shared.capture("mobile_exit_plan_mode_response", properties: [
                "action": "approved",
            ])

        case "exitPlanModeDeny":
            let feedback = body["feedback"] as? String
            var response: [String: Any] = ["approved": false]
            if let feedback { response["feedback"] = feedback }
            syncManager.sendSessionControlMessage(
                sessionId: session.id,
                messageType: "prompt_response",
                payload: [
                    "promptType": "exit_plan_mode",
                    "promptId": promptId,
                    "response": response,
                ]
            )
            AnalyticsManager.shared.capture("mobile_exit_plan_mode_response", properties: [
                "action": "denied",
                "has_feedback": feedback != nil,
            ])

        case "gitCommit":
            let files = body["files"] as? [String] ?? []
            let message = body["message"] as? String ?? ""
            syncManager.sendSessionControlMessage(
                sessionId: session.id,
                messageType: "prompt_response",
                payload: [
                    "promptType": "git_commit",
                    "promptId": promptId,
                    "response": [
                        "action": "committed",
                        "files": files,
                        "message": message,
                    ],
                ]
            )
            AnalyticsManager.shared.capture("mobile_git_commit_response", properties: [
                "action": "approved",
                "file_count": files.count,
            ])

        default:
            print("Unhandled interactive response: \(action)")
        }
    }
}

// MARK: - Prompt Entry

struct PromptEntry: Identifiable {
    let id: String
    let text: String
    let createdAt: Int
}
