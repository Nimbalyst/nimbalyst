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
    let currentContext: ContextInfo?
    let lastReadAt: Int?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case encryptedProjectId = "encrypted_project_id"
        case projectIdIv = "project_id_iv"
        case encryptedTitle = "encrypted_title"
        case titleIv = "title_iv"
        case provider, model, mode
        case messageCount = "message_count"
        case lastMessageAt = "last_message_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case pendingExecution, isExecuting
        case queuedPromptCount, encryptedQueuedPrompts
        case hasPendingPrompt, currentContext, lastReadAt
    }
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

    enum CodingKeys: String, CodingKey {
        case id
        case encryptedPrompt = "encrypted_prompt"
        case iv, timestamp, source
    }
}

struct ContextInfo: Codable {
    let tokens: Int
    let contextWindow: Int
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

    enum CodingKeys: String, CodingKey {
        case encryptedProjectId = "encrypted_project_id"
        case projectIdIv = "project_id_iv"
        case encryptedName = "encrypted_name"
        case nameIv = "name_iv"
        case encryptedPath = "encrypted_path"
        case pathIv = "path_iv"
        case sessionCount = "session_count"
        case lastActivityAt = "last_activity_at"
        case syncEnabled = "sync_enabled"
    }
}

/// Session broadcast from index room.
struct IndexBroadcast: Codable {
    let type: String
    let session: ServerSessionEntry
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type, session
        case fromConnectionId = "from_connection_id"
    }
}

/// Session deletion broadcast.
struct IndexDeleteBroadcast: Codable {
    let type: String
    let sessionId: String
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type
        case sessionId = "session_id"
        case fromConnectionId = "from_connection_id"
    }
}

/// New project broadcast.
struct ProjectBroadcast: Codable {
    let type: String
    let project: ServerProjectEntry
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type, project
        case fromConnectionId = "from_connection_id"
    }
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

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case name, type, platform
        case appVersion = "app_version"
        case connectedAt = "connected_at"
        case lastActiveAt = "last_active_at"
        case isFocused = "is_focused"
        case status
    }
}

/// Create session response.
struct CreateSessionResponseBroadcast: Codable {
    let type: String
    let response: CreateSessionResponse
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type, response
        case fromConnectionId = "from_connection_id"
    }
}

struct CreateSessionResponse: Codable {
    let requestId: String
    let success: Bool
    let sessionId: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case success
        case sessionId = "session_id"
        case error
    }
}

/// Server error message.
struct ServerError: Codable {
    let type: String
    let code: String
    let message: String
}

// MARK: - Client -> Server Messages

struct IndexSyncRequest: Codable {
    let type = "index_sync_request"
    let projectId: String?

    enum CodingKeys: String, CodingKey {
        case type
        case projectId = "project_id"
    }
}

struct DeviceAnnounceMessage: Codable {
    let type = "device_announce"
    let device: DeviceInfo
}

public struct RegisterPushTokenMessage: Codable {
    let type = "register_push_token"
    public let token: String
    public let platform: String
    public let deviceId: String
    public let environment: String

    enum CodingKeys: String, CodingKey {
        case type, token, platform, environment
        case deviceId = "device_id"
    }
}

struct CreateSessionRequestMessage: Codable {
    let type = "create_session_request"
    let request: EncryptedCreateSessionRequest
}

struct EncryptedCreateSessionRequest: Codable {
    let requestId: String
    let encryptedProjectId: String
    let projectIdIv: String
    let encryptedInitialPrompt: String?
    let initialPromptIv: String?
    let timestamp: Int

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case encryptedProjectId = "encrypted_project_id"
        case projectIdIv = "project_id_iv"
        case encryptedInitialPrompt = "encrypted_initial_prompt"
        case initialPromptIv = "initial_prompt_iv"
        case timestamp
    }
}

/// Send an index_update to notify desktop of queued prompts or metadata changes.
struct IndexUpdateMessage: Codable {
    let type = "index_update"
    let session: IndexUpdateEntry
}

/// Session entry for index_update messages (client -> server).
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

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case encryptedProjectId = "encrypted_project_id"
        case projectIdIv = "project_id_iv"
        case encryptedTitle = "encrypted_title"
        case titleIv = "title_iv"
        case provider, model, mode
        case messageCount = "message_count"
        case lastMessageAt = "last_message_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case isExecuting
        case queuedPromptCount
        case encryptedQueuedPrompts
    }
}

struct SessionControlMessage: Codable {
    let type = "session_control"
    let message: SessionControlPayload
}

struct SessionControlPayload: Codable {
    let sessionId: String
    let messageType: String
    let payload: [String: AnyCodable]?
    let timestamp: Int
    let sentBy: String

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case messageType = "message_type"
        case payload, timestamp
        case sentBy = "sent_by"
    }
}

// MARK: - Session Room Messages (Client -> Server)

/// Request messages for a session room.
struct SessionSyncRequest: Codable {
    let type = "sync_request"
    let sinceSeq: Int?

    enum CodingKeys: String, CodingKey {
        case type
        case sinceSeq = "since_seq"
    }
}

/// Append a message to the session.
struct AppendMessageRequest: Codable {
    let type = "append_message"
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

    enum CodingKeys: String, CodingKey {
        case type, messages, metadata
        case hasMore = "has_more"
        case cursor
    }
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

    enum CodingKeys: String, CodingKey {
        case id, sequence
        case createdAt = "created_at"
        case source, direction
        case encryptedContent = "encrypted_content"
        case iv, metadata
    }
}

/// Session metadata returned with sync_response.
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

    enum CodingKeys: String, CodingKey {
        case title, provider, model, mode, isExecuting
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case encryptedProjectId = "encrypted_project_id"
        case projectIdIv = "project_id_iv"
    }
}

/// Real-time message broadcast in a session room.
struct MessageBroadcast: Codable {
    let type: String
    let message: ServerMessageEntry
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type, message
        case fromConnectionId = "from_connection_id"
    }
}

/// Session metadata broadcast in a session room.
struct MetadataBroadcast: Codable {
    let type: String
    let metadata: SessionRoomMetadata
    let fromConnectionId: String?

    enum CodingKeys: String, CodingKey {
        case type, metadata
        case fromConnectionId = "from_connection_id"
    }
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
