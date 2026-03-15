package com.nimbalyst.app.transcript

import android.annotation.SuppressLint
import android.content.Context
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.nimbalyst.app.data.MessageEntity

private const val TRANSCRIPT_ASSET_URL = "file:///android_asset/transcript-dist/transcript.html"

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

    AndroidView(
        modifier = modifier,
        factory = { viewContext ->
            createTranscriptWebView(
                context = viewContext,
                sessionId = sessionId,
                sessionTitle = sessionTitle,
                provider = provider,
                model = model,
                mode = mode,
                messages = messages,
                onPromptSubmitted = onPromptSubmitted,
                onInteractiveResponse = onInteractiveResponse
            ).apply {
                loadUrl(TRANSCRIPT_ASSET_URL)
            }
        },
        update = { webView ->
            webView.loadSessionPayload(
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

@SuppressLint("SetJavaScriptEnabled")
private fun createTranscriptWebView(
    context: Context,
    sessionId: String,
    sessionTitle: String,
    provider: String,
    model: String,
    mode: String,
    messages: List<MessageEntity>,
    onPromptSubmitted: (String) -> Unit,
    onInteractiveResponse: (TranscriptBridgeMessage) -> Unit,
): WebView {
    return WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webChromeClient = WebChromeClient()
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                view.loadSessionPayload(
                    sessionId = sessionId,
                    sessionTitle = sessionTitle,
                    provider = provider,
                    model = model,
                    mode = mode,
                    messages = messages
                )
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
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = false
        settings.loadsImagesAutomatically = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
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
