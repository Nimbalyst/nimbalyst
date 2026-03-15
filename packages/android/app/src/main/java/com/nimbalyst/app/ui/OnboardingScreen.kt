package com.nimbalyst.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nimbalyst.app.pairing.PairingCredentials

@Composable
fun OnboardingScreen(
    onSavePairing: (PairingCredentials) -> Unit
) {
    var showQrScanner by remember { mutableStateOf(false) }
    var editorMessage by remember { mutableStateOf<String?>(null) }
    var serverUrl by remember { mutableStateOf("https://sync.nimbalyst.local") }
    var encryptionSeed by remember { mutableStateOf("") }
    var pairedUserId by remember { mutableStateOf("") }
    var authOrgId by remember { mutableStateOf("") }
    var orgId by remember { mutableStateOf("") }
    var authUserId by remember { mutableStateOf("") }
    var personalUserId by remember { mutableStateOf("") }
    var authJwt by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Pair Android with Desktop",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Scan the desktop pairing QR or enter credentials manually. Browser auth and deep-link callbacks are already wired, so this flow can now start from the camera instead of pasted payloads.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        if (showQrScanner) {
            PairingQrScanner(
                onScanned = { rawValue ->
                    val parsed = com.nimbalyst.app.pairing.QRPairingData.parse(rawValue)
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

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Server URL") },
                    singleLine = true
                )
                Button(
                    onClick = { showQrScanner = !showQrScanner }
                ) {
                    Text(if (showQrScanner) "Hide QR scanner" else "Scan pairing QR")
                }
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
                    label = { Text("Paired account email or user ID") },
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
                    minLines = 4
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
                    },
                    enabled = serverUrl.isNotBlank() && encryptionSeed.isNotBlank()
                ) {
                    Text("Save pairing")
                }
            }
        }
    }
}
