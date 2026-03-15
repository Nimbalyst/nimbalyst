package com.nimbalyst.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
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
import androidx.browser.customtabs.CustomTabsIntent
import com.nimbalyst.app.NimbalystApplication
import com.nimbalyst.app.analytics.AnalyticsManager
import kotlinx.coroutines.launch

@Composable
fun NimbalystAndroidApp() {
    val app = LocalContext.current.applicationContext as NimbalystApplication
    val context = LocalContext.current
    val pairingState by app.pairingStore.state.collectAsState()
    val syncState by app.syncManager.state.collectAsState()
    val connectedDevices by app.syncManager.connectedDevices.collectAsState()
    val availableModels by app.syncManager.availableModels.collectAsState()
    val desktopDefaultModel by app.syncManager.desktopDefaultModel.collectAsState()
    val notificationState by app.notificationManager.state.collectAsState()
    val coroutineScope = rememberCoroutineScope()
    var currentScreen by remember { mutableStateOf(AndroidScreen.Projects) }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        app.notificationManager.handlePermissionResult(granted)
    }

    LaunchedEffect(Unit) {
        val packageInfo = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0)
        }.getOrNull()
        AnalyticsManager.capture(
            "mobile_app_opened",
            mapOf(
                "platform" to "android",
                "nimbalyst_mobile_version" to (packageInfo?.versionName ?: "unknown")
            )
        )
    }

    LaunchedEffect(pairingState.credentials) {
        if (pairingState.isSyncConfigured) {
            app.syncManager.connectIfConfigured()
        } else {
            app.syncManager.disconnect()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            app.syncManager.leaveSessionRoom()
        }
    }

    if (!pairingState.isPaired) {
        OnboardingScreen(
            onSavePairing = { credentials ->
                app.pairingStore.savePairing(credentials)
            }
        )
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                AndroidScreen.entries.forEach { screen ->
                    NavigationBarItem(
                        selected = currentScreen == screen,
                        onClick = { currentScreen = screen },
                        icon = { Icon(screen.icon, contentDescription = screen.label) },
                        label = { Text(screen.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (currentScreen) {
                AndroidScreen.Projects -> ProjectsScreen()

                AndroidScreen.Sessions -> SessionsScreen()

                AndroidScreen.Settings -> SettingsScreen(
                    pairingState = pairingState,
                    syncState = syncState,
                    connectedDevices = connectedDevices,
                    availableModels = availableModels,
                    desktopDefaultModel = desktopDefaultModel,
                    notificationState = notificationState,
                    onSavePairing = { credentials ->
                        app.pairingStore.savePairing(credentials)
                    },
                    onStartLogin = {
                        pairingState.credentials?.serverUrl?.let { serverUrl ->
                            val loginUrl = serverUrl
                                .replace("wss://", "https://")
                                .replace("ws://", "http://")
                                .trimEnd('/') + "/auth/login/google"
                            CustomTabsIntent.Builder()
                                .build()
                                .launchUrl(context, android.net.Uri.parse(loginUrl))
                        }
                    },
                    onConnect = { app.syncManager.connect() },
                    onDisconnect = { app.syncManager.disconnect() },
                    onRefresh = { app.syncManager.requestFullSync() },
                    onEnableNotifications = {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            app.notificationManager.handlePermissionResult(true)
                        }
                    },
                    onRefreshNotifications = { app.notificationManager.refreshAuthorization() },
                    onClearPairing = {
                        app.syncManager.disconnect()
                        coroutineScope.launch {
                            app.repository.clearPrototypeData()
                        }
                        app.pairingStore.clearPairing()
                        AnalyticsManager.capture("mobile_device_unpairing")
                        AnalyticsManager.reset()
                    }
                )
            }
        }
    }
}
