package com.nimbalyst.app.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class NotificationManager(
    private val context: Context,
) {
    private val _state = MutableStateFlow(
        NotificationState(
            isAuthorized = hasNotificationPermission()
        )
    )

    var onTokenReceived: ((String) -> Unit)? = null

    val state: StateFlow<NotificationState> = _state.asStateFlow()

    init {
        refreshAuthorization()
    }

    fun refreshAuthorization() {
        val authorized = hasNotificationPermission()
        _state.value = _state.value.copy(
            isAuthorized = authorized,
            lastError = if (authorized) _state.value.lastError else null
        )
        if (authorized) {
            fetchToken()
        }
    }

    fun handlePermissionResult(granted: Boolean) {
        _state.value = _state.value.copy(isAuthorized = granted)
        if (granted) {
            fetchToken()
        }
    }

    fun fetchToken() {
        val app = runCatching { FirebaseApp.initializeApp(context) }.getOrNull()
        if (app == null) {
            _state.value = _state.value.copy(
                lastError = "Firebase is not configured for Android. Add google-services.json to enable push."
            )
            return
        }

        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                _state.value = _state.value.copy(
                    deviceToken = token,
                    lastError = null
                )
                onTokenReceived?.invoke(token)
            }
            .addOnFailureListener { error ->
                _state.value = _state.value.copy(
                    lastError = error.message ?: "Failed to get FCM token."
                )
            }
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true
        }
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }
}

data class NotificationState(
    val isAuthorized: Boolean,
    val deviceToken: String? = null,
    val lastError: String? = null,
)
