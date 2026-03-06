import Foundation
import Security

/// Manages iOS Keychain storage for encryption keys and sensitive configuration.
/// The encryption key seed is stored in the Keychain (not SQLite) for security.
enum KeychainManager {
    private static let service = "com.nimbalyst.app"

    private enum Key: String {
        case encryptionKeySeed = "encryption_key_seed"
        case serverUrl = "server_url"
        case userId = "user_id"
        case sessionToken = "stytch_session_token"
        case sessionJwt = "stytch_session_jwt"
        case authUserId = "stytch_user_id"
        case authEmail = "stytch_email"
        case authExpiresAt = "stytch_expires_at"
        case authOrgId = "stytch_org_id"
        case openAIApiKey = "openai_api_key"
        case analyticsId = "analytics_id"
        case pairingPersonalOrgId = "pairing_personal_org_id"
        case pairingPersonalUserId = "pairing_personal_user_id"
    }

    // MARK: - Encryption Key

    static func storeEncryptionKey(seed: String) throws {
        try store(key: .encryptionKeySeed, value: seed)
    }

    static func getEncryptionKey() -> String? {
        retrieve(key: .encryptionKeySeed)
    }

    static func hasEncryptionKey() -> Bool {
        getEncryptionKey() != nil
    }

    // MARK: - Server URL

    static func storeServerUrl(_ url: String) throws {
        try store(key: .serverUrl, value: url)
    }

    static func getServerUrl() -> String? {
        retrieve(key: .serverUrl)
    }

    // MARK: - User ID

    static func storeUserId(_ userId: String) throws {
        try store(key: .userId, value: userId)
    }

    static func getUserId() -> String? {
        retrieve(key: .userId)
    }

    // MARK: - Auth Session (Stytch)

    /// Store a complete auth session from the OAuth callback.
    static func storeAuthSession(
        sessionToken: String,
        sessionJwt: String,
        userId: String,
        email: String,
        expiresAt: String,
        orgId: String
    ) throws {
        try store(key: .sessionToken, value: sessionToken)
        try store(key: .sessionJwt, value: sessionJwt)
        try store(key: .authUserId, value: userId)
        try store(key: .authEmail, value: email)
        try store(key: .authExpiresAt, value: expiresAt)
        try store(key: .authOrgId, value: orgId)
    }

    static func getSessionJwt() -> String? {
        retrieve(key: .sessionJwt)
    }

    static func getSessionToken() -> String? {
        retrieve(key: .sessionToken)
    }

    static func getAuthUserId() -> String? {
        retrieve(key: .authUserId)
    }

    static func getAuthEmail() -> String? {
        retrieve(key: .authEmail)
    }

    static func getAuthOrgId() -> String? {
        retrieve(key: .authOrgId)
    }

    static func hasAuthSession() -> Bool {
        getSessionJwt() != nil
    }

    static func deleteAuthSession() {
        delete(key: .sessionToken)
        delete(key: .sessionJwt)
        delete(key: .authUserId)
        delete(key: .authEmail)
        delete(key: .authExpiresAt)
        delete(key: .authOrgId)
    }

    // MARK: - OpenAI API Key

    static func storeOpenAIApiKey(_ key: String) throws {
        try store(key: .openAIApiKey, value: key)
    }

    static func getOpenAIApiKey() -> String? {
        retrieve(key: .openAIApiKey)
    }

    static func deleteOpenAIApiKey() {
        delete(key: .openAIApiKey)
    }

    // MARK: - Analytics ID

    static func storeAnalyticsId(_ id: String) throws {
        try store(key: .analyticsId, value: id)
    }

    static func getAnalyticsId() -> String? {
        retrieve(key: .analyticsId)
    }

    static func deleteAnalyticsId() {
        delete(key: .analyticsId)
    }

    // MARK: - Pairing Personal Org/User (for room routing)

    static func storePairingPersonalOrgId(_ orgId: String) throws {
        try store(key: .pairingPersonalOrgId, value: orgId)
    }

    static func getPairingPersonalOrgId() -> String? {
        retrieve(key: .pairingPersonalOrgId)
    }

    static func storePairingPersonalUserId(_ userId: String) throws {
        try store(key: .pairingPersonalUserId, value: userId)
    }

    static func getPairingPersonalUserId() -> String? {
        retrieve(key: .pairingPersonalUserId)
    }

    // MARK: - Cleanup

    static func deleteAll() {
        delete(key: .encryptionKeySeed)
        delete(key: .serverUrl)
        delete(key: .userId)
        deleteAuthSession()
        deleteOpenAIApiKey()
        deleteAnalyticsId()
        delete(key: .pairingPersonalOrgId)
        delete(key: .pairingPersonalUserId)
    }

    // MARK: - Generic Keychain Operations

    private static func store(key: Key, value: String) throws {
        let data = Data(value.utf8)

        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.storeFailed(status)
        }
    }

    private static func retrieve(key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(key: Key) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(query as CFDictionary)
    }

    enum KeychainError: Error, LocalizedError {
        case storeFailed(OSStatus)

        var errorDescription: String? {
            switch self {
            case .storeFailed(let status):
                return "Keychain store failed with status: \(status)"
            }
        }
    }
}
