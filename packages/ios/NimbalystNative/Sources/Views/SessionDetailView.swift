import SwiftUI
import GRDB
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Session Load Error

enum SessionLoadError {
    case decryptionFailed(decryptedCount: Int, totalCount: Int)
    case syncFailed(String)
    case webViewFailed(String)
    case noMessages
    case timeout(messageCount: Int, webViewReady: Bool, isTranscriptReady: Bool)

    var title: String {
        switch self {
        case .decryptionFailed: return "Decryption Failed"
        case .syncFailed: return "Sync Failed"
        case .webViewFailed: return "Display Error"
        case .noMessages: return "No Messages"
        case .timeout: return "Load Timeout"
        }
    }

    var description: String {
        switch self {
        case .decryptionFailed(let decrypted, let total):
            return "Only \(decrypted) of \(total) messages could be decrypted. The encryption key may be out of sync."
        case .syncFailed(let detail):
            return "Failed to sync session data: \(detail)"
        case .webViewFailed(let detail):
            return "Transcript display error: \(detail)"
        case .noMessages:
            return "No messages received from server. The transcript may not exist yet."
        case .timeout(let msgCount, let wvReady, let trReady):
            return "Transcript did not load within 15s. Local messages: \(msgCount), WebView ready: \(wvReady), Transcript ready: \(trReady)"
        }
    }
}

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
    /// Debounce work item for pushing draft input changes to sync.
    @State private var draftDebounceItem: DispatchWorkItem?
    /// Whether we are currently applying a synced draft (suppress push-back).
    @State private var isApplyingRemoteDraft = false
    /// Epoch ms of last local submit -- used to reject stale remote drafts.
    @State private var lastSubmitAt: Int = 0
    /// Error message shown when prompt send fails.
    @State private var sendError: String?
    /// Warning shown when prompt was sent but desktop hasn't picked it up.
    @State private var deliveryWarning: String?
    /// Timer that fires if desktop doesn't start executing after a prompt send.
    @State private var deliveryTimeoutItem: DispatchWorkItem?

    /// Queued prompts for this session (from GRDB observation).
    @State private var queuedPrompts: [QueuedPrompt] = []
    @State private var queuedPromptsCancellable: AnyDatabaseCancellable?

    /// Slash commands synced from desktop for this project.
    @State private var projectCommands: [SyncedSlashCommand] = []
    @State private var projectCancellable: AnyDatabaseCancellable?

    /// Controller for transcript web view actions (scroll, prompts).
    #if canImport(UIKit)
    @StateObject private var transcriptController = TranscriptController()
    #endif

    /// Cached prompt list for the jump-to-prompt sheet.
    @State private var promptList: [PromptEntry] = []

    /// Whether the jump-to-prompt sheet is presented.
    @State private var showPromptPicker = false

    /// Whether the transcript web view has loaded and rendered its first data.
    @State private var isTranscriptReady = false

    /// Whether the web view JS bridge signalled ready (may fire before messages arrive).
    @State private var isWebViewReady = false

    /// Error state for diagnosing load failures.
    @State private var loadError: SessionLoadError?

    /// Timeout work item for detecting stuck loads.
    @State private var timeoutWorkItem: DispatchWorkItem?

    /// Debounce work item for refreshPromptList to avoid IPC spam.
    @State private var promptRefreshWorkItem: DispatchWorkItem?

    /// Diagnostic info from sync, used in debug copy.
    @State private var lastDiagnostic: SyncManager.SessionSyncDiagnostic?

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
                    onSendPrompt: { text in sendPrompt(text) },
                    onInteractiveResponse: handleInteractiveResponse,
                    controller: transcriptController,
                    onReady: {
                        isWebViewReady = true
                        // For sessions that have synced messages before,
                        // keep the loading overlay until messages arrive
                        // to avoid flashing the empty capabilities list.
                        let hasHistory = session.lastSyncedSeq > 0
                        if !hasHistory || !messages.isEmpty {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isTranscriptReady = true
                                loadError = nil
                            }
                            timeoutWorkItem?.cancel()
                        }
                    },
                    onError: { errorMessage in
                        if loadError == nil {
                            withAnimation {
                                loadError = .webViewFailed(errorMessage)
                            }
                        }
                    }
                )

                if !isTranscriptReady {
                    if let error = loadError {
                        errorBanner(error: error)
                    } else {
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
            }
            #else
            nativeMessageList
            #endif

            // Queued prompts display
            if !queuedPrompts.isEmpty {
                QueuedPromptsList(prompts: queuedPrompts)
            }

            // Compose bar
            ComposeBar(
                text: $composeText,
                isExecuting: displaySession.isExecuting,
                commands: projectCommands,
                onSend: sendPrompt,
                onCancel: cancelSession,
                onQueue: { text, attachments in sendPrompt(text, attachments) }
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
            #if os(iOS)
            if let voice = appState.voiceAgent, voice.state != .disconnected {
                ToolbarItem(placement: .principal) {
                    VoiceStatusPill(state: voice.state)
                }
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                sessionMenu
            }
        }
        .onAppear {
            startObserving()
            startLoadTimeout()
            subscribeToDiagnostics()
            startObservingQueuedPrompts()
            // Seed compose text from synced draft if local compose is empty
            if composeText.isEmpty, let draft = session.draftInput, !draft.isEmpty {
                isApplyingRemoteDraft = true
                composeText = draft
                DispatchQueue.main.async { isApplyingRemoteDraft = false }
            }
            // Mark session as read when viewing it
            appState.syncManager?.markSessionRead(sessionId: session.id)
            AnalyticsManager.shared.capture("mobile_session_viewed")
        }
        .onChange(of: liveSession?.draftInput) { newDraft in
            // Apply synced draft from another device.
            // Always apply (even if local compose has text) so cross-device sync wins.
            // The isApplyingRemoteDraft flag prevents feedback loops, and the user's
            // next local keystroke will immediately override via the debounced push.
            let draft = newDraft ?? ""
            guard draft != composeText else { return }
            // Reject stale drafts: if the remote draftUpdatedAt is older than our
            // last submit, this is an echo of the pre-submit draft -- ignore it.
            if let remoteTs = liveSession?.draftUpdatedAt, !draft.isEmpty, remoteTs <= lastSubmitAt {
                return
            }
            isApplyingRemoteDraft = true
            composeText = draft
            DispatchQueue.main.async { isApplyingRemoteDraft = false }
        }
        .onChange(of: composeText) { newText in
            // Push draft changes back to sync (debounced)
            guard !isApplyingRemoteDraft else { return }
            draftDebounceItem?.cancel()
            let item = DispatchWorkItem { [weak appState] in
                appState?.syncManager?.updateDraftInput(
                    sessionId: session.id,
                    draftInput: newText
                )
            }
            draftDebounceItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
        }
        .task {
            // Join session room async to avoid blocking navigation transition
            appState.syncManager?.joinSessionRoom(sessionId: session.id)
        }
        .onDisappear {
            sessionCancellable?.cancel()
            messagesCancellable?.cancel()
            projectCancellable?.cancel()
            queuedPromptsCancellable?.cancel()
            timeoutWorkItem?.cancel()
            promptRefreshWorkItem?.cancel()
            draftDebounceItem?.cancel()
            appState.syncManager?.onSessionSyncDiagnostic = nil
            appState.syncManager?.leaveSessionRoom()
        }
        #if canImport(UIKit)
        .sheet(isPresented: $showPromptPicker) {
            NavigationStack {
                PromptPickerList(
                    promptList: promptList,
                    onSelect: { prompt in
                        showPromptPicker = false
                        transcriptController.scrollToMessage(messageId: prompt.id)
                    }
                )
                .navigationTitle("Jump to Prompt")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showPromptPicker = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        #endif
        .alert("Send Error", isPresented: Binding(
            get: { sendError != nil },
            set: { if !$0 { sendError = nil } }
        )) {
            Button("OK") { sendError = nil }
        } message: {
            Text(sendError ?? "")
        }
        .alert("Delivery Warning", isPresented: Binding(
            get: { deliveryWarning != nil },
            set: { if !$0 { deliveryWarning = nil } }
        )) {
            Button("OK") { deliveryWarning = nil }
        } message: {
            Text(deliveryWarning ?? "")
        }
        .onChange(of: liveSession?.isExecuting) { isExec in
            // Desktop picked up the prompt - cancel the delivery timeout
            if isExec == true {
                deliveryTimeoutItem?.cancel()
                deliveryTimeoutItem = nil
                deliveryWarning = nil
            }
        }
        .onChange(of: messages.count) { _ in
            // Web view was ready but waiting for initial messages — reveal now
            if isWebViewReady && !isTranscriptReady {
                withAnimation(.easeOut(duration: 0.2)) {
                    isTranscriptReady = true
                    loadError = nil
                }
                timeoutWorkItem?.cancel()
            }
            // Debounce prompt list refresh to avoid IPC spam when many messages arrive at once
            promptRefreshWorkItem?.cancel()
            let item = DispatchWorkItem { refreshPromptList() }
            promptRefreshWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
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
                if displaySession.hasQueuedPrompts {
                    HStack(spacing: 6) {
                        Image(systemName: "clock.fill")
                            .foregroundStyle(NimbalystColors.warning)
                            .font(.caption)
                        Text("Waiting for response")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else if displaySession.isExecuting {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(NimbalystColors.primary)
                        Text("Executing...")
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
            // Jump to prompt sheet trigger
            if !promptList.isEmpty {
                Button {
                    showPromptPicker = true
                } label: {
                    Label("Jump to Prompt", systemImage: "text.line.first.and.arrowtriangle.forward")
                }
            }
            #endif

            #if os(iOS)
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
            #endif

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
                    let text = dict["text"] as? String ?? ""
                    let createdAt = dict["createdAt"] as? Int ?? 0
                    let displayText = text.isEmpty ? "Prompt \(index + 1)" : text
                    return PromptEntry(id: id, number: index + 1, text: displayText, createdAt: createdAt)
                }
            }
        }
        #endif
    }

    // MARK: - Error Banner

    @ViewBuilder
    private func errorBanner(error: SessionLoadError) -> some View {
        VStack(spacing: 16) {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(NimbalystColors.warning)

                Text(error.title)
                    .font(.headline)
                    .foregroundStyle(.primary)

                Text(error.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                Text("Session: \(session.id.prefix(12))...")
                    .font(.caption)
                    .monospaced()
                    .foregroundStyle(NimbalystColors.textFaint)

                HStack(spacing: 12) {
                    Button {
                        copyDebugInfo(error: error)
                    } label: {
                        Label("Copy Debug Info", systemImage: "doc.on.clipboard")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)

                    Button {
                        retryLoad()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(.subheadline)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(NimbalystColors.primary)
                }
                .padding(.top, 4)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0x1a/255, green: 0x1a/255, blue: 0x1a/255))
    }

    // MARK: - Load Timeout

    private func startLoadTimeout() {
        timeoutWorkItem?.cancel()
        let item = DispatchWorkItem { [self] in
            guard !isTranscriptReady else { return }
            withAnimation {
                loadError = .timeout(
                    messageCount: messages.count,
                    webViewReady: true, // We can't easily read coordinator state, but the detail is in the description
                    isTranscriptReady: isTranscriptReady
                )
            }
        }
        timeoutWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: item)
    }

    // MARK: - Diagnostic Subscription

    private func subscribeToDiagnostics() {
        appState.syncManager?.onSessionSyncDiagnostic = { [self] sessionId, diagnostic in
            guard sessionId == session.id else { return }
            lastDiagnostic = diagnostic

            if let error = diagnostic.error {
                if diagnostic.decryptedCount == 0 && diagnostic.totalServerMessages > 0 {
                    withAnimation {
                        loadError = .decryptionFailed(
                            decryptedCount: diagnostic.decryptedCount,
                            totalCount: diagnostic.totalServerMessages
                        )
                    }
                } else if diagnostic.totalServerMessages == 0 && diagnostic.error == nil {
                    // No error but also no messages — could be normal for a brand new session
                } else {
                    withAnimation {
                        loadError = .syncFailed(error)
                    }
                }
            }
        }
    }

    // MARK: - Retry

    private func retryLoad() {
        loadError = nil
        isTranscriptReady = false
        isWebViewReady = false
        lastDiagnostic = nil
        startLoadTimeout()
        appState.syncManager?.leaveSessionRoom()
        appState.syncManager?.joinSessionRoom(sessionId: session.id)
    }

    // MARK: - Copy Debug Info

    private func copyDebugInfo(error: SessionLoadError) {
        var lines: [String] = [
            "Session Load Error Report",
            "========================",
            "Error: \(error.title)",
            "Detail: \(error.description)",
            "Session ID: \(session.id)",
            "Project ID: \(session.projectId)",
            "Local message count: \(messages.count)",
            "Provider: \(session.provider ?? "nil")",
            "Model: \(session.model ?? "nil")",
            "Created: \(session.createdAt)",
            "Updated: \(session.updatedAt)",
        ]

        if let diag = lastDiagnostic {
            lines.append("")
            lines.append("Sync Diagnostic:")
            lines.append("  Server messages: \(diag.totalServerMessages)")
            lines.append("  Decrypted: \(diag.decryptedCount)")
            lines.append("  Stored: \(diag.storedCount)")
            if !diag.failedMessageIds.isEmpty {
                lines.append("  Failed IDs: \(diag.failedMessageIds.prefix(5).joined(separator: ", "))")
                lines.append("  Failed sequences: \(diag.failedSequences.prefix(5).map(String.init).joined(separator: ", "))")
            }
            if let syncError = diag.error {
                lines.append("  Sync error: \(syncError)")
            }
        }

        let text = lines.joined(separator: "\n")
        #if canImport(UIKit)
        UIPasteboard.general.string = text
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

        // Observe project commands (for slash command typeahead)
        let projectId = session.projectId
        let projectObservation = ValueObservation.tracking { db in
            try Project.fetchOne(db, id: projectId)
        }
        projectCancellable = projectObservation.start(
            in: db.writer,
            onError: { error in
                print("Project observation error: \(error)")
            },
            onChange: { project in
                projectCommands = project?.commands ?? []
            }
        )
    }

    private func startObservingQueuedPrompts() {
        guard let db = appState.databaseManager else { return }
        let sessionId = session.id

        let observation = ValueObservation.tracking { db in
            try QueuedPrompt
                .filter(QueuedPrompt.Columns.sessionId == sessionId)
                .order(QueuedPrompt.Columns.createdAt)
                .fetchAll(db)
        }
        queuedPromptsCancellable = observation.start(
            in: db.writer,
            onError: { error in
                print("Queued prompts observation error: \(error)")
            },
            onChange: { prompts in
                queuedPrompts = prompts
            }
        )
    }

    // MARK: - Actions

    private func sendPrompt(_ text: String, _ attachments: [PendingAttachment] = []) {
        guard let syncManager = appState.syncManager else {
            sendError = "Sync not connected. Try closing and reopening the session."
            return
        }

        // Immediately clear draft input to prevent stale draft from bouncing back via sync.
        // Cancel the pending debounce so it doesn't race with the immediate clear.
        // Record submit timestamp so we can reject any remote draft older than this.
        draftDebounceItem?.cancel()
        draftDebounceItem = nil
        lastSubmitAt = Int(Date().timeIntervalSince1970 * 1000)
        syncManager.updateDraftInput(sessionId: session.id, draftInput: "")

        Task {
            do {
                try await syncManager.sendPrompt(sessionId: session.id, text: text, attachments: attachments)
                AnalyticsManager.shared.capture("mobile_ai_message_sent", properties: [
                    "hasAttachments": !attachments.isEmpty,
                    "attachmentCount": attachments.count,
                ])

                // Start a delivery timeout -- if the session doesn't start executing
                // within 10s, warn the user that the desktop may not have received it.
                deliveryTimeoutItem?.cancel()
                let timeout = DispatchWorkItem { [self] in
                    // Only warn if session still hasn't started executing
                    if !(liveSession?.isExecuting ?? false) {
                        deliveryWarning = "Your prompt was sent but the desktop hasn't started processing it. Make sure the desktop app is running and connected."
                    }
                }
                deliveryTimeoutItem = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
            } catch {
                // Restore the draft so the user doesn't lose their text
                composeText = text
                sendError = "Failed to send: \(error.localizedDescription)"
            }
        }
    }

    private func cancelSession() {
        guard let syncManager = appState.syncManager else { return }
        syncManager.sendSessionControlMessage(sessionId: session.id, messageType: "cancel")
        AnalyticsManager.shared.capture("mobile_session_cancelled")
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
    let number: Int
    let text: String
    let createdAt: Int
}

// MARK: - Prompt Picker List

#if canImport(UIKit)
private struct PromptPickerList: View {
    let promptList: [PromptEntry]
    let onSelect: (PromptEntry) -> Void

    @State private var searchText = ""

    private var filteredPrompts: [PromptEntry] {
        if searchText.isEmpty {
            return promptList
        }
        return promptList.filter { $0.text.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        List(filteredPrompts) { prompt in
            Button {
                onSelect(prompt)
            } label: {
                HStack(spacing: 12) {
                    Text("#\(prompt.number)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(NimbalystColors.primary)
                        .frame(minWidth: 30, alignment: .trailing)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(prompt.text)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .lineLimit(2)

                        if prompt.createdAt > 0 {
                            Text(RelativeTimestamp.format(epochMs: prompt.createdAt))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .listStyle(.plain)
        .searchable(text: $searchText, prompt: "Search prompts")
        .overlay {
            if filteredPrompts.isEmpty && !searchText.isEmpty {
                ContentUnavailableView.search(text: searchText)
            }
        }
    }
}
#endif
