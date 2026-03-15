package com.nimbalyst.app.sync

import android.content.Context
import android.content.SharedPreferences
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class WebSocketClient(
    private val scope: CoroutineScope,
    private val reconnectDelayMs: Long = 3_000L,
) {
    companion object {
        private const val PREFS_NAME = "nimbalyst_device"
        private const val KEY_DEVICE_ID = "device_id"

        @Volatile
        private var cachedDeviceId: String? = null

        fun getDeviceId(context: Context): String {
            cachedDeviceId?.let { return it }
            val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val id = prefs.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_DEVICE_ID, it).apply()
            }
            cachedDeviceId = id
            return id
        }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var currentWebSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var isIntentionallyClosed = false
    private var connectionParams: ConnectionParams? = null

    @Volatile
    var isConnected: Boolean = false
        private set

    var onTextMessage: ((String) -> Unit)? = null
    var onConnectionStateChanged: ((Boolean) -> Unit)? = null
    var onFailure: ((String) -> Unit)? = null

    fun connect(serverUrl: String, roomId: String, authToken: String) {
        connectionParams = ConnectionParams(serverUrl, roomId, authToken)
        isIntentionallyClosed = false
        connectInternal()
    }

    fun disconnect() {
        isIntentionallyClosed = true
        reconnectJob?.cancel()
        reconnectJob = null
        currentWebSocket?.close(1000, "client disconnect")
        currentWebSocket = null
        updateConnection(false)
    }

    fun sendRaw(json: String): Boolean = currentWebSocket?.send(json) ?: false

    private fun connectInternal() {
        val params = connectionParams ?: return
        reconnectJob?.cancel()
        currentWebSocket?.cancel()
        currentWebSocket = null
        updateConnection(false)

        val request = Request.Builder()
            .url(buildWebSocketUrl(params))
            .build()

        currentWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectJob?.cancel()
                updateConnection(true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                onTextMessage?.invoke(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
                updateConnection(false)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                updateConnection(false)
                if (!isIntentionallyClosed) {
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                updateConnection(false)
                onFailure?.invoke(t.message ?: "WebSocket failure")
                if (!isIntentionallyClosed) {
                    scheduleReconnect()
                }
            }
        })
    }

    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true) {
            return
        }
        reconnectJob = scope.launch {
            delay(reconnectDelayMs)
            if (!isIntentionallyClosed) {
                connectInternal()
            }
        }
    }

    private fun buildWebSocketUrl(params: ConnectionParams): String {
        val wsBase = params.serverUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .trimEnd('/')
        val encodedToken = URLEncoder.encode(params.authToken, StandardCharsets.UTF_8)
        return "$wsBase/sync/${params.roomId}?token=$encodedToken"
    }

    private fun updateConnection(connected: Boolean) {
        isConnected = connected
        onConnectionStateChanged?.invoke(connected)
    }
}

private data class ConnectionParams(
    val serverUrl: String,
    val roomId: String,
    val authToken: String
)
