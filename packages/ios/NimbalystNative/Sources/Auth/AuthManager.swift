import Foundation
import AuthenticationServices
import os

/// Handles Stytch OAuth authentication via ASWebAuthenticationSession.
///
/// Flow:
/// 1. Opens Safari sheet to `<serverUrl>/auth/login/google`
/// 2. User authenticates with Google via Stytch
/// 3. Server redirects to `nimbalyst://auth/callback?session_token=...&session_jwt=...`
/// 4. We capture the callback URL and store credentials in Keychain
/// 5. SyncManager uses the JWT to connect to the WebSocket server
@MainActor
public final class AuthManager: ObservableObject {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "AuthManager")

    @Published public var isAuthenticated: Bool = false
    @Published public var email: String?
    @Published public var isAuthenticating: Bool = false
    @Published public var authError: String?
    @Published public var magicLinkSent: Bool = false

    /// Retained to prevent deallocation during the browser flow.
    private var authSession: ASWebAuthenticationSession?

    /// The JWT for sync server authentication.
    public var sessionJwt: String? {
        KeychainManager.getSessionJwt()
    }

    /// The Stytch user ID (from JWT sub claim).
    public var authUserId: String? {
        KeychainManager.getAuthUserId()
    }

    public init() {
        // Check for existing session
        isAuthenticated = KeychainManager.hasAuthSession()
        email = KeychainManager.getAuthEmail()
    }

    // MARK: - Login

    #if os(iOS)
    /// Start the Google OAuth login flow.
    /// Opens a Safari sheet that redirects back to the app via `nimbalyst://` deep link.
    public func login(serverUrl: String) {
        guard !isAuthenticating else { return }

        // Convert WebSocket URLs to HTTPS (ASWebAuthenticationSession requires HTTP/HTTPS)
        let baseUrl = serverUrl
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        // The server's OAuth endpoint
        guard let loginUrl = URL(string: "\(baseUrl)/auth/login/google") else {
            authError = "Invalid server URL"
            return
        }

        isAuthenticating = true
        authError = nil

        // ASWebAuthenticationSession handles the full browser flow and captures
        // the callback URL with our custom scheme.
        // Must be stored as a property to prevent deallocation during the browser flow.
        authSession = ASWebAuthenticationSession(
            url: loginUrl,
            callbackURLScheme: "nimbalyst"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                self?.isAuthenticating = false
                self?.authSession = nil

                if let error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        self?.logger.info("Login cancelled by user")
                        return
                    }
                    self?.logger.error("Auth error: \(error.localizedDescription)")
                    self?.authError = error.localizedDescription
                    return
                }

                guard let callbackURL else {
                    self?.authError = "No callback URL received"
                    return
                }

                self?.handleCallback(callbackURL)
            }
        }

        // Present the auth session
        authSession?.prefersEphemeralWebBrowserSession = false
        authSession?.presentationContextProvider = ASWebAuthPresentationContext.shared
        authSession?.start()
    }
    #endif

    // MARK: - Magic Link

    #if os(iOS)
    /// Send a magic link email to the given address for passwordless login.
    /// The server sends the email via Stytch; the magic link redirects through
    /// the server's `/auth/callback` which then issues a `nimbalyst://auth/callback` deep link.
    public func sendMagicLink(email: String, serverUrl: String) {
        guard !isAuthenticating else { return }

        let baseUrl = serverUrl
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard let url = URL(string: "\(baseUrl)/api/auth/magic-link") else {
            authError = "Invalid server URL"
            return
        }

        isAuthenticating = true
        authError = nil
        magicLinkSent = false

        // The magic link callback goes to the server's /auth/callback, which
        // authenticates the token and redirects to nimbalyst://auth/callback.
        let callbackUrl = "\(baseUrl)/auth/callback"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "email": email,
            "redirect_url": callbackUrl,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                await MainActor.run {
                    isAuthenticating = false

                    guard let httpResponse = response as? HTTPURLResponse else {
                        authError = "Unexpected response"
                        return
                    }

                    if httpResponse.statusCode == 200 {
                        magicLinkSent = true
                        logger.info("Magic link sent to \(email)")
                    } else {
                        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                        let errorMsg = json?["error"] as? String ?? "Failed to send magic link"
                        authError = errorMsg
                        logger.error("Magic link failed: \(errorMsg)")
                    }
                }
            } catch {
                await MainActor.run {
                    isAuthenticating = false
                    authError = "Network error: \(error.localizedDescription)"
                    logger.error("Magic link request failed: \(error.localizedDescription)")
                }
            }
        }
    }
    #endif

    // MARK: - Callback

    /// Handle the `nimbalyst://auth/callback?...` deep link.
    ///
    /// Validates that the authenticated email matches the pairing email from the QR code.
    /// The desktop derives encryption keys using `PBKDF2(seed, "nimbalyst:<stytchUserId>")`,
    /// so the mobile app MUST authenticate as the same user to derive the same key.
    public func handleCallback(_ url: URL) {
        NSLog("[AuthManager] handleCallback called with URL: \(url.absoluteString.prefix(120))")
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            NSLog("[AuthManager] handleCallback: Invalid callback URL - no components/queryItems")
            authError = "Invalid callback URL"
            return
        }

        let params = Dictionary(uniqueKeysWithValues: queryItems.compactMap { item -> (String, String)? in
            guard let value = item.value else { return nil }
            return (item.name, value)
        })
        NSLog("[AuthManager] handleCallback params: \(params.keys.sorted().joined(separator: ", "))")

        guard let sessionToken = params["session_token"],
              let sessionJwt = params["session_jwt"],
              let userId = params["user_id"] else {
            authError = "Missing required auth parameters"
            NSLog("[AuthManager] handleCallback MISSING params. Got: \(params.keys.joined(separator: ", "))")
            return
        }

        let email = params["email"] ?? ""
        let expiresAt = params["expires_at"] ?? ""

        // Validate the login matches the paired account.
        // The QR code includes syncEmail so we can check it here.
        let pairedUserId = KeychainManager.getUserId()
        NSLog("[AuthManager] email=\(email), pairedUserId=\(pairedUserId ?? "nil")")
        if let pairedEmail = pairedUserId,
           pairedEmail.contains("@"),
           !email.isEmpty,
           email.lowercased() != pairedEmail.lowercased() {
            authError = "Wrong account. Sign in with \(pairedEmail) to match your desktop pairing."
            NSLog("[AuthManager] EMAIL MISMATCH: logged in as \(email), paired with \(pairedEmail)")
            return
        }

        do {
            try KeychainManager.storeAuthSession(
                sessionToken: sessionToken,
                sessionJwt: sessionJwt,
                userId: userId,
                email: email,
                expiresAt: expiresAt
            )
            isAuthenticated = true
            self.email = email
            authError = nil
            NSLog("[AuthManager] Authentication SUCCESS for \(email)")
        } catch {
            authError = "Failed to store auth session: \(error.localizedDescription)"
            NSLog("[AuthManager] Authentication FAILED: \(error.localizedDescription)")
        }
    }

    // MARK: - Refresh

    /// Refresh the session JWT using the session token.
    public func refreshSession(serverUrl: String) async -> Bool {
        guard let sessionToken = KeychainManager.getSessionToken() else {
            logger.warning("No session token to refresh")
            return false
        }

        let baseUrl = serverUrl
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(baseUrl)/auth/refresh") else {
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["session_token": sessionToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                logger.warning("Refresh failed with status: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
                return false
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sessionJwt = json["session_jwt"] as? String else {
                logger.error("Invalid refresh response")
                return false
            }

            // Update just the JWT in keychain
            let sessionToken = json["session_token"] as? String ?? KeychainManager.getSessionToken() ?? ""
            let userId = json["user_id"] as? String ?? KeychainManager.getAuthUserId() ?? ""
            let email = json["email"] as? String ?? KeychainManager.getAuthEmail() ?? ""
            let expiresAt = json["expires_at"] as? String ?? ""

            try KeychainManager.storeAuthSession(
                sessionToken: sessionToken,
                sessionJwt: sessionJwt,
                userId: userId,
                email: email,
                expiresAt: expiresAt
            )

            logger.info("JWT refreshed successfully")
            return true
        } catch {
            logger.error("Refresh request failed: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Logout

    public func logout() {
        KeychainManager.deleteAuthSession()
        isAuthenticated = false
        email = nil
        authError = nil
        magicLinkSent = false
    }
}

// MARK: - ASWebAuthenticationSession Presentation

#if os(iOS)
/// Provides the presentation anchor for ASWebAuthenticationSession.
final class ASWebAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = ASWebAuthPresentationContext()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Find the key window scene's key window
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
        return windowScene?.windows.first(where: { $0.isKeyWindow }) ?? ASPresentationAnchor()
    }
}
#endif
