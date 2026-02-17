import Foundation

// MARK: - Server -> Client Messages

/// Top-level server message envelope.
struct ServerMessage: Codable {
    let type: String
}

/// Full index sync response from the server.
struct IndexSyncResponse: Codable {
    let type: String
    let sessions: [ServerSessionEntry]
    let projects: [ServerProjectEntry]
    /// Total session count from server COUNT(*) - used to detect truncation
    let totalSessionCount: Int?
}

/// A session entry as received from the server (encrypted fields).
struct ServerSessionEntry: Codable {
    let sessionId: String
    let encryptedProjectId: String
    let projectIdIv: String
    let encryptedTitle: String?
    let titleIv: String?
    let provider: String?
    let model: String?
    let mode: String?
    let messageCount: Int?
    let lastMessageAt: Int?
    let createdAt: Int
    let updatedAt: Int
    let pendingExecution: PendingExecution?
    let isExecuting: Bool?
    let queuedPromptCount: Int?
    let encryptedQueuedPrompts: [EncryptedQueuedPrompt]?
    let hasPendingPrompt: Bool?
    let encryptedClientMetadata: String?
    let clientMetadataIv: String?
    let lastReadAt: Int?
}

struct PendingExecution: Codable {
    let messageId: String
    let sentAt: Int
    let sentBy: String
}

struct EncryptedQueuedPrompt: Codable {
    let id: String
    let encryptedPrompt: String
    let iv: String
    let timestamp: Int
    let source: String?
}

struct ContextInfo: Codable {
    let tokens: Int
    let contextWindow: Int
}

/// Decrypted client metadata blob - opaque to server, only clients read it.
/// Add new display-only fields here without touching the server.
struct ClientMetadata: Codable {
    let currentContext: ContextInfo?
}

/// A project entry as received from the server (encrypted fields).
struct ServerProjectEntry: Codable {
    let encryptedProjectId: String
    let projectIdIv: String
    let encryptedName: String?
    let nameIv: String?
    let encryptedPath: String?
    let pathIv: String?
    let sessionCount: Int?
    let lastActivityAt: Int?
    let syncEnabled: Bool?
}

/// Session broadcast from index room.
struct IndexBroadcast: Codable {
    let type: String
    let session: ServerSessionEntry
    let fromConnectionId: String?
}

/// Session deletion broadcast.
struct IndexDeleteBroadcast: Codable {
    let type: String
    let sessionId: String
    let fromConnectionId: String?
}

/// New project broadcast.
struct ProjectBroadcast: Codable {
    let type: String
    let project: ServerProjectEntry
    let fromConnectionId: String?
}

/// Device info for presence.
public struct DeviceInfo: Codable {
    public let deviceId: String
    public let name: String
    public let type: String       // "desktop" | "mobile" | "tablet" | "unknown"
    public let platform: String
    public let appVersion: String?
    public let connectedAt: Int
    public let lastActiveAt: Int
    public let isFocused: Bool?
    public let status: String?    // "active" | "idle" | "away"
}

/// Create session response.
struct CreateSessionResponseBroadcast: Codable {
    let type: String
    let response: CreateSessionResponse
    let fromConnectionId: String?
}

struct CreateSessionResponse: Codable {
    let requestId: String
    let success: Bool
    let sessionId: String?
    let error: String?
}

/// Server error message.
struct ServerError: Codable {
    let type: String
    let code: String
    let message: String
}

/// Encrypted settings payload from desktop (e.g., API keys, voice mode config).
struct EncryptedSettingsPayload: Codable {
    let encryptedSettings: String
    let settingsIv: String
    let deviceId: String
    let timestamp: Int
    let version: Int
}

/// Settings sync broadcast from server (desktop -> mobile).
struct SettingsSyncBroadcast: Codable {
    let type: String
    let settings: EncryptedSettingsPayload
    let fromConnectionId: String?
}

/// Decrypted settings received from desktop.
public struct SyncedSettings: Codable {
    public let openaiApiKey: String?
    public let voiceMode: SyncedVoiceModeSettings?
    public let version: Int
}

