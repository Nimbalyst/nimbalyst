package com.nimbalyst.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nimbalyst.app.pairing.PairingCredentials
import com.nimbalyst.app.pairing.PairingState
import com.nimbalyst.app.pairing.QRPairingData
import com.nimbalyst.app.sync.DeviceInfo
import com.nimbalyst.app.sync.SyncedAvailableModel
import com.nimbalyst.app.sync.SyncConnectionState
import com.nimbalyst.app.notifications.NotificationState

@Composable
fun SettingsScreen(
    pairingState: PairingState,
    syncState: SyncConnectionState,
    connectedDevices: List<DeviceInfo>,
    availableModels: List<SyncedAvailableModel>,
    desktopDefaultModel: String?,
    notificationState: NotificationState,
    onSavePairing: (PairingCredentials) -> Unit,
    onStartLogin: () -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onRefresh: () -> Unit,
    onEnableNotifications: () -> Unit,
    onRefreshNotifications: () -> Unit,
    onClearPairing: () -> Unit
) {
    var showQrScanner by remember { mutableStateOf(false) }
    var qrPayload by remember { mutableStateOf("") }
    var editorMessage by remember { mutableStateOf<String?>(null) }
    var serverUrl by remember { mutableStateOf("") }
    var encryptionSeed by remember { mutableStateOf("") }
    var pairedUserId by remember { mutableStateOf("") }
    var authOrgId by remember { mutableStateOf("") }
    var orgId by remember { mutableStateOf("") }
    var authUserId by remember { mutableStateOf("") }
    var personalUserId by remember { mutableStateOf("") }
    var authJwt by remember { mutableStateOf("") }

    LaunchedEffect(pairingState.credentials) {
        val credentials = pairingState.credentials
        serverUrl = credentials?.serverUrl.orEmpty()
        encryptionSeed = credentials?.encryptionSeed.orEmpty()
        pairedUserId = credentials?.pairedUserId.orEmpty()
        authOrgId = credentials?.orgId.orEmpty()
        orgId = credentials?.personalOrgId.orEmpty()
        authUserId = credentials?.authUserId.orEmpty()
        personalUserId = credentials?.personalUserId.orEmpty()
        authJwt = credentials?.authJwt.orEmpty()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        ScreenScaffold(
            title = "Settings",
            subtitle = "Android settings now expose the live sync transport, browser auth, and camera QR pairing. Push notifications and attachments are still pending."
        )

        if (showQrScanner) {
            PairingQrScanner(
                modifier = Modifier.padding(horizontal = 16.dp),
                onScanned = { rawValue ->
                    val parsed = QRPairingData.parse(rawValue)
                    if (parsed == null) {
                        editorMessage = "Invalid pairing QR code."
                    } else {
                        serverUrl = parsed.serverUrl
                        encryptionSeed = parsed.seed
                        pairedUserId = parsed.userId
                        orgId = parsed.personalOrgId.orEmpty()
                        personalUserId = parsed.personalUserId.orEmpty()
                        editorMessage = "Scanned pairing payload."
                        showQrScanner = false
                    }
                },
                onCancel = { showQrScanner = false }
            )
        }

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = if (pairingState.isPaired) "Pairing configured" else "Not paired",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "Pairing import or edit",
                    style = MaterialTheme.typography.titleSmall
                )
                OutlinedTextField(
                    value = qrPayload,
                    onValueChange = { qrPayload = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("QR payload or nimbalyst://pair link") },
                    minLines = 3
                )
                OutlinedButton(
                    onClick = {
                        val parsed = QRPairingData.parse(qrPayload)
                        if (parsed == null) {
                            editorMessage = "Invalid QR payload."
                        } else {
                            serverUrl = parsed.serverUrl
                            encryptionSeed = parsed.seed
                            pairedUserId = parsed.userId
                            orgId = parsed.personalOrgId.orEmpty()
                            personalUserId = parsed.personalUserId.orEmpty()
                            editorMessage = "Imported pairing payload."
                        }
                    },
                    enabled = qrPayload.isNotBlank()
                ) {
                    Text("Import pairing payload")
                }
                OutlinedButton(
                    onClick = { showQrScanner = !showQrScanner }
                ) {
                    Text(if (showQrScanner) "Hide QR scanner" else "Scan pairing QR")
                }
                pairingState.credentials?.let { credentials ->
                    Text("Server: ${credentials.serverUrl}", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Routing user: ${credentials.routingUserId ?: "Not provided"}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        "Routing org: ${credentials.routingOrgId ?: "Not provided"}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        "Crypto user: ${credentials.cryptoUserId ?: "Not provided"}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        "JWT: ${if (credentials.authJwt.isNullOrBlank()) "Not provided" else "Stored"}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    if (!credentials.authEmail.isNullOrBlank()) {
                        Text(
                            "Auth email: ${credentials.authEmail}",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    Text(
                        "Sync status: ${syncState.statusLabel}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    syncState.lastError?.let { error ->
                        Text(
                            text = "Last error: $error",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Text(
                        "Devices online: ${connectedDevices.size}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Server URL") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = encryptionSeed,
                    onValueChange = { encryptionSeed = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Encryption seed") },
                    minLines = 2
                )
                OutlinedTextField(
                    value = pairedUserId,
                    onValueChange = { pairedUserId = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Paired email or user ID") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = authOrgId,
                    onValueChange = { authOrgId = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Auth org ID") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = authUserId,
                    onValueChange = { authUserId = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Auth user ID") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = orgId,
                    onValueChange = { orgId = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Personal org ID override") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = personalUserId,
                    onValueChange = { personalUserId = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Personal user ID override") },
                    singleLine = true
                )
                OutlinedTextField(
                    value = authJwt,
                    onValueChange = { authJwt = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Session JWT") },
                    minLines = 3
                )
                editorMessage?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Button(
                    onClick = {
                        onSavePairing(
                            PairingCredentials(
                                serverUrl = serverUrl.trim(),
                                encryptionSeed = encryptionSeed.trim(),
                                pairedUserId = pairedUserId.trim().ifBlank { null },
                                authJwt = authJwt.trim().ifBlank { null },
                                authUserId = authUserId.trim().ifBlank { null },
                                orgId = authOrgId.trim().ifBlank { null },
                                personalUserId = personalUserId.trim().ifBlank { null },
                                personalOrgId = orgId.trim().ifBlank { null }
                            )
                        )
                        editorMessage = "Saved pairing credentials."
                    },
                    enabled = serverUrl.isNotBlank() && encryptionSeed.isNotBlank()
                ) {
                    Text("Save pairing")
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onStartLogin,
                        enabled = pairingState.isPaired
                    ) {
                        Text("Open browser login")
                    }
                    Button(
                        onClick = onConnect,
                        enabled = pairingState.isSyncConfigured && !syncState.indexConnected
                    ) {
                        Text("Connect sync")
                    }
                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = syncState.indexConnected
                    ) {
                        Text("Request full sync")
                    }
                    OutlinedButton(
                        onClick = onDisconnect,
                        enabled = syncState.indexConnected || syncState.sessionConnected
                    ) {
                        Text("Disconnect sync")
                    }
                }

                if (connectedDevices.isNotEmpty()) {
                    Text(
                        text = "Connected devices",
                        style = MaterialTheme.typography.titleSmall
                    )
                    connectedDevices.forEach { device ->
                        Text(
                            text = "${device.name} (${device.platform})",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                if (availableModels.isNotEmpty()) {
                    Text(
                        text = "Desktop models",
                        style = MaterialTheme.typography.titleSmall
                    )
                    desktopDefaultModel?.let { defaultModel ->
                        Text(
                            text = "Default: $defaultModel",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    availableModels.forEach { model ->
                        Text(
                            text = "${model.name} (${model.provider})",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                Text(
                    text = "Notifications",
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = if (notificationState.isAuthorized) {
                        "Authorized"
                    } else {
                        "Not authorized"
                    },
                    style = MaterialTheme.typography.bodySmall
                )
                if (!notificationState.deviceToken.isNullOrBlank()) {
                    Text(
                        text = "FCM token stored",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                notificationState.lastError?.let { error ->
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
                OutlinedButton(onClick = onEnableNotifications) {
                    Text("Enable notifications")
                }
                OutlinedButton(onClick = onRefreshNotifications) {
                    Text("Refresh notification state")
                }
                Button(onClick = onClearPairing, enabled = pairingState.isPaired) {
                    Text("Clear pairing")
                }
            }
        }
    }
}
