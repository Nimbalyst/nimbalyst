#if canImport(UIKit)
import SwiftUI
import WebKit
import os

/// A SwiftUI wrapper around WKWebView that loads the transcript web app
/// and provides a bridge for Swift <-> JS communication.
///
/// The web view loads `transcript.html` from the app bundle and exposes
/// `window.nimbalyst` methods for receiving session data from Swift.
/// JS sends messages back to Swift via `webkit.messageHandlers.bridge`.
/// Provides external access to transcript web view actions (scroll, prompts).
@MainActor
public class TranscriptController: ObservableObject {
    weak var coordinator: TranscriptWebView.Coordinator?

    public func scrollToTop() {
        coordinator?.scrollToTop()
    }

    public func scrollToMessage(messageId: String) {
        coordinator?.scrollToMessage(messageId: messageId)
    }

    public func getPromptList(completion: @escaping ([[String: Any]]) -> Void) {
        coordinator?.getPromptList(completion: completion) ?? completion([])
    }
}

public struct TranscriptWebView: UIViewRepresentable {
    let session: Session
    let messages: [Message]
    let onSendPrompt: (String) -> Void
    let onInteractiveResponse: (String, String, [String: Any]) -> Void
    let controller: TranscriptController?
    let onReady: (() -> Void)?

    public init(
        session: Session,
        messages: [Message],
        onSendPrompt: @escaping (String) -> Void,
        onInteractiveResponse: @escaping (String, String, [String: Any]) -> Void,
        controller: TranscriptController? = nil,
        onReady: (() -> Void)? = nil
    ) {
        self.session = session
        self.messages = messages
        self.onSendPrompt = onSendPrompt
        self.onInteractiveResponse = onInteractiveResponse
        self.controller = controller
        self.onReady = onReady
    }

    private static let logger = Logger(subsystem: "com.nimbalyst.app", category: "TranscriptWebView")

