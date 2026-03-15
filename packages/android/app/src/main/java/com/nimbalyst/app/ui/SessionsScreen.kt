package com.nimbalyst.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.nimbalyst.app.NimbalystApplication
import com.nimbalyst.app.attachments.PendingAttachment
import com.nimbalyst.app.data.MessageEntity
import com.nimbalyst.app.data.QueuedPromptEntity
import com.nimbalyst.app.transcript.TranscriptWebView
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

@Composable
fun SessionsScreen() {
    val context = LocalContext.current
    val app = context.applicationContext as NimbalystApplication
    val coroutineScope = rememberCoroutineScope()
    val sessions by app.repository.observeActiveSessions().collectAsState(initial = emptyList())
    val selectedSessionId = remember { mutableStateOf<String?>(null) }
    var draftPrompt by remember { mutableStateOf("") }
    var promptStatus by remember { mutableStateOf<String?>(null) }
    var isSendingPrompt by remember { mutableStateOf(false) }
    var pendingAttachments by remember { mutableStateOf<List<PendingAttachment>>(emptyList()) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        val bitmap = decodeBitmap(context, uri)
        if (bitmap == null) {
            promptStatus = "Failed to load the selected image."
        } else {
            pendingAttachments = pendingAttachments + PendingAttachment(bitmap = bitmap)
            promptStatus = "Added photo attachment."
        }
    }
    val cameraPreviewLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        if (bitmap != null) {
            pendingAttachments = pendingAttachments + PendingAttachment(
                bitmap = bitmap,
                filename = "camera.jpg"
            )
            promptStatus = "Captured camera attachment."
        }
    }

    LaunchedEffect(sessions) {
        if (selectedSessionId.value == null || sessions.none { it.id == selectedSessionId.value }) {
            selectedSessionId.value = sessions.firstOrNull()?.id
        }
    }

    LaunchedEffect(selectedSessionId.value) {
        val sessionId = selectedSessionId.value
        if (sessionId != null) {
            app.syncManager.joinSessionRoom(sessionId)
        } else {
            app.syncManager.leaveSessionRoom()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            app.syncManager.leaveSessionRoom()
        }
    }

    val selectedSession = sessions.firstOrNull { it.id == selectedSessionId.value }
    val messagesFlow = if (selectedSession != null) {
        app.repository.observeMessagesForSession(selectedSession.id)
    } else {
        flowOf(emptyList<MessageEntity>())
    }
    val messages by messagesFlow.collectAsState(initial = emptyList())
    val queuedPromptsFlow = if (selectedSession != null) {
        app.repository.observeQueuedPromptsForSession(selectedSession.id)
    } else {
        flowOf(emptyList<QueuedPromptEntity>())
    }
    val queuedPrompts by queuedPromptsFlow.collectAsState(initial = emptyList())

    LaunchedEffect(selectedSession?.id) {
        draftPrompt = ""
        promptStatus = null
        isSendingPrompt = false
        pendingAttachments = emptyList()
    }

    LaunchedEffect(selectedSession?.id, messages.lastOrNull()?.createdAt) {
        val sessionId = selectedSession?.id ?: return@LaunchedEffect
        val readAt = messages.lastOrNull()?.createdAt ?: selectedSession?.lastMessageAt ?: return@LaunchedEffect
        app.repository.markSessionRead(sessionId, readAt)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        ScreenScaffold(
            title = "Sessions",
            subtitle = "Session detail now uses the transcript host backed by Room and can join the live session room for the selected conversation."
        )

        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(sessions, key = { it.id }) { session ->
                    val hasUnread = session.lastMessageAt != null &&
                        (session.lastReadAt == null || session.lastMessageAt > session.lastReadAt)
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedSessionId.value = session.id }
                    ) {
                        Row(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = if (hasUnread) "•" else "",
                                style = MaterialTheme.typography.titleLarge,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(end = 8.dp)
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = session.titleDecrypted ?: "Untitled session",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = if (hasUnread) FontWeight.SemiBold else FontWeight.Normal
                                )
                                Text(
                                    text = "${session.provider ?: "unknown"} • ${session.mode ?: "agent"}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 6.dp)
                                )
                            }
                        }
                    }
                }
            }

            if (selectedSession != null) {
                val submitPrompt = { promptText: String, attachments: List<PendingAttachment> ->
                    coroutineScope.launch {
                        isSendingPrompt = true
                        val result = app.syncManager.sendPrompt(
                            sessionId = selectedSession.id,
                            text = promptText,
                            attachments = attachments
                        )
                        result.onSuccess {
                            draftPrompt = ""
                            pendingAttachments = emptyList()
                            promptStatus = "Prompt queued on desktop."
                        }.onFailure { error ->
                            promptStatus = error.message ?: "Failed to queue prompt."
                        }
                        isSendingPrompt = false
                    }
                }

                Column(
                    modifier = Modifier
                        .weight(1.2f)
                        .fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    TranscriptWebView(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        sessionId = selectedSession.id,
                        sessionTitle = selectedSession.titleDecrypted ?: "Untitled session",
                        provider = selectedSession.provider ?: "unknown",
                        model = selectedSession.model ?: "unknown",
                        mode = selectedSession.mode ?: "agent",
                        messages = messages,
                        onPromptSubmitted = { text -> submitPrompt(text, emptyList()) },
                        onInteractiveResponse = { bridgeMessage ->
                            coroutineScope.launch {
                                val promptId = bridgeMessage.promptId
                                    ?: bridgeMessage.requestId
                                    ?: bridgeMessage.questionId
                                    ?: bridgeMessage.proposalId
                                    ?: ""
                                val action = bridgeMessage.action
                                if (promptId.isBlank() || action.isNullOrBlank()) {
                                    promptStatus = "Transcript sent an invalid interactive response."
                                } else {
                                    val result = app.syncManager.handleInteractiveResponse(
                                        sessionId = selectedSession.id,
                                        action = action,
                                        promptId = promptId,
                                        body = bridgeMessage.raw
                                    )
                                    result.onSuccess {
                                        promptStatus = "Interactive response sent to desktop."
                                    }.onFailure { error ->
                                        promptStatus = error.message ?: "Failed to send interactive response."
                                    }
                                }
                            }
                        }
                    )

                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text(
                                text = "Queued prompts",
                                style = MaterialTheme.typography.titleMedium
                            )
                            if (queuedPrompts.isEmpty()) {
                                Text(
                                    text = "No prompts are waiting on the desktop for this session.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            } else {
                                queuedPrompts.takeLast(3).forEach { prompt ->
                                    Card(modifier = Modifier.fillMaxWidth()) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            Text(
                                                text = prompt.promptTextDecrypted
                                                    ?.takeIf { it.isNotBlank() }
                                                    ?: "Attachment-only prompt",
                                                style = MaterialTheme.typography.bodyMedium
                                            )
                                            Text(
                                                text = if (prompt.source.isNullOrBlank()) {
                                                    "Sent from this Android device"
                                                } else {
                                                    "Queued from ${prompt.source}"
                                                },
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.padding(top = 6.dp)
                                            )
                                        }
                                    }
                                }
                            }

                            OutlinedTextField(
                                value = draftPrompt,
                                onValueChange = { draftPrompt = it },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !isSendingPrompt,
                                minLines = 3,
                                label = { Text("Send prompt to desktop") }
                            )

                            if (pendingAttachments.isNotEmpty()) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    pendingAttachments.forEach { attachment ->
                                        Card(modifier = Modifier.fillMaxWidth()) {
                                            Row(
                                                modifier = Modifier.padding(12.dp),
                                                horizontalArrangement = Arrangement.SpaceBetween
                                            ) {
                                                Text(
                                                    text = attachment.filename,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    modifier = Modifier.weight(1f)
                                                )
                                                OutlinedButton(
                                                    onClick = {
                                                        pendingAttachments = pendingAttachments.filterNot {
                                                            it.id == attachment.id
                                                        }
                                                    }
                                                ) {
                                                    Text("Remove")
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedButton(
                                    onClick = {
                                        photoPickerLauncher.launch(
                                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                        )
                                    },
                                    enabled = !isSendingPrompt
                                ) {
                                    Text("Photo")
                                }
                                OutlinedButton(
                                    onClick = { cameraPreviewLauncher.launch(null) },
                                    enabled = !isSendingPrompt
                                ) {
                                    Text("Camera")
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = promptStatus ?: "Prompts are sent through the index room and queued on desktop.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.weight(1f)
                                )
                                Button(
                                    enabled = !isSendingPrompt && (draftPrompt.isNotBlank() || pendingAttachments.isNotEmpty()),
                                    onClick = { submitPrompt(draftPrompt, pendingAttachments) }
                                ) {
                                    Text(if (isSendingPrompt) "Sending..." else "Send")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun decodeBitmap(context: Context, uri: Uri): Bitmap? {
    return runCatching {
        val source = ImageDecoder.createSource(context.contentResolver, uri)
        ImageDecoder.decodeBitmap(source)
    }.getOrNull()
}
