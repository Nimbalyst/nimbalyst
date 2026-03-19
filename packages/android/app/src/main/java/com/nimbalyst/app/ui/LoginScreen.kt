package com.nimbalyst.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.browser.customtabs.CustomTabsIntent
import android.net.Uri
import com.nimbalyst.app.analytics.AnalyticsManager

@Composable
fun LoginScreen(
    serverUrl: String,
    pairedEmail: String?,
    onUnpair: () -> Unit
) {
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.AccountCircle,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Sign In",
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(12.dp))

        if (!pairedEmail.isNullOrBlank()) {
            Text(
                text = buildAnnotatedString {
                    append("Sign in as ")
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                        append(pairedEmail)
                    }
                    append(" to sync with your Mac.")
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        } else {
            Text(
                text = "Sign in to sync sessions with your Mac.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = {
                val loginUrl = serverUrl
                    .replace("wss://", "https://")
                    .replace("ws://", "http://")
                    .trimEnd('/') + "/auth/login/google"
                AnalyticsManager.capture("mobile_login_started")
                CustomTabsIntent.Builder()
                    .build()
                    .launchUrl(context, Uri.parse(loginUrl))
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Sign in with Google")
        }

        Spacer(modifier = Modifier.height(48.dp))

        TextButton(onClick = {
            AnalyticsManager.capture("mobile_device_unpairing")
            AnalyticsManager.reset()
            onUnpair()
        }) {
            Text(
                text = "Unpair Device",
                color = MaterialTheme.colorScheme.error
            )
        }
    }
}
