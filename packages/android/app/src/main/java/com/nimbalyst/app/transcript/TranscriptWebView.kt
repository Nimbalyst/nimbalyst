package com.nimbalyst.app.transcript

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.nimbalyst.app.data.MessageEntity

@Composable
fun TranscriptWebView(
    modifier: Modifier = Modifier,
    sessionId: String,
    sessionTitle: String,
    provider: String,
    model: String,
    mode: String,
    messages: List<MessageEntity>,
    onPromptSubmitted: (String) -> Unit = {},
    onInteractiveResponse: (TranscriptBridgeMessage) -> Unit = {},
) {
    val context = LocalContext.current

    if (!context.hasTranscriptAssets()) {
        MissingTranscriptAssets(modifier = modifier, sessionTitle = sessionTitle)
        return
    }

    val webView = remember { TranscriptWebViewPool.take(context) }

    DisposableEffect(Unit) {
        onDispose {
            TranscriptWebViewPool.recycle(webView)
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { _ ->
            webView.apply {
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        return request.url?.scheme != "file"
                    }
                }
                addJavascriptInterface(
                    TranscriptBridge { message ->
                        when (message.type) {
                            "prompt" -> message.text?.let(onPromptSubmitted)
                            "interactive_response" -> onInteractiveResponse(message)
                        }
                    },
                    "AndroidBridge"
                )
                // Pool pre-loads the page, so push payload immediately
                loadSessionPayload(
                    sessionId = sessionId,
                    sessionTitle = sessionTitle,
                    provider = provider,
                    model = model,
                    mode = mode,
                    messages = messages
                )
            }
        },
        update = { wv ->
            wv.loadSessionPayload(
                sessionId = sessionId,
                sessionTitle = sessionTitle,
                provider = provider,
                model = model,
                mode = mode,
                messages = messages
            )
        }
    )
}

@Composable
private fun MissingTranscriptAssets(
    modifier: Modifier,
    sessionTitle: String
) {
    Card(modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Transcript assets are missing for \"$sessionTitle\".\n\nRun `npm run build:transcript` and `npm run sync:transcript-assets` in packages/android.",
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

private fun Context.hasTranscriptAssets(): Boolean {
    return try {
        assets.open("transcript-dist/transcript.html").close()
        true
    } catch (_: Exception) {
        false
    }
}

private fun WebView.loadSessionPayload(
    sessionId: String,
    sessionTitle: String,
    provider: String,
    model: String,
    mode: String,
    messages: List<MessageEntity>
) {
    val payload = TranscriptPayloadBuilder.buildSessionPayload(
        sessionId = sessionId,
        sessionTitle = sessionTitle,
        provider = provider,
        model = model,
        mode = mode,
        messages = messages
    )
    val script = "window.nimbalyst?.loadSession($payload);"
    evaluateJavascript(script, null)
}