    public func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator(
            session: session,
            onSendPrompt: onSendPrompt,
            onInteractiveResponse: onInteractiveResponse,
            onReady: onReady
        )
        // Wire up the external controller
        controller?.coordinator = coordinator
        return coordinator
    }

    public func makeUIView(context: Context) -> WKWebView {
        // Try to use a pre-warmed web view from the pool.
        if let pooled = TranscriptWebViewPool.shared.takeWebView() {
            Self.logger.debug("Using pre-warmed web view from pool")

            // The pooled web view already has HTML loaded. We just need to
            // register our bridge message handler and wire up the coordinator.
            pooled.configuration.userContentController.add(context.coordinator, name: "bridge")
            context.coordinator.webView = pooled
            pooled.navigationDelegate = context.coordinator

            // The JS app already mounted and sent `ready` during warmup, but
            // there was no bridge handler to receive it. Probe whether the
            // bridge is live by checking for window.nimbalyst.
            pooled.evaluateJavaScript("typeof window.nimbalyst") { result, _ in
                if let type = result as? String, type == "object" {
                    context.coordinator.webViewReady = true
                    // Flush any pending session data
                    if let (session, messages) = context.coordinator.pendingSession {
                        context.coordinator.loadSessionIntoWebView(session: session, messages: messages)
                        context.coordinator.pendingSession = nil
                    }
                }
            }

            return pooled
        }

        // Fallback: create a fresh web view (cold start path).

        let config = WKWebViewConfiguration()

        // Register the bridge message handler
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "bridge")

        // Inject error handler to catch JS errors before page scripts run
        let errorScript = WKUserScript(
            source: """
            window.onerror = function(msg, url, line, col, error) {
                window.webkit.messageHandlers.bridge.postMessage({
                    type: 'js_error',
                    message: msg,
                    url: url,
                    line: line,
                    col: col,
                    stack: error ? error.stack : ''
                });
            };
            window.addEventListener('unhandledrejection', function(e) {
                window.webkit.messageHandlers.bridge.postMessage({
                    type: 'js_error',
                    message: 'Unhandled promise rejection: ' + e.reason
                });
            });
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(errorScript)
        config.userContentController = contentController

        // Allow inline media playback
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x1a/255, green: 0x1a/255, blue: 0x1a/255, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 0x1a/255, green: 0x1a/255, blue: 0x1a/255, alpha: 1)

        // Disable bouncing for a more native feel within the scroll
        webView.scrollView.bounces = false

        // Store reference for later JS calls
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator

        // Load the transcript HTML from the app bundle
        loadTranscriptHTML(webView: webView)

        return webView
    }

    public func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator

        // Check if session changed
        if coordinator.currentSessionId != session.id {
            coordinator.currentSessionId = session.id
            coordinator.lastMessageCount = 0
            coordinator.isReady = false
            coordinator.pendingSession = (session, messages)
            // The web view will call loadSession when ready, or if already ready:
            if coordinator.webViewReady {
                coordinator.loadSessionIntoWebView(session: session, messages: messages)
            }
            return
        }

        // If we haven't sent the initial loadSession yet, update the pending data
        // instead of trying to append (append requires isReady which needs loadSession first).
        // This handles the race where GRDB fires with real data before the WebView is ready.
        if !coordinator.isReady {
            if coordinator.pendingSession != nil {
                coordinator.pendingSession = (session, messages)
            } else if coordinator.webViewReady {
                coordinator.loadSessionIntoWebView(session: session, messages: messages)
            }
            return
        }

        // Check for new messages (append only)
        if messages.count > coordinator.lastMessageCount {
            let newMessages = Array(messages[coordinator.lastMessageCount...])
            for message in newMessages {
                coordinator.appendMessageToWebView(message: message)
            }
            coordinator.lastMessageCount = messages.count
        }

        // Update metadata if session properties changed
        if coordinator.lastIsExecuting != session.isExecuting
            || coordinator.lastProvider != session.provider
            || coordinator.lastModel != session.model
            || coordinator.lastTitle != session.titleDecrypted {
            coordinator.updateMetadataInWebView(session: session)
        }
    }

    private func loadTranscriptHTML(webView: WKWebView) {
        // The transcript-dist folder is a folder reference in the bundle.
        // Bundle.main.url(forResource:subdirectory:) doesn't work with folder references,
        // so we construct the URL directly from the bundle path.
        let bundleURL = Bundle.main.bundleURL
        let distURL = bundleURL.appendingPathComponent("transcript-dist")
        let htmlURL = distURL.appendingPathComponent("transcript.html")

        if FileManager.default.fileExists(atPath: htmlURL.path) {
            webView.loadFileURL(htmlURL, allowingReadAccessTo: distURL)
        } else {
            Self.logger.error("transcript.html not found at: \(htmlURL.path)")
        }
    }

    // MARK: - Coordinator

    public class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let logger = Logger(subsystem: "com.nimbalyst.app", category: "TranscriptWebView.Coordinator")

        weak var webView: WKWebView?
        var currentSessionId: String?
        var lastMessageCount: Int = 0
        var lastIsExecuting: Bool = false
        var lastProvider: String?
        var lastModel: String?
        var lastTitle: String?

        /// Whether the web view JS bridge is ready.
        var webViewReady = false

        /// Whether we've sent the initial loadSession call.
        var isReady = false

        /// Session + messages waiting for the web view to be ready.
        var pendingSession: (Session, [Message])?

        private let session: Session
        private let onSendPrompt: (String) -> Void
        private let onInteractiveResponse: (String, String, [String: Any]) -> Void
        private let onReady: (() -> Void)?

        init(
            session: Session,
            onSendPrompt: @escaping (String) -> Void,
            onInteractiveResponse: @escaping (String, String, [String: Any]) -> Void,
            onReady: (() -> Void)? = nil
        ) {
            self.session = session
            self.onSendPrompt = onSendPrompt
            self.onInteractiveResponse = onInteractiveResponse
            self.onReady = onReady
        }

        // MARK: - WKScriptMessageHandler

        public func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else {
                logger.warning("Invalid bridge message from JS")
                return
            }

            switch type {
            case "ready":
                webViewReady = true
                // Load pending session if we have one
                if let (session, messages) = pendingSession {
                    loadSessionIntoWebView(session: session, messages: messages)
                    pendingSession = nil
                }

            case "prompt":
                if let text = body["text"] as? String {
                    onSendPrompt(text)
                }

            case "interactive_response":
                if let action = body["action"] as? String {
                    let promptId = body["promptId"] as? String
                        ?? body["requestId"] as? String
                        ?? body["questionId"] as? String
                        ?? body["proposalId"] as? String
                        ?? ""
                    onInteractiveResponse(action, promptId, body)
                }

            case "haptic":
                let style = body["style"] as? String ?? "medium"
                triggerHaptic(style: style)

            case "js_error":
                let msg = body["message"] as? String ?? "unknown"
                let url = body["url"] as? String ?? ""
                let line = body["line"] as? Int ?? 0
                logger.error("JS error: \(msg) at \(url):\(line)")

            default:
                logger.debug("Unknown bridge message type: \(type)")
            }
        }

        // MARK: - WKNavigationDelegate

        public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Page loaded successfully - JS bridge will send "ready" message
        }

        public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            logger.error("Navigation failed: \(error.localizedDescription)")
        }

        public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            logger.error("Provisional navigation failed: \(error.localizedDescription)")
        }

        public func webView(_ webView: WKWebView, webContentProcessDidTerminate: WKWebView) {
            logger.warning("Content process terminated - reloading")
            webViewReady = false
            isReady = false
            // Store current session for reload
            if let sid = currentSessionId {
                pendingSession = (session, [])
            }
            webView.reload()
        }

        // MARK: - Swift -> JS

        /// Maximum messages to send in the initial loadSession call.
        /// Keeps the first render fast; remaining messages are sent in background chunks.
        private static let initialPageSize = 50
        /// Number of messages per background chunk.
        private static let chunkSize = 100

        func loadSessionIntoWebView(session: Session, messages: [Message]) {
            guard let webView = webView else { return }

            // Send only the last N messages initially for fast first render.
            let initialCount = min(messages.count, Self.initialPageSize)
            let initialMessages = Array(messages.suffix(initialCount))

            let bridgeMessages = initialMessages.map { messageToBridgeJSON($0) }

            let metadata: [String: Any] = [
                "title": session.titleDecrypted as Any,
                "provider": session.provider as Any,
                "model": session.model as Any,
                "mode": session.mode as Any,
                "isExecuting": session.isExecuting,
            ]

            let sessionData: [String: Any] = [
                "sessionId": session.id,
                "messages": bridgeMessages,
                "metadata": metadata,
            ]

            guard let jsonData = try? JSONSerialization.data(withJSONObject: sessionData),
                  let jsonString = String(data: jsonData, encoding: .utf8) else {
                logger.error("Failed to serialize session data")
                return
            }

            // Capture remaining older messages for background delivery.
            let remainingMessages = messages.count > initialCount
                ? Array(messages.prefix(messages.count - initialCount))
                : []

            let js = "window.nimbalyst?.loadSession(\(jsonString));"
            webView.evaluateJavaScript(js) { [weak self] _, error in
                if let error = error {
                    self?.logger.error("loadSession JS error: \(error.localizedDescription)")
                } else {
                    self?.isReady = true
                    self?.lastMessageCount = messages.count
                    self?.lastIsExecuting = session.isExecuting
                    self?.lastProvider = session.provider
                    self?.lastModel = session.model
                    self?.lastTitle = session.titleDecrypted

                    // Signal to the parent view that transcript is ready.
                    self?.onReady?()

                    // Send remaining older messages in background chunks.
                    if !remainingMessages.isEmpty {
                        self?.sendRemainingChunks(remainingMessages, webView: webView)
                    }
                }
            }
        }

        /// Sends older messages to the web view in background-serialized chunks.
        /// Each chunk is serialized off the main thread, then dispatched to the
        /// JS bridge on the main thread with a small delay between chunks.
        private func sendRemainingChunks(_ messages: [Message], webView: WKWebView) {
            let chunks = stride(from: 0, to: messages.count, by: Self.chunkSize).map {
                Array(messages[$0..<min($0 + Self.chunkSize, messages.count)])
            }

            for (index, chunk) in chunks.enumerated() {
                let bridgeChunk = chunk.map { messageToBridgeJSON($0) }

                // Serialize on a background queue to keep the main thread free.
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    guard let jsonData = try? JSONSerialization.data(withJSONObject: bridgeChunk),
                          let jsonString = String(data: jsonData, encoding: .utf8) else { return }

                    let js = "window.nimbalyst?.loadMoreMessages(\(jsonString));"

                    // Small delay between chunks to let the UI breathe.
                    let delay = Double(index) * 0.05
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        guard self?.isReady == true else { return }
                        webView.evaluateJavaScript(js) { _, error in
                            if let error = error {
                                self?.logger.error("loadMoreMessages chunk \(index) error: \(error.localizedDescription)")
                            }
                        }
                    }
                }
            }
        }

        func appendMessageToWebView(message: Message) {
            guard let webView = webView, isReady else { return }

            let bridgeMsg = messageToBridgeJSON(message)
            guard let jsonData = try? JSONSerialization.data(withJSONObject: bridgeMsg),
                  let jsonString = String(data: jsonData, encoding: .utf8) else { return }

            let js = "window.nimbalyst?.appendMessage(\(jsonString));"
            webView.evaluateJavaScript(js) { [weak self] _, error in
                if let error = error {
                    self?.logger.error("appendMessage JS error: \(error.localizedDescription)")
                }
            }
        }

        func updateMetadataInWebView(session: Session) {
            guard let webView = webView, isReady else { return }

            let metadata: [String: Any] = [
                "title": session.titleDecrypted as Any,
                "provider": session.provider as Any,
                "model": session.model as Any,
                "mode": session.mode as Any,
                "isExecuting": session.isExecuting,
            ]

            guard let jsonData = try? JSONSerialization.data(withJSONObject: metadata),
                  let jsonString = String(data: jsonData, encoding: .utf8) else { return }

            let js = "window.nimbalyst?.updateMetadata(\(jsonString));"
            webView.evaluateJavaScript(js) { [weak self] _, error in
                if let error = error {
                    self?.logger.error("updateMetadata JS error: \(error.localizedDescription)")
                }
            }

            lastIsExecuting = session.isExecuting
            lastProvider = session.provider
            lastModel = session.model
            lastTitle = session.titleDecrypted
        }

        // MARK: - Scroll Control

        func scrollToTop() {
            guard let webView = webView, isReady else { return }
            webView.evaluateJavaScript("window.nimbalyst?.scrollToTop();") { _, _ in }
        }

        func scrollToMessage(messageId: String) {
            guard let webView = webView, isReady else { return }
            let escapedId = messageId.replacingOccurrences(of: "\"", with: "\\\"")
            webView.evaluateJavaScript("window.nimbalyst?.scrollToMessage(\"\(escapedId)\");") { _, _ in }
        }

        /// Get the list of user prompts from the web transcript.
        func getPromptList(completion: @escaping ([[String: Any]]) -> Void) {
            guard let webView = webView, isReady else {
                completion([])
                return
            }
            webView.evaluateJavaScript("JSON.stringify(window.nimbalyst?.getPromptList() || []);") { result, _ in
                guard let jsonString = result as? String,
                      let data = jsonString.data(using: .utf8),
                      let prompts = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                    completion([])
                    return
                }
                completion(prompts)
            }
        }

        // MARK: - Helpers

        private func messageToBridgeJSON(_ message: Message) -> [String: Any] {
            var dict: [String: Any] = [
                "id": message.id,
                "sessionId": message.sessionId,
                "sequence": message.sequence,
                "source": message.source,
                "direction": message.direction,
                "createdAt": message.createdAt,
            ]
            dict["contentDecrypted"] = message.contentDecrypted as Any
            dict["metadataJson"] = message.metadataJson as Any
            return dict
        }

        private func triggerHaptic(style: String) {
            let feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle
            switch style {
            case "light":
                feedbackStyle = .light
            case "heavy":
                feedbackStyle = .heavy
            default:
                feedbackStyle = .medium
            }
            let generator = UIImpactFeedbackGenerator(style: feedbackStyle)
            generator.impactOccurred()
        }
    }
}
#endif
