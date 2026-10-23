package app.homebase.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.homebase.BuildConfig
import app.homebase.HomeApp
import app.homebase.HomebaseState
import app.homebase.Link
import app.homebase.MainActivity
import app.homebase.Model
import app.homebase.Screen

@Composable
fun AppScreen(state: HomebaseState, activity: MainActivity, appId: String) {
    val app = state.app(appId)
    if (app == null) { state.screen = Screen.Launcher; return }
    var progress by remember { mutableIntStateOf(100) }
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val web = remember(app.id) {
        state.webViews.getOrPut(app.id) { createWebView(activity, state, app) }
    }
    // Progress and errors come from the WebView's clients; point them at this screen.
    remember(web) {
        (web.webChromeClient as? HomebaseChrome)?.onProgress = { progress = it }
        (web.tag as? Hooks)?.onMainFrameError = { if (state.store.warnTailscale && state.link != Link.Connected) state.screen = Screen.Offline(app.id) }
        true
    }

    BackHandler {
        if (web.canGoBack()) web.goBack() else state.screen = Screen.Launcher
    }

    Column(Modifier.fillMaxSize().background(Color.White)) {
        Row(
            Modifier.fillMaxWidth().background(Ink).windowInsetsPadding(WindowInsets.statusBars).padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { state.screen = Screen.Launcher }) { Icon(Icons.Filled.Menu, contentDescription = "Back to your apps", tint = Color.White) }
            Column(Modifier.weight(1f)) {
                Text(app.name, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val ok = state.link == Link.Connected
                    Box(Modifier.size(7.dp).clip(CircleShape).background(if (ok) Color(0xFF3DDC97) else Color(0xFFFF8A7A)))
                    Text(
                        (state.current?.name ?: "") + if (ok) " · connected" else if (state.link == Link.Checking) " · checking" else " · offline",
                        color = Color(0xFFB7BDCC), fontSize = 11.sp,
                    )
                }
            }
            IconButton(onClick = { web.reload() }) { Icon(Icons.Filled.Refresh, contentDescription = "Reload", tint = Color.White) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More options", tint = Color.White) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Open in browser") }, onClick = {
                        menu = false
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(web.url ?: app.url)))
                    })
                    DropdownMenuItem(text = { Text("Copy link") }, onClick = { menu = false; clipboard.setText(AnnotatedString(web.url ?: app.url)) })
                    DropdownMenuItem(text = { Text("Back to the app's start") }, onClick = { menu = false; web.loadUrl(app.url) })
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(3.dp).background(Ink)) {
            if (progress < 100) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxSize(), color = Accent, trackColor = Color(0xFF2A2F3B))
        }
        AndroidView(
            factory = { (web.parent as? ViewGroup)?.removeView(web); web },
            modifier = Modifier.weight(1f).fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars),
        )
    }
}

/** Callbacks a WebView reports to whichever screen is showing it. */
private class Hooks { var onMainFrameError: () -> Unit = {} }

private class HomebaseChrome(private val activity: MainActivity) : WebChromeClient() {
    var onProgress: (Int) -> Unit = {}
    override fun onProgressChanged(view: WebView, newProgress: Int) = onProgress(newProgress)
    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
        activity.chooseFiles(callback, params)
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(activity: MainActivity, state: HomebaseState, app: HomeApp): WebView {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    val web = WebView(activity)
    val hooks = Hooks()
    web.tag = hooks
    with(web.settings) {
        javaScriptEnabled = true
        domStorageEnabled = true // localStorage: the apps keep their offline queue and settings here
        cacheMode = WebSettings.LOAD_DEFAULT
        mediaPlaybackRequiresUserGesture = true
        userAgentString = "$userAgentString Homebase/${BuildConfig.VERSION_NAME}"
    }
    // Pages that belong to this server (or this app) stay inside; anything else opens in the browser.
    val inside = setOfNotNull(Model.origin(app.url), state.current?.url?.let { Model.origin(it) })
    val token = if (app.injectToken) state.token() else null
    val origin = Model.origin(app.url)
    if (token != null && origin != null) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, Model.tokenScript(token), setOf(origin))
        }
    }
    web.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val o = Model.origin(request.url.toString())
            if (o != null && o in inside) return false
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // Older WebViews without document-start scripts: hand over the token as the page starts.
            if (token != null && origin != null && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
                url != null && Model.origin(url) == origin
            ) view.evaluateJavascript(Model.tokenScript(token), null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) hooks.onMainFrameError()
        }
    }
    web.webChromeClient = HomebaseChrome(activity)
    web.setDownloadListener { url, _, _, _, _ -> runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    web.loadUrl(app.url)
    return web
}
