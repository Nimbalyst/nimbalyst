package com.nimbalyst.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nimbalyst.app.analytics.AnalyticsManager
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
    onSavePairing: (com.nimbalyst.app.pairing.PairingCredentials) -> Unit,
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
    var formState by remember { mutableStateOf(PairingFormState()) }

    LaunchedEffect(pairingState.credentials) {
        val credentials = pairingState.credentials
        formState = PairingFormState(
            serverUrl = credentials?.serverUrl.orEmpty(),
            encryptionSeed = credentials?.encryptionSeed.orEmpty(),
            pairedUserId = credentials?.pairedUserId.orEmpty(),
            authOrgId = credentials?.orgId.orEmpty(),
            orgId = credentials?.personalOrgId.orEmpty(),
            authUserId = credentials?.authUserId.orEmpty(),
            personalUserId = credentials?.personalUserId.orEmpty(),
            authJwt = credentials?.authJwt.orEmpty()
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        ScreenScaffold(title = "Settings")

        // Connection status section
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = if (pairingState.isPaired) "Pairing configured" else "Not paired",
                    style = MaterialTheme.typography.titleMedium
                )

                pairingState.credentials?.let { credentials ->
                    Text("Server: ${credentials.serverUrl}", style = MaterialTheme.typography.bodyMedium)
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
                    if (!credentials.authEmail.isNullOrBlank()) {
                        Text(
                            "Account: ${credentials.authEmail}",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
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
            }
        }

        // Connected devices section
        if (connectedDevices.isNotEmpty()) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "Connected devices",
                        style = MaterialTheme.typography.titleMedium
                    )
                    connectedDevices.forEach { device ->
                        Text(
                            text = "${device.name} (${device.platform})",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }

        // Available models section
        if (availableModels.isNotEmpty()) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "Desktop models",
                        style = MaterialTheme.typography.titleMedium
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
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }

        // Notifications section
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Notifications",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = if (notificationState.isAuthorized) "Authorized" else "Not authorized",
                    style = MaterialTheme.typography.bodyMedium
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
            }
        }

        // Analytics section
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Analytics",
                    style = MaterialTheme.typography.titleMedium
                )
                var analyticsEnabled by remember { mutableStateOf(AnalyticsManager.isEnabled) }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Send anonymous usage data",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = "Help improve Nimbalyst with anonymous analytics. No session content is collected.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = analyticsEnabled,
                        onCheckedChange = { enabled ->
                            analyticsEnabled = enabled
                            if (enabled) {
                                AnalyticsManager.optIn()
                            } else {
                                AnalyticsManager.optOut()
                            }
                        }
                    )
                }
            }
        }

        // Pairing credentials section
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Pairing credentials",
                    style = MaterialTheme.typography.titleMedium
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
                            AnalyticsManager.setDistinctIdFromPairing(parsed.analyticsId)
                            formState = formState.copy(
                                serverUrl = parsed.serverUrl,
                                encryptionSeed = parsed.seed,
                                pairedUserId = parsed.userId,
                                orgId = parsed.personalOrgId.orEmpty(),
                                personalUserId = parsed.personalUserId.orEmpty()
                            )
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

                if (showQrScanner) {
                    PairingQrScanner(
                        onScanned = { rawValue ->
                            val parsed = QRPairingData.parse(rawValue)
                            if (parsed == null) {
                                editorMessage = "Invalid pairing QR code."
                            } else {
                                AnalyticsManager.setDistinctIdFromPairing(parsed.analyticsId)
                                formState = formState.copy(
                                    serverUrl = parsed.serverUrl,
                                    encryptionSeed = parsed.seed,
                                    pairedUserId = parsed.userId,
                                    orgId = parsed.personalOrgId.orEmpty(),
                                    personalUserId = parsed.personalUserId.orEmpty()
                                )
                                editorMessage = "Scanned pairing payload."
                                showQrScanner = false
                            }
                        },
                        onCancel = { showQrScanner = false }
                    )
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                PairingCredentialsForm(
                    state = formState,
                    onStateChange = { formState = it },
                    onSave = {
                        onSavePairing(formState.toCredentials())
                        editorMessage = "Saved pairing credentials."
                    },
                    message = editorMessage
                )
            }
        }

        // Danger zone
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Danger zone",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error
                )
                Button(onClick = onClearPairing, enabled = pairingState.isPaired) {
                    Text("Clear pairing")
                }
            }
        }
    }
}
