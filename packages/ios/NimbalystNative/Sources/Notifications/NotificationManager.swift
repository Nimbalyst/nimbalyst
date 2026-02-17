import Foundation
import UserNotifications
import os

#if canImport(UIKit)
import UIKit
#endif

/// Manages push notification permissions, token registration, and notification handling.
/// Sends the APNs token to the sync server via `register_push_token` message.
@MainActor
public final class NotificationManager: NSObject, ObservableObject {
    public static let shared = NotificationManager()

    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "NotificationManager")

    @Published public var isAuthorized = false
    @Published public var deviceToken: String?
    /// Set when the user taps a push notification. Views observe this to deep-link.
    @Published public var pendingSessionId: String?

    /// Callback to send the push token to the server. Set by SyncManager.
    public var onTokenReceived: ((String) -> Void)?

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        // If already authorized from a previous launch, re-register for the APNs token
        checkAndReregister()
    }

    /// If push permission was previously granted, re-register for remote notifications
    /// so we get a fresh APNs token on every launch (tokens can rotate).
    private func checkAndReregister() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            isAuthorized = settings.authorizationStatus == .authorized
            if settings.authorizationStatus == .authorized {
                registerForRemoteNotifications()
            }
        }
    }

    /// Request notification permission from the user.
    public func requestPermission() {
        Task {
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                isAuthorized = granted
                if granted {
                    registerForRemoteNotifications()
                }
            } catch {
                logger.error("Notification permission error: \(error.localizedDescription)")
            }
        }
    }

    /// Check current authorization status without prompting.
    public func checkAuthorizationStatus() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            isAuthorized = settings.authorizationStatus == .authorized
        }
    }

    /// Register for remote notifications with APNs.
    private func registerForRemoteNotifications() {
        #if canImport(UIKit)
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
        #endif
    }

    /// Called by the app delegate when APNs returns a device token.
    public func didRegisterForRemoteNotifications(withDeviceToken tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        logger.info("APNs token received: \(token.prefix(8))...")

        DispatchQueue.main.async { [weak self] in
            self?.deviceToken = token
            self?.onTokenReceived?(token)
        }
    }

    /// Called by the app delegate when APNs registration fails.
    public func didFailToRegisterForRemoteNotifications(withError error: Error) {
        logger.error("APNs registration failed: \(error.localizedDescription)")
    }

    /// Build the `register_push_token` message for the sync server.
    nonisolated public static func makeRegisterTokenMessage(token: String, deviceId: String) -> RegisterPushTokenMessage {
        return RegisterPushTokenMessage(
            token: token,
            platform: "ios",
            deviceId: deviceId,
            environment: "production"
        )
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationManager: @preconcurrency UNUserNotificationCenterDelegate {
    /// Handle notification received while app is in the foreground.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }

    /// Handle user tapping on a notification.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        logger.info("Notification tapped: \(userInfo)")
        if let sessionId = userInfo["sessionId"] as? String {
            pendingSessionId = sessionId
        }
        completionHandler()
    }
}