/// Voice mode settings synced from desktop.
public struct SyncedVoiceModeSettings: Codable {
    public let voice: String?
    public let submitDelayMs: Int?
}

// MARK: - Client -> Server Messages

struct IndexSyncRequest: Codable {
    let type = "indexSyncRequest"
    let projectId: String?
}

struct DeviceAnnounceMessage: Codable {
    let type = "deviceAnnounce"
    let device: DeviceInfo
}

public struct RegisterPushTokenMessage: Codable {
    let type = "registerPushToken"
    public let token: String
    public let platform: String
    public let deviceId: String
    public let environment: String
}

struct CreateSessionRequestMessage: Codable {
    let type = "createSessionRequest"
    let request: EncryptedCreateSessionRequest
}

struct EncryptedCreateSessionRequest: Codable {
    let requestId: String
    let encryptedProjectId: String
    let projectIdIv: String
    let encryptedInitialPrompt: String?
    let initialPromptIv: String?
    let timestamp: Int
}

/// Send an indexUpdate to notify desktop of queued prompts or metadata changes.
struct IndexUpdateMessage: Codable {
    let type = "indexUpdate"
    let session: IndexUpdateEntry
}

/// Session entry for indexUpdate messages (client -> server).
/// Extra fields like encryptedQueuedPrompts pass through the server broadcast
/// even though the server doesn't persist them.
struct IndexUpdateEntry: Codable {
    let sessionId: String
    let encryptedProjectId: String
    let projectIdIv: String
    let encryptedTitle: String?
    let titleIv: String?
    let provider: String?
    let model: String?
    let mode: String?
    let messageCount: Int
    let lastMessageAt: Int
    let createdAt: Int
    let updatedAt: Int
    let isExecuting: Bool?
    let queuedPromptCount: Int?
    let encryptedQueuedPrompts: [EncryptedQueuedPrompt]?
}

struct SessionControlMessage: Codable {
    let type = "sessionControl"
    let message: SessionControlPayload
}

struct SessionControlPayload: Codable {
    let sessionId: String
    let messageType: String
    let payload: [String: AnyCodable]?
    let timestamp: Int
    let sentBy: String
}

// MARK: - Session Room Messages (Client -> Server)

/// Request messages for a session room.
struct SessionSyncRequest: Codable {
    let type = "syncRequest"
    let sinceSeq: Int?
}

/// Append a message to the session.
struct AppendMessageRequest: Codable {
    let type = "appendMessage"
    let message: ServerMessageEntry
}

// MARK: - Session Room Messages (Server -> Client)

/// Sync response with paginated messages.
struct SessionSyncResponse: Codable {
    let type: String
    let messages: [ServerMessageEntry]
    let metadata: SessionRoomMetadata?
    let hasMore: Bool
    let cursor: String?
}

/// A message entry from the session room.
struct ServerMessageEntry: Codable {
    let id: String
    let sequence: Int
    let createdAt: Int
    let source: String
    let direction: String
    let encryptedContent: String
    let iv: String
    let metadata: [String: AnyCodable]?
}

/// Session metadata returned with syncResponse.
struct SessionRoomMetadata: Codable {
    let title: String?
    let provider: String?
    let model: String?
    let mode: String?
    let isExecuting: Bool?
    let createdAt: Int?
    let updatedAt: Int?
    let encryptedProjectId: String?
    let projectIdIv: String?
    let encryptedClientMetadata: String?
    let clientMetadataIv: String?
}

/// Real-time message broadcast in a session room.
struct MessageBroadcast: Codable {
    let type: String
    let message: ServerMessageEntry
    let fromConnectionId: String?
}

/// Session metadata broadcast in a session room.
struct MetadataBroadcast: Codable {
    let type: String
    let metadata: SessionRoomMetadata
    let fromConnectionId: String?
}

/// Type-erased Codable wrapper for arbitrary JSON values.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
