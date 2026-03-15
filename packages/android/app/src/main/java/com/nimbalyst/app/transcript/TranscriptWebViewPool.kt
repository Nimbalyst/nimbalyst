package com.nimbalyst.app.transcript

import android.annotation.SuppressLint
import android.content.Context
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.LinkedList

/**
 * Pre-warms WebView instances for instant session switching.
 * Matches iOS TranscriptWebViewPool behavior.
 */
object TranscriptWebViewPool {
    private const val POOL_SIZE = 2
    private const val TRANSCRIPT_ASSET_URL = "file:///android_asset/transcript-dist/transcript.html"
    private val pool = LinkedList<WebView>()

    @SuppressLint("SetJavaScriptEnabled")
    fun warmup(context: Context) {
        val appContext = context.applicationContext
        synchronized(pool) {
            while (pool.size < POOL_SIZE) {
                val webView = createBaseWebView(appContext)
                webView.loadUrl(TRANSCRIPT_ASSET_URL)
                pool.add(webView)
            }
        }
    }

    /**
     * Take a pre-warmed WebView from the pool, or create a new one if empty.
     */
    fun take(context: Context): WebView {
        val appContext = context.applicationContext
        synchronized(pool) {
            val webView = pool.poll()
            if (webView != null) {
                // Replenish pool in the background
                return webView
            }
        }
        // Pool empty, create on demand
        return createBaseWebView(appContext).also {
            it.loadUrl(TRANSCRIPT_ASSET_URL)
        }
    }

    /**
     * Return a WebView to the pool for reuse. Clears the JS bridge first.
     */
    fun recycle(webView: WebView) {
        webView.removeJavascriptInterface("AndroidBridge")
        webView.evaluateJavascript("window.nimbalyst?.clearSession?.();", null)
        synchronized(pool) {
            if (pool.size < POOL_SIZE) {
                pool.add(webView)
            } else {
                webView.destroy()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createBaseWebView(context: Context): WebView {
        return WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return request.url?.scheme != "file"
                }
            }
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = false
            settings.loadsImagesAutomatically = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
        }
    }
}
