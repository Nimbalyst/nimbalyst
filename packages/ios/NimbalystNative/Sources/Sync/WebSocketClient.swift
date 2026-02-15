import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif

/// A WebSocket client using URLSessionWebSocketTask with automatic reconnection
/// and periodic device announcements (heartbeat).
final class WebSocketClient: @unchecked Sendable {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "WebSocket")

    private var task: URLSessionWebSocketTask?
    private let session: URLSession
    private var reconnectDelay: TimeInterval = 5.0
    private var deviceAnnounceTimer: Timer?
    private var isIntentionallyClosed = false

    /// The server URL and auth token needed to (re)connect.
    private var serverUrl: String?
    private var authToken: String?
    private var roomId: String?

    /// Callback for received messages.
    var onMessage: ((Data) -> Void)?

    /// Callback for connection state changes.
    var onConnectionStateChanged: ((Bool) -> Void)?

    var isConnected: Bool {
        task?.state == .running
    }

    init() {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
    }

    deinit {
        task?.cancel(with: .goingAway, reason: nil)
    }

    // MARK: - Connect / Disconnect

    /// Whether this client should send periodic device_announce heartbeats.
    /// Only the index room client should send these.
    var sendsDeviceAnnounce = false

    /// Connect to a WebSocket room.
    /// URL format: wss://<host>/sync/<roomId>?token=<jwt>
    func connect(serverUrl: String, roomId: String, authToken: String) {
        self.serverUrl = serverUrl
        self.roomId = roomId
        self.authToken = authToken
        isIntentionallyClosed = false

        performConnect()
    }

    /// Disconnect and stop reconnection attempts.
    func disconnect() {
        isIntentionallyClosed = true
        stopDeviceAnnounceTimer()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        onConnectionStateChanged?(false)
    }

    /// Reconnect using the previously stored connection parameters.
    func reconnect() {
        guard !isIntentionallyClosed else { return }
        performConnect()
    }

    private func performConnect() {
        // Clean up existing connection
        task?.cancel(with: .goingAway, reason: nil)
        task = nil

        guard let serverUrl = serverUrl,
              let roomId = roomId,
              let authToken = authToken else {
            logger.error("Cannot connect: missing serverUrl, roomId, or authToken")
            return
        }

        // Build WebSocket URL: http(s) -> ws(s)
        let wsBase = serverUrl
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        let encodedToken = authToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? authToken
        let urlString = "\(wsBase)/sync/\(roomId)?token=\(encodedToken)"

        guard let url = URL(string: urlString) else {
            logger.error("Invalid WebSocket URL: \(urlString)")
            return
        }

        logger.info("Connecting to \(roomId)...")
        let wsTask = session.webSocketTask(with: url)
        wsTask.maximumMessageSize = 16 * 1024 * 1024 // 16 MB (default is 1 MB)
        self.task = wsTask
        wsTask.resume()

        onConnectionStateChanged?(true)
        startReceiving()
        if sendsDeviceAnnounce {
            startDeviceAnnounceTimer()
        }
    }

    // MARK: - Send

    /// Send a Codable message as JSON.
    func send<T: Encodable>(_ message: T) {
        guard let task = task else {
            logger.warning("Cannot send: not connected")
            return
        }

        do {
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            let data = try encoder.encode(message)
            let string = String(data: data, encoding: .utf8) ?? ""
            task.send(.string(string)) { [weak self] error in
                if let error = error {
                    self?.logger.error("Send error: \(error.localizedDescription)")
                }
            }
        } catch {
            logger.error("Encode error: \(error.localizedDescription)")
        }
    }

    /// Send raw JSON string.
    func sendRaw(_ json: String) {
        guard let task = task else {
            logger.warning("Cannot send raw: not connected")
            return
        }
        task.send(.string(json)) { [weak self] error in
            if let error = error {
                self?.logger.error("Send raw error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Receive Loop

    private func startReceiving() {
        task?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.onMessage?(data)
                    }
                case .data(let data):
                    self.onMessage?(data)
                @unknown default:
                    break
                }
                // Continue receiving
                self.startReceiving()

            case .failure(let error):
                self.logger.error("Receive error: \(error.localizedDescription)")
                self.handleDisconnect()
            }
        }
    }

    // MARK: - Reconnection

    private func handleDisconnect() {
        task = nil
        stopDeviceAnnounceTimer()
        onConnectionStateChanged?(false)

        guard !isIntentionallyClosed else { return }

        logger.info("Scheduling reconnect in \(self.reconnectDelay)s")
        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
            guard let self = self, !self.isIntentionallyClosed else { return }
            self.performConnect()
        }
    }

    // MARK: - Device Announce Timer (Heartbeat)

    private func startDeviceAnnounceTimer() {
        stopDeviceAnnounceTimer()
        // Fire every 30 seconds on the main run loop
        deviceAnnounceTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.sendDeviceAnnounce()
        }
        // Also send immediately on connect
        sendDeviceAnnounce()
    }

    private func stopDeviceAnnounceTimer() {
        deviceAnnounceTimer?.invalidate()
        deviceAnnounceTimer = nil
    }

    private func sendDeviceAnnounce() {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let device = DeviceInfo(
            deviceId: Self.deviceId,
            name: Self.deviceName,
            type: Self.deviceType,
            platform: "ios",
            appVersion: Self.appVersion,
            connectedAt: now,
            lastActiveAt: now,
            isFocused: true,
            status: "active"
        )
        let message = DeviceAnnounceMessage(device: device)

        // Use custom encoding to include the "type" field properly
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(message),
           let json = String(data: data, encoding: .utf8) {
            sendRaw(json)
        }
    }

    // MARK: - Device Info Helpers

    static var deviceId: String {
        // Use identifierForVendor or generate a stable UUID
        if let stored = UserDefaults.standard.string(forKey: "nimbalyst_device_id") {
            return stored
        }
        #if canImport(UIKit)
        let id = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        #else
        let id = UUID().uuidString
        #endif
        UserDefaults.standard.set(id, forKey: "nimbalyst_device_id")
        return id
    }

    private static var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    private static var deviceType: String {
        #if canImport(UIKit)
        switch UIDevice.current.userInterfaceIdiom {
        case .phone: return "mobile"
        case .pad: return "tablet"
        default: return "unknown"
        }
        #else
        return "desktop"
        #endif
    }

    private static var appVersion: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }
}
