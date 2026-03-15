package com.nimbalyst.app.sync

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonSyntaxException
import com.nimbalyst.app.attachments.ImageCompressor
import com.nimbalyst.app.attachments.PendingAttachment
import com.nimbalyst.app.crypto.CryptoManager
import com.nimbalyst.app.data.MessageEntity
import com.nimbalyst.app.data.NimbalystRepository
import com.nimbalyst.app.data.ProjectEntity
import com.nimbalyst.app.data.QueuedPromptEntity
import com.nimbalyst.app.data.SessionEntity
import com.nimbalyst.app.notifications.NotificationManager
import com.nimbalyst.app.pairing.PairingCredentials
import com.nimbalyst.app.pairing.PairingStore
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SyncManager(
    private val repository: NimbalystRepository,
    private val pairingStore: PairingStore,
    private val notificationManager: NotificationManager,
    private val scope: CoroutineScope,
) {
    private val gson = Gson()
    private val indexClient = WebSocketClient(scope)
    private val sessionClient = WebSocketClient(scope)
    private val _state = MutableStateFlow(SyncConnectionState())
    private val _connectedDevices = MutableStateFlow<List<DeviceInfo>>(emptyList())
    private val _availableModels = MutableStateFlow<List<SyncedAvailableModel>>(emptyList())
    private val _desktopDefaultModel = MutableStateFlow<String?>(null)

    private var activeCredentials: PairingCredentials? = null
    private var crypto: CryptoManager? = null

    val state: StateFlow<SyncConnectionState> = _state.asStateFlow()
    val connectedDevices: StateFlow<List<DeviceInfo>> = _connectedDevices.asStateFlow()
    val availableModels: StateFlow<List<SyncedAvailableModel>> = _availableModels.asStateFlow()
    val desktopDefaultModel: StateFlow<String?> = _desktopDefaultModel.asStateFlow()

    init {
        indexClient.onConnectionStateChanged = { connected ->
            _state.update {
                it.copy(
                    indexConnected = connected,
                    isConnecting = false,
                    lastError = if (connected) null else it.lastError
                )
            }
            if (connected) {
                notificationManager.state.value.deviceToken?.let(::registerPushToken)
                requestFullSync()
            }
        }
        indexClient.onTextMessage = { message ->
            scope.launch {
                handleIndexMessage(message)
            }
        }
        indexClient.onFailure = { error ->
            _state.update { it.copy(isConnecting = false, lastError = error) }
        }

        sessionClient.onConnectionStateChanged = { connected ->
            val sessionId = _state.value.activeSessionId
            _state.update {
                it.copy(
                    sessionConnected = connected,
                    lastError = if (connected) null else it.lastError
                )
            }
            if (connected && sessionId != null) {
                scope.launch {
                    requestSessionSync(sessionId)
                }
            }
        }
        sessionClient.onTextMessage = { message ->
            scope.launch {
                handleSessionMessage(message)
            }
        }
        sessionClient.onFailure = { error ->
            _state.update { it.copy(lastError = error) }
        }

        notificationManager.onTokenReceived = { token ->
            registerPushToken(token)
        }
    }

    fun connectIfConfigured() {
        if (pairingStore.state.value.isSyncConfigured) {
            connect()
        }
    }

    fun connect() {
        val credentials = pairingStore.state.value.credentials
        if (credentials == null || !credentials.hasAuthToken) {
            _state.update {
                it.copy(
                    isConnecting = false,
                    lastError = "Sync requires a session JWT."
                )
            }
            return
        }

        val jwtClaims = extractJwtClaims(credentials.authJwt.orEmpty())
        val routeUserId = credentials.routingUserId ?: jwtClaims?.sub
        if (routeUserId.isNullOrBlank()) {
            _state.update { it.copy(isConnecting = false, lastError = "Missing routing user ID.") }
            return
        }
        val orgId = credentials.routingOrgId ?: jwtClaims?.orgId
        if (orgId.isNullOrBlank()) {
            _state.update { it.copy(isConnecting = false, lastError = "Missing org ID for room routing.") }
            return
        }
        val cryptoUserId = credentials.cryptoUserId ?: jwtClaims?.sub
        if (cryptoUserId.isNullOrBlank()) {
            _state.update { it.copy(isConnecting = false, lastError = "Missing auth user ID for key derivation.") }
            return
        }

        activeCredentials = credentials.copy(
            authUserId = credentials.authUserId ?: jwtClaims?.sub,
            orgId = credentials.orgId ?: jwtClaims?.orgId,
            personalUserId = credentials.personalUserId,
            personalOrgId = credentials.personalOrgId
        )
        crypto = CryptoManager.fromSeed(credentials.encryptionSeed, cryptoUserId)
        _state.update { it.copy(isConnecting = true, lastError = null) }

        scope.launch {
            repository.clearPrototypeData()
        }

        val roomId = "org:$orgId:user:$routeUserId:index"
        indexClient.connect(
            serverUrl = credentials.serverUrl,
            roomId = roomId,
            authToken = credentials.authJwt.orEmpty()
        )
    }

    fun disconnect() {
        leaveSessionRoom()
        indexClient.disconnect()
        _connectedDevices.value = emptyList()
        _state.update {
            it.copy(
                indexConnected = false,
                sessionConnected = false,
                isConnecting = false,
                activeSessionId = null
            )
        }
    }

    fun requestFullSync() {
        if (!indexClient.isConnected) {
            connectIfConfigured()
            return
        }
        indexClient.sendRaw(gson.toJson(IndexSyncRequest()))
    }

    fun joinSessionRoom(sessionId: String) {
        val credentials = activeCredentials ?: pairingStore.state.value.credentials
        if (credentials == null || !credentials.hasAuthToken) {
            return
        }

        val effectiveUserId = credentials.routingUserId ?: return
        val orgId = credentials.routingOrgId ?: return
        _state.update { it.copy(activeSessionId = sessionId) }
        sessionClient.connect(
            serverUrl = credentials.serverUrl,
            roomId = "org:$orgId:user:$effectiveUserId:session:$sessionId",
            authToken = credentials.authJwt.orEmpty()
        )
    }

    fun createSession(
        projectId: String,
        initialPrompt: String? = null
    ): Result<Unit> {
        val crypto = crypto ?: return Result.failure(IllegalStateException("Sync is not ready."))
        if (!indexClient.isConnected) {
            return Result.failure(IllegalStateException("Index room is not connected."))
        }

        return runCatching {
            val encryptedProjectId = crypto.encryptProjectId(projectId)
            val encryptedPrompt = initialPrompt
                ?.takeIf { it.isNotBlank() }
                ?.let { crypto.encrypt(it) }

            val request = CreateSessionRequestMessage(
                request = EncryptedCreateSessionRequest(
                    requestId = UUID.randomUUID().toString(),
                    encryptedProjectId = encryptedProjectId,
                    projectIdIv = CryptoManager.projectIdIvBase64,
                    encryptedInitialPrompt = encryptedPrompt?.encrypted,
                    initialPromptIv = encryptedPrompt?.iv,
                    timestamp = System.currentTimeMillis()
                )
            )

            val sent = indexClient.sendRaw(gson.toJson(request))
            if (!sent) {
                throw IllegalStateException("Failed to send create session request.")
            }
        }
    }

    suspend fun sendPrompt(
        sessionId: String,
        text: String,
        attachments: List<PendingAttachment> = emptyList()
    ): Result<Unit> {
        val promptText = text.trim()
        if (promptText.isBlank() && attachments.isEmpty()) {
            return Result.failure(IllegalArgumentException("Prompt cannot be empty."))
        }

        val crypto = crypto ?: return Result.failure(IllegalStateException("Sync is not ready."))
        if (!indexClient.isConnected) {
            return Result.failure(IllegalStateException("Index room is not connected."))
        }

        val session = repository.getSession(sessionId)
            ?: return Result.failure(IllegalStateException("Session not found."))

        return try {
            val now = System.currentTimeMillis()
            val promptId = UUID.randomUUID().toString()
            val encryptedPrompt = crypto.encrypt(promptText)
            val encryptedProjectId = crypto.encryptProjectId(session.projectId)
            val queuedPrompt = EncryptedQueuedPrompt(
                id = promptId,
                encryptedPrompt = encryptedPrompt.encrypted,
                iv = encryptedPrompt.iv,
                timestamp = now,
                source = "keyboard"
            ).also { prompt ->
                val encryptedAttachments = attachments.mapNotNull { attachment ->
                    val compressed = ImageCompressor.compress(attachment.bitmap) ?: return@mapNotNull null
                    val encrypted = crypto.encryptData(compressed.data)
                    WireEncryptedAttachment(
                        id = attachment.id,
                        filename = attachment.filename,
                        mimeType = "image/jpeg",
                        encryptedData = encrypted.encrypted,
                        iv = encrypted.iv,
                        size = compressed.data.size,
                        width = compressed.width,
                        height = compressed.height
                    )
                }
                prompt.encryptedAttachments = encryptedAttachments.takeIf { it.isNotEmpty() }
            }

            val update = IndexUpdateMessage(
                session = IndexUpdateEntry(
                    sessionId = sessionId,
                    encryptedProjectId = encryptedProjectId,
                    projectIdIv = CryptoManager.projectIdIvBase64,
                    encryptedTitle = session.titleEncrypted,
                    titleIv = session.titleIv,
                    provider = session.provider ?: "claude-code",
                    model = session.model,
                    mode = session.mode,
                    messageCount = repository.messageCount(sessionId),
                    lastMessageAt = now,
                    createdAt = session.createdAt,
                    updatedAt = now,
                    isExecuting = session.isExecuting,
                    queuedPromptCount = 1,
                    encryptedQueuedPrompts = listOf(queuedPrompt)
                )
            )

            val sent = indexClient.sendRaw(gson.toJson(update))
            if (!sent) {
                throw IllegalStateException("Failed to send prompt update.")
            }

            repository.upsertQueuedPrompt(
                QueuedPromptEntity(
                    id = promptId,
                    sessionId = sessionId,
                    promptTextEncrypted = encryptedPrompt.encrypted,
                    iv = encryptedPrompt.iv,
                    createdAt = now,
                    sentAt = now,
                    promptTextDecrypted = promptText,
                    source = null
                )
            )
            repository.upsertSession(
                session.copy(
                    hasQueuedPrompts = true,
                    updatedAt = now,
                    lastMessageAt = now
                )
            )
            _state.update { it.copy(lastError = null) }
            Result.success(Unit)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    fun sendSessionControlMessage(
        sessionId: String,
        messageType: String,
        payload: JsonObject? = null
    ): Result<Unit> {
        if (!indexClient.isConnected) {
            return Result.failure(IllegalStateException("Index room is not connected."))
        }

        val message = SessionControlMessage(
            message = SessionControlPayload(
                sessionId = sessionId,
                messageType = messageType,
                payload = payload,
                timestamp = System.currentTimeMillis()
            )
        )
        return if (indexClient.sendRaw(gson.toJson(message))) {
            Result.success(Unit)
        } else {
            Result.failure(IllegalStateException("Failed to send session control message."))
        }
    }

    fun registerPushToken(token: String): Result<Unit> {
        if (!indexClient.isConnected) {
            return Result.failure(IllegalStateException("Index room is not connected."))
        }

        val message = RegisterPushTokenMessage(
            token = token,
            platform = "android",
            deviceId = WebSocketClient.deviceId
        )
        return if (indexClient.sendRaw(gson.toJson(message))) {
            Result.success(Unit)
        } else {
            Result.failure(IllegalStateException("Failed to register push token."))
        }
    }

    fun appendToolResult(
        sessionId: String,
        toolResultId: String,
        content: String
    ): Result<Unit> {
        val crypto = crypto ?: return Result.failure(IllegalStateException("Sync is not ready."))
        if (_state.value.activeSessionId != sessionId || !sessionClient.isConnected) {
            return Result.failure(IllegalStateException("Session room is not connected."))
        }

        return try {
            val encryptedContent = crypto.encrypt(content)
            val request = AppendMessageRequest(
                message = ServerMessageEntry(
                    id = toolResultId,
                    sequence = 0,
                    createdAt = System.currentTimeMillis(),
                    source = "system",
                    direction = "input",
                    encryptedContent = encryptedContent.encrypted,
                    iv = encryptedContent.iv,
                    metadata = null
                )
            )
            if (sessionClient.sendRaw(gson.toJson(request))) {
                Result.success(Unit)
            } else {
                Result.failure(IllegalStateException("Failed to append tool result."))
            }
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    fun handleInteractiveResponse(
        sessionId: String,
        action: String,
        promptId: String,
        body: JsonObject
    ): Result<Unit> {
        return try {
            when (action) {
                "askUserQuestionSubmit" -> {
                    val answers = body.getAsJsonObject("answers") ?: JsonObject()
                    val response = JsonObject().apply { add("answers", answers.deepCopy()) }
                    sendSessionControlMessage(
                        sessionId = sessionId,
                        messageType = "prompt_response",
                        payload = jsonObject(
                            "promptType" to "ask_user_question",
                            "promptId" to promptId,
                            "response" to response
                        )
                    ).getOrThrow()
                    appendToolResult(sessionId, promptId, gson.toJson(response)).getOrThrow()
                }

                "toolPermissionSubmit" -> {
                    val response = body.getAsJsonObject("response") ?: JsonObject()
                    sendSessionControlMessage(
                        sessionId = sessionId,
                        messageType = "prompt_response",
                        payload = jsonObject(
                            "promptType" to "tool_permission",
                            "promptId" to promptId,
                            "response" to response
                        )
                    ).getOrThrow()
                    appendToolResult(sessionId, promptId, gson.toJson(response)).getOrThrow()
                }

                "exitPlanModeApprove" -> {
                    sendSessionControlMessage(
                        sessionId = sessionId,
                        messageType = "prompt_response",
                        payload = jsonObject(
                            "promptType" to "exit_plan_mode",
                            "promptId" to promptId,
                            "response" to jsonObject("approved" to true)
                        )
                    ).getOrThrow()
                }

                "exitPlanModeDeny" -> {
                    val response = jsonObject("approved" to false)
                    body.get("feedback")?.takeIf { !it.isJsonNull }?.asString?.let {
                        response.addProperty("feedback", it)
                    }
                    sendSessionControlMessage(
                        sessionId = sessionId,
                        messageType = "prompt_response",
                        payload = jsonObject(
                            "promptType" to "exit_plan_mode",
                            "promptId" to promptId,
                            "response" to response
                        )
                    ).getOrThrow()
                }

                "gitCommit" -> {
                    val response = jsonObject(
                        "action" to "committed",
                        "files" to body.getAsJsonArray("files"),
                        "message" to body.get("message")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
                    )
                    sendSessionControlMessage(
                        sessionId = sessionId,
                        messageType = "prompt_response",
                        payload = jsonObject(
                            "promptType" to "git_commit",
                            "promptId" to promptId,
                            "response" to response
                        )
                    ).getOrThrow()
                }

                else -> throw IllegalArgumentException("Unsupported interactive action: $action")
            }

            _state.update { it.copy(lastError = null) }
            Result.success(Unit)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    fun leaveSessionRoom() {
        sessionClient.disconnect()
        _state.update { it.copy(sessionConnected = false, activeSessionId = null) }
    }

    private suspend fun handleIndexMessage(message: String) {
        when (decodeEnvelope(message)?.type) {
            "indexSyncResponse" -> handleIndexSyncResponse(message)
            "indexBroadcast" -> handleIndexBroadcast(message)
            "indexDeleteBroadcast" -> handleIndexDeleteBroadcast(message)
            "projectBroadcast" -> handleProjectBroadcast(message)
            "createSessionResponseBroadcast" -> handleCreateSessionResponse(message)
            "settingsSyncBroadcast" -> handleSettingsSyncBroadcast(message)
            "devicesList" -> handleDevicesList(message)
            "deviceJoined" -> handleDeviceJoined(message)
            "deviceLeft" -> handleDeviceLeft(message)
            "error" -> handleServerError(message)
        }
    }

    private suspend fun handleSessionMessage(message: String) {
        when (decodeEnvelope(message)?.type) {
            "syncResponse" -> handleSessionSyncResponse(message)
            "messageBroadcast" -> handleMessageBroadcast(message)
            "metadataBroadcast" -> handleMetadataBroadcast(message)
            "error" -> handleServerError(message)
        }
    }

    private fun decodeEnvelope(message: String): ServerMessageEnvelope? {
        return try {
            gson.fromJson(message, ServerMessageEnvelope::class.java)
        } catch (_: JsonSyntaxException) {
            null
        }
    }

    private suspend fun handleIndexSyncResponse(message: String) {
        val response = parse<IndexSyncResponse>(message) ?: return
        val projects = response.projects.mapNotNull(::processProjectEntry)
        val sessions = response.sessions.mapNotNull { processSessionEntry(it) }
        val syncedAt = System.currentTimeMillis()
        repository.replaceIndexSnapshot(
            projects = projects,
            sessions = sessions.map { it.session },
            syncedAt = syncedAt
        )
        sessions.forEach { syncQueuedPrompts(it) }
        _state.update { it.copy(lastIndexSyncAt = syncedAt, lastError = null) }
    }

    private suspend fun handleIndexBroadcast(message: String) {
        val broadcast = parse<IndexBroadcast>(message) ?: return
        processSessionEntry(broadcast.session)?.let { processed ->
            repository.upsertSession(processed.session)
            syncQueuedPrompts(processed)
        }
    }

    private suspend fun handleIndexDeleteBroadcast(message: String) {
        val broadcast = parse<IndexDeleteBroadcast>(message) ?: return
        repository.deleteSession(broadcast.sessionId)
    }

    private suspend fun handleProjectBroadcast(message: String) {
        val broadcast = parse<ProjectBroadcast>(message) ?: return
        val project = processProjectEntry(broadcast.project) ?: return
        repository.replaceIndexSnapshot(
            projects = listOf(project),
            sessions = emptyList(),
            syncedAt = System.currentTimeMillis()
        )
    }

    private fun handleCreateSessionResponse(message: String) {
        val broadcast = parse<CreateSessionResponseBroadcast>(message) ?: return
        if (broadcast.response.success) {
            _state.update { it.copy(lastError = null) }
        } else {
            _state.update {
                it.copy(lastError = broadcast.response.error ?: "Desktop rejected the session creation request.")
            }
        }
    }

    private fun handleSettingsSyncBroadcast(message: String) {
        val broadcast = parse<SettingsSyncBroadcast>(message) ?: return
        val settingsJson = crypto?.decryptOrNull(
            broadcast.settings.encryptedSettings,
            broadcast.settings.settingsIv
        ) ?: return
        val settings = parse<SyncedSettings>(settingsJson) ?: return

        _availableModels.value = settings.availableModels.orEmpty()
        _desktopDefaultModel.value = settings.defaultModel
        _state.update { it.copy(lastError = null) }
    }

    private suspend fun handleSessionSyncResponse(message: String) {
        val sessionId = _state.value.activeSessionId ?: return
        val response = parse<SessionSyncResponse>(message) ?: return
        response.metadata?.let { mergeSessionMetadata(sessionId, it) }

        val decryptedMessages = response.messages.mapNotNull { processMessageEntry(it, sessionId) }
        val lastSequence = maxOf(
            repository.syncState(sessionId)?.lastSequence ?: 0,
            decryptedMessages.maxOfOrNull { it.sequence } ?: 0
        )
        val syncedAt = System.currentTimeMillis()

        repository.persistSessionMessages(
            sessionId = sessionId,
            messages = decryptedMessages,
            cursor = response.cursor,
            lastSequence = lastSequence,
            syncedAt = syncedAt
        )
        _state.update { it.copy(lastSessionSyncAt = syncedAt, lastError = null) }

        if (response.hasMore) {
            requestSessionSync(sessionId, lastSequence)
        }
    }

    private suspend fun handleMessageBroadcast(message: String) {
        val sessionId = _state.value.activeSessionId ?: return
        val broadcast = parse<MessageBroadcast>(message) ?: return
        val decrypted = processMessageEntry(broadcast.message, sessionId) ?: return
        repository.persistSessionMessages(
            sessionId = sessionId,
            messages = listOf(decrypted),
            cursor = null,
            lastSequence = decrypted.sequence,
            syncedAt = System.currentTimeMillis()
        )
    }

    private suspend fun handleMetadataBroadcast(message: String) {
        val sessionId = _state.value.activeSessionId ?: return
        val broadcast = parse<MetadataBroadcast>(message) ?: return
        mergeSessionMetadata(sessionId, broadcast.metadata)
    }

    private fun handleDevicesList(message: String) {
        val devices = parse<DevicesListMessage>(message)?.devices ?: return
        _connectedDevices.value = devices
    }

    private fun handleDeviceJoined(message: String) {
        val device = parse<DeviceJoinedMessage>(message)?.device ?: return
        _connectedDevices.update { current ->
            if (current.any { it.deviceId == device.deviceId }) current else current + device
        }
    }

    private fun handleDeviceLeft(message: String) {
        val deviceId = parse<DeviceLeftMessage>(message)?.deviceId ?: return
        _connectedDevices.update { current -> current.filterNot { it.deviceId == deviceId } }
    }

    private fun handleServerError(message: String) {
        val serverError = parse<ServerErrorMessage>(message) ?: return
        _state.update { it.copy(lastError = "${serverError.code}: ${serverError.message}") }
    }

    private suspend fun requestSessionSync(sessionId: String, explicitSinceSeq: Int? = null) {
        val sinceSeq = explicitSinceSeq ?: repository.syncState(sessionId)?.lastSequence
        sessionClient.sendRaw(
            gson.toJson(
                SessionSyncRequest(sinceSeq = sinceSeq?.takeIf { it > 0 })
            )
        )
    }

    private fun processProjectEntry(entry: ServerProjectEntry): ProjectEntity? {
        val crypto = crypto ?: return null
        val projectId = crypto.decryptOrNull(entry.encryptedProjectId, entry.projectIdIv) ?: return null
        return ProjectEntity(
            id = projectId,
            name = File(projectId).name.ifBlank { projectId },
            sessionCount = entry.sessionCount ?: 0,
            lastUpdatedAt = entry.lastActivityAt,
            sortOrder = 0,
            commandsJson = null
        )
    }

    private suspend fun processSessionEntry(entry: ServerSessionEntry): ProcessedSessionEntry? {
        val crypto = crypto ?: return null
        val projectId = crypto.decryptOrNull(entry.encryptedProjectId, entry.projectIdIv) ?: return null
        val existing = repository.getSession(entry.sessionId)
        val titleDecrypted = crypto.decryptOrNull(entry.encryptedTitle, entry.titleIv)
        val clientMetadata = decodeClientMetadata(entry.encryptedClientMetadata, entry.clientMetadataIv)
        val draftInput = clientMetadata?.draftInput?.ifBlank { null }

        return ProcessedSessionEntry(
            session = SessionEntity(
                id = entry.sessionId,
                projectId = projectId,
                titleEncrypted = entry.encryptedTitle,
                titleIv = entry.titleIv,
                titleDecrypted = titleDecrypted ?: existing?.titleDecrypted,
                provider = entry.provider ?: existing?.provider,
                model = entry.model ?: existing?.model,
                mode = entry.mode ?: existing?.mode,
                sessionType = entry.sessionType ?: existing?.sessionType,
                parentSessionId = entry.parentSessionId ?: existing?.parentSessionId,
                phase = clientMetadata?.phase ?: existing?.phase,
                tagsJson = clientMetadata?.tags?.takeIf { it.isNotEmpty() }?.let(gson::toJson) ?: existing?.tagsJson,
                worktreeId = entry.worktreeId ?: existing?.worktreeId,
                isArchived = entry.isArchived ?: existing?.isArchived ?: false,
                isPinned = entry.isPinned ?: existing?.isPinned ?: false,
                branchedFromSessionId = entry.branchedFromSessionId ?: existing?.branchedFromSessionId,
                branchPointMessageId = entry.branchPointMessageId ?: existing?.branchPointMessageId,
                branchedAt = entry.branchedAt ?: existing?.branchedAt,
                isExecuting = entry.isExecuting ?: existing?.isExecuting ?: false,
                hasQueuedPrompts = clientMetadata?.hasPendingPrompt
                    ?: entry.hasPendingPrompt
                    ?: when {
                        entry.queuedPromptCount == 0 -> false
                        entry.queuedPromptCount != null -> entry.queuedPromptCount > 0
                        else -> existing?.hasQueuedPrompts ?: false
                    },
                contextTokens = clientMetadata?.currentContext?.tokens ?: existing?.contextTokens,
                contextWindow = clientMetadata?.currentContext?.contextWindow ?: existing?.contextWindow,
                createdAt = entry.createdAt,
                updatedAt = entry.updatedAt,
                lastSyncedSeq = existing?.lastSyncedSeq ?: 0,
                lastReadAt = entry.lastReadAt ?: existing?.lastReadAt,
                lastMessageAt = entry.lastMessageAt ?: existing?.lastMessageAt,
                draftInput = draftInput ?: existing?.draftInput,
                draftUpdatedAt = clientMetadata?.draftUpdatedAt ?: existing?.draftUpdatedAt
            ),
            queuedPrompts = decryptQueuedPrompts(entry.sessionId, entry.encryptedQueuedPrompts),
            clearQueuedPrompts = entry.queuedPromptCount == 0 || entry.encryptedQueuedPrompts?.isEmpty() == true
        )
    }

    private fun processMessageEntry(entry: ServerMessageEntry, sessionId: String): MessageEntity? {
        val crypto = crypto ?: return null
        val contentDecrypted = crypto.decryptOrNull(entry.encryptedContent, entry.iv) ?: return null
        return MessageEntity(
            id = entry.id,
            sessionId = sessionId,
            sequence = entry.sequence,
            source = entry.source,
            direction = entry.direction,
            encryptedContent = entry.encryptedContent,
            iv = entry.iv,
            contentDecrypted = contentDecrypted,
            metadataJson = entry.metadata?.toString(),
            createdAt = entry.createdAt
        )
    }

    private suspend fun mergeSessionMetadata(
        sessionId: String,
        metadata: SessionRoomMetadata
    ) {
        val existing = repository.getSession(sessionId) ?: return
        val crypto = crypto ?: return
        val clientMetadata = decodeClientMetadata(metadata.encryptedClientMetadata, metadata.clientMetadataIv)
        val draftInput = clientMetadata?.draftInput?.ifBlank { null }
        val titleDecrypted = if (metadata.title != null) {
            metadata.title
        } else {
            crypto.decryptOrNull(existing.titleEncrypted, existing.titleIv)
        }
        val projectId = when {
            !metadata.encryptedProjectId.isNullOrBlank() && !metadata.projectIdIv.isNullOrBlank() ->
                crypto.decryptOrNull(metadata.encryptedProjectId, metadata.projectIdIv) ?: existing.projectId
            else -> existing.projectId
        }

        repository.upsertSession(
            existing.copy(
                projectId = projectId,
                titleDecrypted = titleDecrypted ?: existing.titleDecrypted,
                provider = metadata.provider ?: existing.provider,
                model = metadata.model ?: existing.model,
                mode = metadata.mode ?: existing.mode,
                isExecuting = metadata.isExecuting ?: existing.isExecuting,
                updatedAt = metadata.updatedAt ?: existing.updatedAt,
                createdAt = metadata.createdAt ?: existing.createdAt,
                phase = clientMetadata?.phase ?: existing.phase,
                tagsJson = clientMetadata?.tags?.takeIf { it.isNotEmpty() }?.let(gson::toJson) ?: existing.tagsJson,
                hasQueuedPrompts = clientMetadata?.hasPendingPrompt ?: existing.hasQueuedPrompts,
                contextTokens = clientMetadata?.currentContext?.tokens ?: existing.contextTokens,
                contextWindow = clientMetadata?.currentContext?.contextWindow ?: existing.contextWindow,
                draftInput = draftInput ?: existing.draftInput,
                draftUpdatedAt = clientMetadata?.draftUpdatedAt ?: existing.draftUpdatedAt
            )
        )
    }

    private suspend fun syncQueuedPrompts(entry: ProcessedSessionEntry) {
        when {
            entry.queuedPrompts != null -> repository.replaceRemoteQueuedPrompts(
                sessionId = entry.session.id,
                prompts = entry.queuedPrompts
            )
            entry.clearQueuedPrompts -> repository.clearRemoteQueuedPrompts(entry.session.id)
        }
    }

    private fun decryptQueuedPrompts(
        sessionId: String,
        encryptedPrompts: List<EncryptedQueuedPrompt>?
    ): List<QueuedPromptEntity>? {
        val crypto = crypto ?: return null
        val prompts = encryptedPrompts?.takeIf { it.isNotEmpty() } ?: return null
        return prompts.mapNotNull { prompt ->
            val plaintext = crypto.decryptOrNull(prompt.encryptedPrompt, prompt.iv) ?: return@mapNotNull null
            QueuedPromptEntity(
                id = prompt.id,
                sessionId = sessionId,
                promptTextEncrypted = prompt.encryptedPrompt,
                iv = prompt.iv,
                createdAt = prompt.timestamp,
                sentAt = null,
                promptTextDecrypted = plaintext,
                source = prompt.source ?: "desktop"
            )
        }
    }

    private fun decodeClientMetadata(
        encryptedMetadata: String?,
        metadataIv: String?
    ): ClientMetadata? {
        val crypto = crypto ?: return null
        val json = crypto.decryptOrNull(encryptedMetadata, metadataIv) ?: return null
        return parse<ClientMetadata>(json)
    }

    private inline fun <reified T> parse(json: String): T? {
        return try {
            gson.fromJson(json, T::class.java)
        } catch (_: Exception) {
            null
        }
    }

    private fun jsonObject(vararg entries: Pair<String, Any?>): JsonObject {
        return JsonObject().apply {
            entries.forEach { (key, value) ->
                when (value) {
                    null -> add(key, com.google.gson.JsonNull.INSTANCE)
                    is String -> addProperty(key, value)
                    is Boolean -> addProperty(key, value)
                    is Number -> addProperty(key, value)
                    is JsonObject -> add(key, value.deepCopy())
                    is com.google.gson.JsonArray -> add(key, value.deepCopy())
                    is com.google.gson.JsonElement -> add(key, value.deepCopy())
                    else -> add(key, gson.toJsonTree(value))
                }
            }
        }
    }

    private fun extractJwtClaims(jwt: String): JwtClaims? {
        val parts = jwt.split('.')
        if (parts.size != 3) {
            return null
        }

        val payload = runCatching {
            val normalized = parts[1]
                .replace('-', '+')
                .replace('_', '/')
                .let { value ->
                    val padding = value.length % 4
                    if (padding == 0) value else value + "=".repeat(4 - padding)
                }
            String(java.util.Base64.getDecoder().decode(normalized), StandardCharsets.UTF_8)
        }.getOrNull() ?: return null

        val json = parse<JsonObject>(payload) ?: return null
        val orgId = json.getAsJsonObject("https://stytch.com/organization")
            ?.get("organization_id")
            ?.takeIf { !it.isJsonNull }
            ?.asString

        return JwtClaims(
            sub = json.get("sub")?.takeIf { !it.isJsonNull }?.asString,
            orgId = orgId
        )
    }
}

private data class JwtClaims(
    val sub: String?,
    val orgId: String?
)

private data class ProcessedSessionEntry(
    val session: SessionEntity,
    val queuedPrompts: List<QueuedPromptEntity>?,
    val clearQueuedPrompts: Boolean,
)
